// ATENÇÃO: este módulo usa `window.storage` (não é API nativa do browser).
// É um polyfill instalado em App.jsx (~linhas 328-349): aponta para localStorage
// quando disponível, ou para um Map em memória quando localStorage falha
// (modo privado, sandbox, cota cheia). App.jsx precisa ter rodado antes deste
// módulo acessar window.storage — o que é garantido pela ordem de imports do bundle.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cria o cliente Supabase apenas se as variáveis de ambiente estiverem disponíveis.
// O cliente persiste sessão automaticamente (localStorage) — após signIn, todas as
// chamadas levam o JWT do usuário e RLS no Postgres aplica isolamento por empresa.
export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

if (supabase) {
  console.log('%c[FrostERP] Supabase CONECTADO ✅', 'color: #22c55e; font-weight: bold');
} else {
  console.warn('[FrostERP] Supabase DESCONECTADO ❌ — variáveis de ambiente não encontradas. Rodando apenas local.');
}

// Chaves nunca sincronizadas (dados sensíveis estritamente locais).
// Usado para bloquear chaves inteiras. Para campos sensíveis dentro de
// objetos sincronizáveis (ex: erp:user:* precisa sincronizar nome/email/role
// mas NUNCA password/2FA), use sanitizeForSync() abaixo.
//
// master:user:* é local-only por design de seguranca: contas master concedem
// poder cross-tenant, entao nao podem ser portaveis via kv_store (qualquer
// admin da empresa que injetar uma master:user:hack no localStorage viraria
// super-admin). Mover criacao/auth de master pra uma Edge Function com claim
// JWT is_super_admin é o fix definitivo (TODO).
const SENSITIVE_PREFIXES = [
  'erp:autoBackup:', // backups locais — não duplicar no kv_store
  'master:user:',    // master mode é puramente local; nao sincroniza
];
function isSensitive(key) {
  return SENSITIVE_PREFIXES.some(prefix => key.startsWith(prefix));
}

// ─── Sanitização de campos sensíveis ANTES do sync ──────────────────────────
// Senhas (PBKDF2), tokens de sessão e secrets TOTP NUNCA devem sair do device.
// A linha 'erp:user:' precisa sincronizar metadados (nome, email, role, status)
// pra cross-device, mas o objeto bruto contém credenciais. Limpa aqui.
const USER_SECRET_FIELDS = ['password', 'sessionTokenHash', 'twoFactorSecret', 'twoFactorBackupCodes'];
function sanitizeForSync(key, value) {
  if (typeof value !== 'object' || value === null) return value;
  if (key.startsWith('erp:user:') || key.startsWith('master:user:')) {
    const cleaned = { ...value };
    USER_SECRET_FIELDS.forEach(f => { delete cleaned[f]; });
    return cleaned;
  }
  return value;
}

// ─── Estado de sessão (em memória + localStorage cache) ──────────────────────
// O company_id e o legacy_user_id vêm de public.company_members após o login.
// Toda mutação no kv_store precisa carregar o company_id (RLS exige).
let _currentMember = null;
const MEMBER_CACHE_KEY = 'frost_session_member';

export function getCurrentMember() {
  if (_currentMember) return _currentMember;
  try {
    const raw = localStorage.getItem(MEMBER_CACHE_KEY);
    if (raw) _currentMember = JSON.parse(raw);
  } catch { /* noop */ }
  return _currentMember;
}

export function setCurrentMember(member) {
  _currentMember = member || null;
  try {
    if (member) localStorage.setItem(MEMBER_CACHE_KEY, JSON.stringify(member));
    else localStorage.removeItem(MEMBER_CACHE_KEY);
  } catch { /* noop */ }
}

function getCompanyId() {
  return getCurrentMember()?.company_id || null;
}

