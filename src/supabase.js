import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cria o cliente Supabase apenas se as variáveis de ambiente estiverem disponíveis
export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Hydrate localStorage from Supabase on startup
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

    if (data && data.length > 0) {
      data.forEach((row) => {
        window.storage.setItem(row.key, JSON.stringify(row.value));
      });
      console.log(`Hydrated ${data.length} keys from Supabase`);
    }
  } catch (err) {
    console.warn('Supabase connection failed, using local data:', err.message);
  }
}

// Upload all local data to Supabase
export async function uploadAllToSupabase() {
  if (!supabase) return;
  try {
    const rows = [];
    for (let i = 0; i < window.storage.length; i++) {
      const key = window.storage.key(i);
      if (!key || !key.startsWith('erp:')) continue;
      // Não enviar dados sensíveis (senhas de usuários)
      if (SENSITIVE_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
      const raw = window.storage.getItem(key);
      if (raw === null) continue;
      try {
        rows.push({ key, value: JSON.parse(raw), updated_at: new Date().toISOString() });
      } catch { /* skip non-JSON */ }
    }
    if (rows.length === 0) return;

    // Upsert in batches of 500
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

// Chaves que contêm dados sensíveis e não devem ser sincronizadas ao Supabase
const SENSITIVE_PREFIXES = ['erp:user:'];

// Fire-and-forget sync a single key to Supabase
export function syncToSupabase(key, value) {
  if (!supabase) return;
  // Não sincronizar dados sensíveis (senhas de usuários)
  if (SENSITIVE_PREFIXES.some(prefix => key.startsWith(prefix))) return;
  supabase
    .from('kv_store')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .then(({ error }) => {
      if (error) console.warn('Sync error:', key, error.message);
    });
}

// Fire-and-forget delete a key from Supabase
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
