import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cria o cliente Supabase apenas se as variáveis de ambiente estiverem disponíveis
export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Diagnóstico: mostra no console se o Supabase está ativo ou não
if (supabase) {
  console.log('%c[FrostERP] Supabase CONECTADO ✅', 'color: #22c55e; font-weight: bold');
} else {
  console.warn('[FrostERP] Supabase DESCONECTADO ❌ — variáveis de ambiente não encontradas. Rodando apenas local.');
  console.warn('VITE_SUPABASE_URL:', supabaseUrl ? '✅ presente' : '❌ ausente');
  console.warn('VITE_SUPABASE_ANON_KEY:', supabaseKey ? '✅ presente' : '❌ ausente');
}

// Chaves que contêm dados sensíveis e não devem ser sincronizadas ao Supabase
// Nota: erp:user: foi removido — usuários precisam sincronizar para login funcionar em outros PCs
// As senhas são armazenadas com hash, portanto é seguro sincronizar
const SENSITIVE_PREFIXES = [];

function isSensitive(key) {
  return SENSITIVE_PREFIXES.some(prefix => key.startsWith(prefix));
}

// ─── Hydrate: Supabase é a fonte de verdade ───────────────────────────────────
// Substitui TODOS os dados locais erp: pelos dados do Supabase (exceto sensíveis).
// Isso garante que exclusões feitas em outro aparelho sejam refletidas aqui.
export async function hydrateFromSupabase() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('kv_store')
      .select('key, value');

    if (error) {
      console.warn('Supabase hydrate error:', error.message);
      return;
    }

    // Conjunto de chaves que existem no Supabase
    const remoteKeys = new Set((data || []).map(row => row.key));

    // 1) Remover chaves locais que não existem mais no Supabase (foram deletadas em outro aparelho)
    const keysToRemove = [];
    for (let i = 0; i < window.storage.length; i++) {
      const key = window.storage.key(i);
      if (!key || !key.startsWith('erp:')) continue;
      if (isSensitive(key)) continue; // Não mexer em dados locais de usuário
      if (key === 'erp:seeded' || key === 'erp:config' || key === 'erp:lastBackup') continue;
      if (!remoteKeys.has(key)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => window.storage.removeItem(key));

    // 2) Adicionar/atualizar chaves do Supabase no local
    if (data && data.length > 0) {
      data.forEach((row) => {
        window.storage.setItem(row.key, JSON.stringify(row.value));
      });
    }

    console.log(`Sync completo: ${(data || []).length} chaves do Supabase, ${keysToRemove.length} removidas localmente`);
  } catch (err) {
    console.warn('Supabase connection failed, using local data:', err.message);
  }
}

// ─── Upload: envia tudo do local para o Supabase ─────────────────────────────
export async function uploadAllToSupabase() {
  if (!supabase) return;
  try {
    const rows = [];
    for (let i = 0; i < window.storage.length; i++) {
      const key = window.storage.key(i);
      if (!key || !key.startsWith('erp:')) continue;
      if (isSensitive(key)) continue;
      const raw = window.storage.getItem(key);
      if (raw === null) continue;
      try {
        rows.push({ key, value: JSON.parse(raw), updated_at: new Date().toISOString() });
      } catch { /* skip non-JSON */ }
    }
    if (rows.length === 0) return;

    // Upsert em lotes de 500
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase
        .from('kv_store')
        .upsert(batch, { onConflict: 'key' });
      if (error) console.warn('Upload batch error:', error.message);
    }
    console.log(`Uploaded ${rows.length} keys to Supabase`);
  } catch (err) {
    console.warn('Upload to Supabase failed:', err.message);
  }
}

// ─── Sync unitário: salva uma chave no Supabase ──────────────────────────────
export function syncToSupabase(key, value) {
  if (!supabase) return;
  if (isSensitive(key)) return;
  supabase
    .from('kv_store')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .then(({ error }) => {
      if (error) console.warn('Sync error:', key, error.message);
    });
}

// ─── Delete: remove uma chave do Supabase ─────────────────────────────────────
export function deleteFromSupabase(key) {
  if (!supabase) return;
  supabase
    .from('kv_store')
    .delete()
    .eq('key', key)
    .then(({ error }) => {
      if (error) console.warn('Delete sync error:', key, error.message);
    });
}

// ─── Upload de fotos ao Supabase Storage ──────────────────────────────────────
// Usado pelo app do técnico para enviar fotos do serviço.
// Retorna URL pública da foto enviada (ou null se falhar).
// Bucket esperado: 'os-fotos' (precisa estar criado no Supabase com acesso público).
export async function uploadFotoOS(file, osId) {
  if (!supabase) {
    console.warn('Supabase desconectado — upload de foto ignorado');
    return null;
  }
  try {
    // Gera nome único: osId/timestamp_nomeoriginal
    const ext = (file.name || 'foto.jpg').split('.').pop();
    const ts = Date.now();
    const path = `${osId}/${ts}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('os-fotos')
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });

    if (upErr) {
      console.warn('Upload foto erro:', upErr.message);
      return null;
    }

    // Pega URL pública do bucket
    const { data } = supabase.storage.from('os-fotos').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.warn('Upload foto falhou:', err.message);
    return null;
  }
}

// ─── Remove foto do Storage (caso técnico exclua antes de finalizar) ─────────
export async function deleteFotoOS(publicUrl) {
  if (!supabase || !publicUrl) return;
  try {
    // Extrai path do URL público (depois de /os-fotos/)
    const marker = '/os-fotos/';
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return;
    const path = publicUrl.slice(idx + marker.length);
    await supabase.storage.from('os-fotos').remove([path]);
  } catch (err) {
    console.warn('Delete foto falhou:', err.message);
  }
}

// ─── Realtime: escuta mudanças no Supabase e atualiza o local ─────────────────
// Retorna função de cleanup para desinscrever
export function subscribeToChanges(onDataChanged) {
  if (!supabase) return () => {};

  const channel = supabase
    .channel('kv_store_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'kv_store' },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;

        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          // Outra aba/aparelho criou ou atualizou um registro
          if (newRow && newRow.key) {
            window.storage.setItem(newRow.key, JSON.stringify(newRow.value));
            if (onDataChanged) onDataChanged();
          }
        } else if (eventType === 'DELETE') {
          // Outra aba/aparelho deletou um registro
          if (oldRow && oldRow.key) {
            window.storage.removeItem(oldRow.key);
            if (onDataChanged) onDataChanged();
          }
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Realtime sync ativo — mudanças de outros aparelhos serão refletidas automaticamente');
      }
    });

  // Retorna cleanup
  return () => {
    supabase.removeChannel(channel);
  };
}