// ─── Auth: login com fallback para migração de PBKDF2 legado ────────────────
// Fluxo: tenta signInWithPassword. Se 401, chama Edge Function migrate-login
// que valida contra o hash PBKDF2 antigo e cria o user em auth.users. Depois retenta.
export async function signInWithFallback(email, password) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  email = (email || '').trim().toLowerCase();
  // Tentativa direta primeiro (usuários já migrados)
  let { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error && data?.session) {
    return await _afterAuth(data.session);
  }
  // Tenta migração de usuário legado
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/migrate-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseKey },
      body: JSON.stringify({ email, password }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Erro mais semântico
      if (body.error === 'user_not_found') return { ok: false, error: 'Usuário não encontrado.' };
      if (body.error === 'invalid_password') return { ok: false, error: 'Senha incorreta.' };
      return { ok: false, error: body.error || 'Falha ao autenticar.' };
    }
    // Migração OK — retenta signIn
    const retry = await supabase.auth.signInWithPassword({ email, password });
    if (retry.error || !retry.data?.session) {
      return { ok: false, error: retry.error?.message || 'Sessão não estabelecida após migração.' };
    }
    return await _afterAuth(retry.data.session);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function _afterAuth(session) {
  // Carrega vínculo company_members do usuário autenticado
  const { data: member, error } = await supabase
    .from('company_members')
    .select('user_id, company_id, role, is_super_admin, legacy_user_id, custom_permissions, status, nome, avatar')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error || !member) {
    return { ok: false, error: 'Usuário sem vínculo com empresa. Contate o administrador.' };
  }
  if (member.status && member.status !== 'ativo') {
    await supabase.auth.signOut();
    return { ok: false, error: 'Usuário inativo.' };
  }
  setCurrentMember(member);
  return { ok: true, session, member };
}

export async function signOutSupabase() {
  setCurrentMember(null);
  if (supabase) await supabase.auth.signOut().catch(() => {});
}

// Restaura member após reload (a sessão persiste, mas o member state cai com a aba)
export async function ensureMemberLoaded() {
  if (!supabase) return null;
  if (getCurrentMember()) return getCurrentMember();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const result = await _afterAuth(session);
  return result.ok ? result.member : null;
}

// ─── Hydrate: Supabase é a fonte de verdade ──────────────────────────────────
// Só é eficaz após login (RLS bloqueia anon).
//
// IMPORTANTE: o REST API do Supabase trunca em 1000 rows por default. Para
// empresas com muitas OS/clientes/transações, isso causa perda de dados:
// keys reais no banco "desaparecem" no app e o passo de cleanup abaixo
// APAGAVA do localStorage tudo que não veio. Paginação resolve.
export async function hydrateFromSupabase() {
  if (!supabase) return;
  const companyId = getCompanyId();
  if (!companyId) return; // sem auth → nada a sincronizar
  try {
    // ─── Pagina via .range() em batches de 1000 até esgotar ─────────────────
    const PAGE = 1000;
    let allRows = [];
    let from = 0;
    let pagesFetched = 0;
    let pageError = null;
    // Limite de segurança — 50 páginas = 50k rows. Se passar disso, algo está errado.
    while (pagesFetched < 50) {
      const { data: page, error } = await supabase
        .from('kv_store')
        .select('key, value')
        .eq('company_id', companyId)
        .order('key', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) { pageError = error; break; }
      if (!page || page.length === 0) break;
      allRows = allRows.concat(page);
      pagesFetched++;
      if (page.length < PAGE) break; // última página
      from += PAGE;
    }
    if (pageError) {
      console.warn('Supabase hydrate error:', pageError.message);
      // Se pelo menos uma página veio, segue com o que tem. Se nenhuma, aborta
      // sem apagar local (evita perda de dados em falha de rede).
      if (allRows.length === 0) return;
    }
    const completou = !pageError; // só faz cleanup de keys locais se paginação foi 100% bem-sucedida
    const remoteKeys = new Set(allRows.map(row => row.key));

    // Apaga local apenas se tivemos certeza que pegamos TUDO remoto.
    // Senão poderíamos apagar local de keys que existem remoto mas não vieram.
    const keysToRemove = [];
    if (completou) {
      for (let i = 0; i < window.storage.length; i++) {
        const key = window.storage.key(i);
        if (!key || !key.startsWith('erp:')) continue;
        if (isSensitive(key)) continue;
        if (key === 'erp:seeded' || key === 'erp:lastBackup') continue;
        if (!remoteKeys.has(key)) keysToRemove.push(key);
      }
      keysToRemove.forEach(key => window.storage.removeItem(key));
    }

    if (allRows.length > 0) {
      // Pula chaves sensiveis ao escrever no local: ex master:user:* nao
      // pode ser sobrescrito pelo Supabase (so existe local, e pra evitar
      // que uma versao stripada do servidor apague o password do device).
      allRows.forEach((row) => {
        if (isSensitive(row.key)) return;
        window.storage.setItem(row.key, JSON.stringify(row.value));
      });
    }
    console.log(`Sync completo: ${allRows.length} chaves do Supabase em ${pagesFetched} página(s), ${keysToRemove.length} removidas localmente${completou ? '' : ' [INCOMPLETO — cleanup pulado por segurança]'}`);
  } catch (err) {
    console.warn('Supabase connection failed, using local data:', err.message);
  }
}

