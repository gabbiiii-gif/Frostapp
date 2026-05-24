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
    .select('user_id, company_id, role, is_super_admin, legacy_user_id, custom_permissions, status, nome, avatar, first_login_otp_done')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error || !member) {
    return { ok: false, error: 'Usuário sem vínculo com empresa. Contate o administrador.' };
  }
  // Fase 2.4: carrega flag require_first_login_otp da empresa pra LoginScreen
  // decidir se intercepta o login com tela de OTP. Falha aqui é não-bloqueante
  // (default false = OTP não exigido).
  try {
    const { data: company } = await supabase
      .from('companies')
      .select('id, require_first_login_otp')
      .eq('id', member.company_id)
      .maybeSingle();
    member.company_require_first_login_otp = !!company?.require_first_login_otp;
  } catch {
    member.company_require_first_login_otp = false;
  }
  // Fase 2.3: convidado que acabou de aceitar (definir senha + login) entra com
  // status='pendente'. Como autenticou com sucesso, promove para 'ativo'.
  // RLS bloqueia UPDATE direto pra não-admin, então chama RPC SECURITY DEFINER
  // que só promove a própria linha quando status='pendente'.
  if (member.status === 'pendente') {
    const { error: upErr } = await supabase.rpc('promote_self_member_to_ativo');
    if (!upErr) member.status = 'ativo';
    else console.error('promote_self_member_to_ativo:', upErr.message);
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

// ─── Recuperação de senha (Supabase Auth nativo) ────────────────────────────
// Fluxo:
// 1) Usuário clica "Esqueci minha senha" → requestPasswordReset(email)
//    → Supabase envia email com link tipo https://app/?type=recovery#access_token=...
// 2) Usuário clica link → app detecta hash recovery → mostra ResetPasswordScreen
// 3) Usuário define nova senha → updatePasswordWithRecoveryToken(novaSenha)
//    → Supabase Auth atualiza senha + retorna sessão.
// Importante: adicionar a URL do app em "Redirect URLs" em Supabase Auth →
// URL Configuration. Sem isso, o link redireciona pra fallback default.
export async function requestPasswordReset(email) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const emailNorm = (email || '').trim().toLowerCase();
    if (!emailNorm) return { ok: false, error: 'Informe o email.' };
    // redirectTo: URL absoluta do app (Supabase só aceita URLs listadas em Auth → Redirect URLs)
    const redirectTo = `${window.location.origin}/?type=recovery`;
    const { error } = await supabase.auth.resetPasswordForEmail(emailNorm, { redirectTo });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function updatePasswordWithRecoveryToken(newPassword) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true, user: data?.user || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Como o client é criado com detectSessionInUrl=false, o access_token/refresh_token
// que vêm no hash da URL (links de invite/recovery) NÃO são consumidos automaticamente.
// Esse helper extrai os tokens do hash e estabelece a sessão manualmente — sem isso,
// updatePasswordWithRecoveryToken falha com "Auth session missing".
// Retorna true se conseguiu setar sessão.
export async function consumeAuthHashSession() {
  if (!supabase || typeof window === 'undefined') return false;
  const hash = (window.location.hash || '').replace(/^#/, '');
  if (!hash) return false;
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return false;
  try {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      console.error('consumeAuthHashSession:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('consumeAuthHashSession:', err.message);
    return false;
  }
}

// Detecta se a URL atual veio do flow de recovery do Supabase
// (Supabase pode enviar como query ?type=recovery OU hash #type=recovery)
export function isRecoveryUrl() {
  if (typeof window === 'undefined') return false;
  const qs = new URLSearchParams(window.location.search);
  if (qs.get('type') === 'recovery') return true;
  const hash = window.location.hash || '';
  if (hash.includes('type=recovery')) return true;
  return false;
}

// Detecta se a URL veio do flow de convite (admin.auth.admin.inviteUserByEmail).
// Supabase usa o mesmo template recovery pra convite mas adiciona type=invite no
// link. Usado pelo top-level pra mostrar tela de "definir senha inicial" em vez
// de "redefinir senha".
export function isInviteUrl() {
  if (typeof window === 'undefined') return false;
  const qs = new URLSearchParams(window.location.search);
  if (qs.get('type') === 'invite') return true;
  const hash = window.location.hash || '';
  if (hash.includes('type=invite')) return true;
  return false;
}

// Remove os params/hash de recovery/invite após sucesso
export function clearRecoveryUrl() {
  if (typeof window === 'undefined') return;
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = '';
  window.history.replaceState({}, '', u.toString());
}

// ─── Admin: cria usuário da empresa (auth.users + company_members) ───────────
// Chama edge function admin-create-user (que usa service_role). O caller
// precisa estar autenticado e ser admin/gerente da company alvo.
// payload: { mode, email, password, nome, role, company_id, legacy_user_id,
//   custom_permissions, comissao_percentual, avatar }
// Retorna { ok, error?, auth_user_id? }.
export async function adminCreateUser(payload) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: 'Sessão expirada. Faça login novamente.' };
    const resp = await fetch(`${supabaseUrl}/functions/v1/admin-create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.ok) {
      return { ok: false, error: body.error || `HTTP ${resp.status}` };
    }
    return { ok: true, auth_user_id: body.auth_user_id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Email OTP no 1º login (Fase 2.4) ───────────────────────────────────────
// Dispara envio do código de 6 dígitos para o email do caller. Só funciona
// se a empresa do caller tiver require_first_login_otp=true E o member ainda
// não tiver first_login_otp_done=true. Caller precisa estar autenticado.
// Retorna { ok, expires_at?, retry_in?, error? }.
export async function sendFirstLoginOTP() {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: 'Sessão expirada.' };
    const resp = await fetch(`${supabaseUrl}/functions/v1/first-login-otp-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({}),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.ok) {
      return { ok: false, error: body.error || `HTTP ${resp.status}`, retry_in: body.retry_in };
    }
    return { ok: true, expires_at: body.expires_at };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Valida código informado pelo usuário. Sucesso: marca first_login_otp_done=true
// no banco — próximos logins pulam o passo de OTP. Retorna { ok, attempts_left?,
// locked?, error? }.
export async function verifyFirstLoginOTP(code) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: 'Sessão expirada.' };
    const resp = await fetch(`${supabaseUrl}/functions/v1/first-login-otp-verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ code }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.ok) {
      return {
        ok: false,
        error: body.error || `HTTP ${resp.status}`,
        attempts_left: body.attempts_left,
        locked: !!body.locked,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
// Retorna true SOMENTE se o hydrate remoto rodou de fato (Supabase ativo +
// sessão/companyId + pelo menos uma página lida). O init usa esse retorno como
// gate: sem hydrate real, NÃO semear catálogo (cache local vazio duplicaria o
// catálogo remoto a cada boot sem sessão).
export async function hydrateFromSupabase() {
  if (!supabase) return false;
  const companyId = getCompanyId();
  if (!companyId) return false; // sem auth → nada a sincronizar
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
      if (allRows.length === 0) return false;
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
    return true;
  } catch (err) {
    console.warn('Supabase connection failed, using local data:', err.message);
    return false;
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

// LOCKDOWN DE SEGURANÇA (ADR 009, 2026-05-19): a RPC `master_lookup_by_email`
// foi REVOGADA de anon/authenticated — ela vazava o hash PBKDF2 + session_token
// do master para qualquer um com a anon key (takeover não-autenticado). O fluxo
// de login master agora é 100% server-side via Edge Function `master-login`
// (masterLoginViaEdge), que valida com service_role e nunca devolve o hash.
// Esta função vira no-op proposital: retorna null para o caller cair no cache
// local (window.storage MASTER_PREFIX) quando o Edge não resolve (offline/legado).
export async function lookupMasterByEmail(_email) {
  return null;
}

// Substitui o antigo `listMastersRemote()`. Devolve lista SOMENTE se o caller
// apresentar um session_token_hash que bate com algum master existente.
// Sem token (ou token invalido), volta [] em silencio — UI continua usando cache local.
// LOCKDOWN DE SEGURANÇA (ADR 009): `master_list_authenticated` REVOGADA de
// anon/authenticated. Sem substituto client-side por design — listar masters
// não é operação de cliente. Retorna [] (UI usa cache local). Se precisar de
// gestão de masters server-side, criar Edge Function dedicada (service_role).
export async function listMastersAuthenticated(_callerTokenHash) {
  return [];
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
// LOCKDOWN DE SEGURANÇA (ADR 009): `master_upsert` REVOGADA de anon/authenticated
// — ela permitia criar/sobrescrever qualquer master (escalada para super-admin).
// Escrita em master_users agora só via service_role (Edge Function).
// Retorna false: o caller já trata como "local OK, remoto não sincronizou".
// TODO: mover criação de master (FirstMasterSetup) para uma Edge Function
// `master-create` para que o registro chegue ao banco e o login via Edge funcione.
export async function upsertMasterRemote(_master, _callerTokenHash = null) {
  return false;
}

// Renova session_token_hash apos checkPassword OK no client.
// Passa o hash atual de password como prova de autenticidade.
// LOCKDOWN DE SEGURANÇA (ADR 009): `master_set_session` REVOGADA. Era o elo
// final do takeover — aceitava o hash de senha como "prova" (e a RPC de lookup
// vazava esse hash). O Edge `master-login` já persiste session_token_hash no
// banco (service_role) a cada login bem-sucedido, então esta rotação manual
// client-side não é mais necessária.
export async function setMasterSessionRemote(_id, _currentPasswordHash, _newSessionTokenHash) {
  return false;
}

// LOCKDOWN DE SEGURANÇA (ADR 009): `master_delete_authenticated` REVOGADA de
// anon/authenticated. Exclusão de master agora só via service_role (Edge).
// Retorna false (no-op). TODO: Edge Function se gestão remota de master for
// necessária.
export async function deleteMasterRemote(_id, _callerTokenHash) {
  return false;
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

// ─── Storage: upload/delete de assinatura do cliente na OS ───────────────────
// Bucket: 'os-assinaturas' (público). Criar manualmente no Supabase Dashboard.
// Estrutura: {osId}/{timestamp}.png — uma assinatura por OS (sobrescreve).
export async function uploadAssinaturaOS(blob, osId) {
  if (!supabase) return null;
  try {
    const path = `${osId}/${Date.now()}.png`;
    const { error: upErr } = await supabase.storage
      .from('os-assinaturas')
      .upload(path, blob, { cacheControl: '3600', upsert: true, contentType: 'image/png' });
    if (upErr) {
      console.warn('Upload assinatura erro:', upErr.message);
      return null;
    }
    const { data } = supabase.storage.from('os-assinaturas').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.warn('Upload assinatura falhou:', err.message);
    return null;
  }
}

export async function deleteAssinaturaOS(publicUrl) {
  if (!supabase || !publicUrl) return;
  try {
    const marker = '/os-assinaturas/';
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return;
    const path = publicUrl.slice(idx + marker.length);
    await supabase.storage.from('os-assinaturas').remove([path]);
  } catch (err) {
    console.warn('Delete assinatura falhou:', err.message);
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