// ─── Upload em massa (usado em backup/restore) ───────────────────────────────
export async function uploadAllToSupabase() {
  if (!supabase) return;
  const companyId = getCompanyId();
  if (!companyId) {
    console.warn('uploadAllToSupabase: sem company_id (usuário não autenticado).');
    return;
  }
  try {
    const rows = [];
    for (let i = 0; i < window.storage.length; i++) {
      const key = window.storage.key(i);
      if (!key || !key.startsWith('erp:')) continue;
      if (isSensitive(key)) continue;
      const raw = window.storage.getItem(key);
      if (raw === null) continue;
      try {
        const parsed = JSON.parse(raw);
        rows.push({ key, value: sanitizeForSync(key, parsed), company_id: companyId, updated_at: new Date().toISOString() });
      } catch { /* skip */ }
    }
    if (rows.length === 0) return;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase.from('kv_store').upsert(batch, { onConflict: 'key' });
      if (error) console.warn('Upload batch error:', error.message);
    }
    console.log(`Uploaded ${rows.length} keys to Supabase`);
  } catch (err) {
    console.warn('Upload to Supabase failed:', err.message);
  }
}

// ─── Sync unitário (chamado por DB.set) ──────────────────────────────────────
// Sanitiza secrets de usuário antes do upsert — NUNCA enviar password/2FA pro Supabase.
export function syncToSupabase(key, value) {
  if (!supabase) return;
  if (isSensitive(key)) return;
  const companyId = getCompanyId();
  if (!companyId) return; // sem auth → fica só local; será uploaded no próximo login
  const safeValue = sanitizeForSync(key, value);
  supabase
    .from('kv_store')
    .upsert({ key, value: safeValue, company_id: companyId, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .then(({ error }) => {
      if (error) console.warn('Sync error:', key, error.message);
    });
}

// ─── Delete unitário (chamado por DB.delete) ─────────────────────────────────
export function deleteFromSupabase(key) {
  if (!supabase) return;
  const companyId = getCompanyId();
  if (!companyId) return;
  supabase
    .from('kv_store')
    .delete()
    .eq('key', key)
    .eq('company_id', companyId)
    .then(({ error }) => {
      if (error) console.warn('Delete sync error:', key, error.message);
    });
}

// ─── Admin: criar usuário (chama Edge Function admin-create-user) ────────────
// Usado quando admin cadastra um membro novo no app.
export async function adminCreateUser({ email, password, role, nome, avatar, legacy_user_id, custom_permissions, status }) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'Não autenticado.' };
  const resp = await fetch(`${supabaseUrl}/functions/v1/admin-create-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email, password, role, nome, avatar, legacy_user_id, custom_permissions, status }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, error: body.error || 'Falha ao criar usuário.' };
  return { ok: true, ...body };
}

// ─── Master users: sync via RPCs SECURITY DEFINER ───────────────────────────
// Acesso direto a master_users foi bloqueado para anon (RLS lockdown Phase 1).
// Toda interacao passa por RPCs com superficie reduzida:
//   - master_count(): conta masters (decide FirstMasterSetup vs MasterLogin)
//   - master_lookup_by_email(email): UMA linha para o flow de login
//   - master_list_authenticated(token_hash): lista geral pos-login
//   - master_upsert(...): permitido se nao ha master OU caller tem token valido
//   - master_set_session(...): renova session_token apos checkPassword OK
//   - master_delete_authenticated(...): exige token de master logado
// Caller_token_hash deve ser o sessionTokenHash do master JA autenticado.

function _mapMasterRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    nome: row.nome,
    password: row.password,
    role: row.role || 'master',
    sessionTokenHash: row.session_token_hash || null,
    createdAt: row.created_at,
  };
}

// Phase 2: login master 100% server-side via Edge Function.
// O hash PBKDF2 nunca chega ao cliente. Retorna:
//   { ok:true, sessionToken, master:{ id,email,nome,role,sessionTokenHash,createdAt } }
//   { ok:false, status, error }  // 401 invalid, 409 legacy_format_use_local, ...
// status 409 => formato legado (DJB2/base64): caller deve cair no fluxo local
// (lookupMasterByEmail + checkPassword) que faz re-hash automatico.
export async function masterLoginViaEdge(email, password) {
  if (!supabase) return { ok: false, status: 0, error: 'no_supabase' };
  try {
    const { data, error } = await supabase.functions.invoke('master-login', {
      body: { email: (email || '').trim().toLowerCase(), password },
    });
    if (error) {
      // FunctionsHttpError expõe o status; 401/409 são respostas válidas do fluxo
      const status = error?.context?.status || 0;
      let parsed = null;
      try { parsed = await error.context?.json?.(); } catch { /* sem corpo */ }
      return { ok: false, status, error: parsed?.error || error.message };
    }
    if (data?.ok) return data;
    return { ok: false, status: 401, error: data?.error || 'invalid_credentials' };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

export async function masterCountRemote() {
  if (!supabase) return 0;
  try {
    const { data, error } = await supabase.rpc('master_count');
    if (error) { console.warn('masterCountRemote:', error.message); return 0; }
    return Number(data) || 0;
  } catch (e) { console.warn('masterCountRemote falhou:', e.message); return 0; }
}

export async function lookupMasterByEmail(email) {
  if (!supabase || !email) return null;
  try {
    const { data, error } = await supabase.rpc('master_lookup_by_email', { p_email: email });
    if (error) { console.warn('lookupMasterByEmail:', error.message); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    return _mapMasterRow(row);
  } catch (e) { console.warn('lookupMasterByEmail falhou:', e.message); return null; }
}

// Substitui o antigo `listMastersRemote()`. Devolve lista SOMENTE se o caller
// apresentar um session_token_hash que bate com algum master existente.
// Sem token (ou token invalido), volta [] em silencio — UI continua usando cache local.
export async function listMastersAuthenticated(callerTokenHash) {
  if (!supabase || !callerTokenHash) return [];
  try {
    const { data, error } = await supabase.rpc('master_list_authenticated', {
      p_session_token_hash: callerTokenHash,
    });
    if (error) { console.warn('listMastersAuthenticated:', error.message); return []; }
    return (data || []).map(_mapMasterRow).filter(Boolean);
  } catch (e) { console.warn('listMastersAuthenticated falhou:', e.message); return []; }
}

// Backwards-compat: chamadas antigas a listMastersRemote() agora retornam []
// (acesso anon bloqueado). Mantido pra nao quebrar imports legados — call sites
// foram atualizados pra usar lookupMasterByEmail/listMastersAuthenticated.
export async function listMastersRemote() {
  return [];
}

// callerTokenHash: sessionTokenHash de um master JA autenticado. Para o caso
// especial do FirstMasterSetup (zero masters cadastrados), pode ser null —
// a propria RPC permite a primeira escrita quando o count e zero.
export async function upsertMasterRemote(master, callerTokenHash = null) {
  if (!supabase || !master?.id) return false;
  try {
    const { error } = await supabase.rpc('master_upsert', {
      p_id: master.id,
      p_email: (master.email || '').trim().toLowerCase(),
      p_nome: master.nome || '',
      p_password: master.password || '',
      p_role: master.role || 'master',
      p_session_token_hash: master.sessionTokenHash || null,
      p_caller_token_hash: callerTokenHash,
    });
    if (error) { console.warn('upsertMasterRemote:', error.message); return false; }
    return true;
  } catch (e) { console.warn('upsertMasterRemote falhou:', e.message); return false; }
}

// Renova session_token_hash apos checkPassword OK no client.
// Passa o hash atual de password como prova de autenticidade.
export async function setMasterSessionRemote(id, currentPasswordHash, newSessionTokenHash) {
  if (!supabase || !id) return false;
  try {
    const { error } = await supabase.rpc('master_set_session', {
      p_id: id,
      p_current_password_hash: currentPasswordHash,
      p_new_session_token_hash: newSessionTokenHash,
    });
    if (error) { console.warn('setMasterSessionRemote:', error.message); return false; }
    return true;
  } catch (e) { console.warn('setMasterSessionRemote falhou:', e.message); return false; }
}

export async function deleteMasterRemote(id, callerTokenHash) {
  if (!supabase || !id) return false;
  try {
    const { error } = await supabase.rpc('master_delete_authenticated', {
      p_id: id,
      p_caller_token_hash: callerTokenHash,
    });
    if (error) { console.warn('deleteMasterRemote:', error.message); return false; }
    return true;
  } catch (e) { console.warn('deleteMasterRemote falhou:', e.message); return false; }
}

// ─── Storage: upload/delete de fotos da OS ───────────────────────────────────
export async function uploadFotoOS(file, osId) {
  if (!supabase) return null;
  try {
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
    const { data } = supabase.storage.from('os-fotos').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.warn('Upload foto falhou:', err.message);
    return null;
  }
}

export async function deleteFotoOS(publicUrl) {
  if (!supabase || !publicUrl) return;
  try {
    const marker = '/os-fotos/';
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return;
    const path = publicUrl.slice(idx + marker.length);
    await supabase.storage.from('os-fotos').remove([path]);
  } catch (err) {
    console.warn('Delete foto falhou:', err.message);
  }
}

// ─── Realtime: escuta mudanças no Supabase e atualiza o local ────────────────
// O callback recebe { eventType, key } para que o consumidor possa fazer sync
// incremental (re-ler só a fatia afetada) em vez de recarregar tudo.
export function subscribeToChanges(onDataChanged) {
  if (!supabase) return () => {};
  const companyId = getCompanyId();
  if (!companyId) return () => {};
  const channel = supabase
    .channel(`kv_store_${companyId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'kv_store', filter: `company_id=eq.${companyId}` },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;
        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          if (newRow && newRow.key) {
            window.storage.setItem(newRow.key, JSON.stringify(newRow.value));
            if (onDataChanged) onDataChanged({ eventType, key: newRow.key });
          }
        } else if (eventType === 'DELETE') {
          if (oldRow && oldRow.key) {
            window.storage.removeItem(oldRow.key);
            if (onDataChanged) onDataChanged({ eventType, key: oldRow.key });
          }
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Realtime sync ativo (escopo: empresa)');
      }
    });
  return () => { supabase.removeChannel(channel); };
}
