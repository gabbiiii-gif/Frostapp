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

// ─── Gating de escrita por role (espelha private.kv_can_write no Postgres) ───
// O hardening de RLS (ADR 009) restringe QUEM pode escrever cada prefixo no
// kv_store por role. Se o client tentar sincronizar uma chave que o role do
// usuário não pode gravar, o Postgres rejeita com "new row violates row-level
// security policy" (código 42501) — e, pior, a antiga lógica reenfileirava a
// escrita na outbox, criando um poison-pill que retentava pra sempre.
//
// Esta função replica EXATAMENTE a policy server-side pra decidir, no client,
// se vale a pena tentar o upsert/delete. Chaves não-graváveis ficam local-only
// (mesmo tratamento de isSensitive). Mantenha em sincronia com kv_can_write.
function canWriteKey(key) {
  const role = getCurrentMember()?.role;
  if (!role) return true; // sem role conhecido: deixa o servidor decidir
  if (role === 'admin' || role === 'gerente') return true;
  if (role === 'cliente_escola') {
    return key.startsWith('erp:escola:') || key.startsWith('erp:evento_escola:');
  }
  if (role === 'ponto') {
    return key.startsWith('erp:ponto:') || key.startsWith('erp:jornada:') || key.startsWith('erp:ocorrencia:');
  }
  // Demais internos (técnico, atendente, …): tudo MENOS financeiro/segredos/config/user/employee.
  return !(
    key.startsWith('erp:finance:') ||
    key.startsWith('erp:transaction:') ||
    key.startsWith('erp:banking:') ||
    key.startsWith('erp:transferencia:') ||
    key.startsWith('erp:vale:') ||
    key.startsWith('erp:calendarFeedToken:') ||
    key.startsWith('erp:config:') ||
    key.startsWith('erp:user:') ||
    key.startsWith('erp:employee:')
  );
}

// Detecta erro de permissão/RLS do Postgres. Escritas que falham por isso NUNCA
// vão passar numa retentativa (não é falha transitória de rede), então não
// devem ir pra outbox — senão viram poison-pill.
function isPermissionError(error) {
  if (!error) return false;
  if (error.code === '42501') return true;
  return /row-level security|permission denied/i.test(error.message || '');
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
  // Fase 2.4/2.5: carrega flags da empresa pra LoginScreen decidir se
  // intercepta o login. Falha aqui é não-bloqueante (default false).
  try {
    const { data: company } = await supabase
      .from('companies')
      .select('id, require_first_login_otp, require_mfa')
      .eq('id', member.company_id)
      .maybeSingle();
    member.company_require_first_login_otp = !!company?.require_first_login_otp;
    member.company_require_mfa = !!company?.require_mfa;
  } catch {
    member.company_require_first_login_otp = false;
    member.company_require_mfa = false;
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
      // Forward reasons[] da edge function pra UI mostrar detalhe específico
      // (ex.: "Mínimo 12 caracteres" em vez de "weak_password" cryptic).
      return {
        ok: false,
        error: body.error || `HTTP ${resp.status}`,
        reasons: Array.isArray(body.reasons) ? body.reasons : null,
      };
    }
    return { ok: true, auth_user_id: body.auth_user_id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Traduz reasons[] da edge function pra pt-BR humano. Alinhado com
// validatePasswordStrength do utils.js.
export function passwordReasonToPtBr(reason) {
  const map = {
    min_12_chars: "Mínimo 12 caracteres",
    missing_lowercase: "Incluir letra minúscula",
    missing_uppercase: "Incluir letra maiúscula",
    missing_digit: "Incluir número",
    missing_symbol: "Incluir símbolo (!@#$...)",
    contains_whitespace: "Não pode conter espaço",
  };
  return map[reason] || reason;
}

// ─── Notificação por email quando OS criada (Fase 2.7) ──────────────────────
// Fire-and-forget POST pra edge function notify-os-created. Lê emails dos
// admin/gerente da empresa + técnico atribuído via service_role e dispara via
// send-email (Resend). Helper retorna promise mas chamadores não devem
// aguardar — falhas são silenciosas (caso edge function indisponível, a
// criação da OS no app não pode travar).
export async function notifyOsCreated(companyId, osData) {
  if (!supabase || !companyId || !osData) return { ok: false, error: 'params' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: 'no_session' };
    const resp = await fetch(`${supabaseUrl}/functions/v1/notify-os-created`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ companyId, osData }),
      keepalive: true,
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.ok) {
      return { ok: false, error: body.error || `HTTP ${resp.status}` };
    }
    return { ok: true, sent_to: body.sent_to, skipped: body.skipped };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Upload de anexo de ocorrência de ponto ─────────────────────────────────
// Sobe o arquivo no bucket privado `ponto-docs` (criado em
// supabase/migrations/2026_06_02_ponto_escola.sql) sob o path
// `<companyId>/<userId>/<timestamp>_<filename-saneado>`. A RLS isola por
// company_member (caller só vê arquivos da própria empresa).
//
// Retorno:
//   { ok: true, path, signedUrl? }   — caminho do bucket + URL temporária (1h)
//   { ok: false, error }
//
// Fallback offline: sem Supabase configurado retorna ok:false. A UI deve
// permitir prosseguir sem anexo apenas para tipos que não exigem documento.
export async function uploadOcorrenciaDoc(file, companyId, userId, opts = {}) {
  if (!supabase) return { ok: false, error: 'no_supabase' };
  if (!file || !companyId || !userId) return { ok: false, error: 'params' };
  try {
    // Sanitiza filename: remove espaços/caracteres especiais (evita conflito
    // com o path do Storage, que usa folders por separação de /).
    const raw = file.name || 'documento';
    const cleanName = raw.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
    const path = `${companyId}/${userId}/${Date.now()}_${cleanName}`;

    const { error: upErr } = await supabase
      .storage
      .from('ponto-docs')
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
    if (upErr) return { ok: false, error: upErr.message };

    // URL assinada de 1h para preview imediato (admin geralmente avalia logo
    // após o upload). Acessos posteriores buscam nova URL via getSignedUrl.
    let signedUrl;
    if (opts.signed !== false) {
      const { data } = await supabase
        .storage
        .from('ponto-docs')
        .createSignedUrl(path, 60 * 60);
      signedUrl = data?.signedUrl;
    }

    return { ok: true, path, signedUrl, filename: cleanName };
  } catch (err) {
    return { ok: false, error: err?.message || 'upload_failed' };
  }
}

// Devolve URL assinada para um path já existente em ponto-docs.
// Usado pelo admin ao abrir uma ocorrência para preview do anexo.
export async function getOcorrenciaDocUrl(path, ttlSeconds = 3600) {
  if (!supabase || !path) return null;
  try {
    const { data, error } = await supabase
      .storage
      .from('ponto-docs')
      .createSignedUrl(path, ttlSeconds);
    if (error) return null;
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}

// ─── Notificação de eventos do módulo Escola (Vanda) ────────────────────────
// Fire-and-forget POST pra edge function notify-escola-event. Dispara emails
// via send-email (Resend) conforme o evento:
//   criada     → equipe interna (admin/gerente/tecnico) + confirmação Vanda
//   concluida  → Vanda
//   cancelada  → Vanda
//   reaberta   → equipe interna
//   assumida   → (sem email — config futura)
//
// Falhas são silenciosas: a transição de status no client NÃO pode travar por
// causa de email indisponível. Caller passa fire-and-forget (sem await que
// bloqueie a UI), igual ao notifyOsCreated.
export async function notifyEscolaEvent(companyId, evento, demanda) {
  if (!supabase || !companyId || !evento || !demanda) {
    return { ok: false, error: 'params' };
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: 'no_session' };
    const resp = await fetch(`${supabaseUrl}/functions/v1/notify-escola-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ companyId, evento, demanda }),
      keepalive: true,
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.ok) {
      return { ok: false, error: body.error || `HTTP ${resp.status}` };
    }
    return {
      ok: true,
      sent_to: body.sent_to,
      total_recipients: body.total_recipients,
      skipped: body.skipped,
      errors: body.errors,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── 2FA via Supabase MFA built-in (Fase 2.5) ───────────────────────────────
// Refactor do 2FA TOTP: usa supabase.auth.mfa.* server-side em vez do
// generateTotpSecret/verifyTotp custom. Cross-device automaticamente (factors
// armazenados em auth.users), rate-limit e audit no servidor.

// Lista factors MFA do usuário logado. Retorna objeto Supabase nativo
// { all: [...], totp: [...], phone: [...] } ou null em caso de erro.
export async function listMfaFactors() {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.', factors: [] };
  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return { ok: false, error: error.message, factors: [] };
    return { ok: true, factors: data?.all || [], totp: data?.totp || [] };
  } catch (err) {
    return { ok: false, error: err.message, factors: [] };
  }
}

// Inicia enrollment de novo factor TOTP. Retorna { factorId, qr, secret, uri }.
// Após scanear QR, o caller precisa chamar challengeMfa + verifyMfa pra
// confirmar e ativar o factor.
export async function enrollMfaTotp(friendlyName) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const params = { factorType: 'totp' };
    if (friendlyName) params.friendlyName = friendlyName;
    const { data, error } = await supabase.auth.mfa.enroll(params);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      factorId: data.id,
      qr: data.totp?.qr_code,        // data URL pronto pra <img src>
      secret: data.totp?.secret,     // string base32 (chave manual)
      uri: data.totp?.uri,           // otpauth:// URI bruta
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Dispara um desafio MFA pro factor informado. Retorna challengeId que deve
// ser passado pro verifyMfaChallenge junto com o código de 6 dígitos.
export async function challengeMfa(factorId) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId });
    if (error) return { ok: false, error: error.message };
    return { ok: true, challengeId: data.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Valida código TOTP. Usado tanto pra finalizar enrollment quanto pra elevar
// AAL durante o login.
export async function verifyMfaChallenge(factorId, challengeId, code) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, session: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Atalho: enrolling de factor já gera challenge implícito. Esse helper combina
// challenge + verify pra reduzir round-trips na UI de enrollment.
export async function challengeAndVerifyMfa(factorId, code) {
  const ch = await challengeMfa(factorId);
  if (!ch.ok) return ch;
  return verifyMfaChallenge(factorId, ch.challengeId, code);
}

// Remove (unenroll) factor MFA do usuário logado. Usuário pode desativar
// próprio 2FA. Pra resetar 2FA de OUTRO usuário (técnico que perdeu celular),
// use adminRemoveUserMfa.
export async function unenrollMfa(factorId) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Chama edge function admin-remove-user-mfa (service_role) pra apagar todos os
// factors do user alvo. Caller precisa ser admin/gerente da mesma company.
export async function adminRemoveUserMfa(targetUserId) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: 'Sessão expirada.' };
    const resp = await fetch(`${supabaseUrl}/functions/v1/admin-remove-user-mfa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ user_id: targetUserId }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.ok) {
      return { ok: false, error: body.error || `HTTP ${resp.status}` };
    }
    return { ok: true, removed: body.removed };
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
        // Não apaga chave ainda pendente de envio (feita offline) — senão um
        // registro de ponto criado sem rede seria perdido antes de sincronizar.
        if (!remoteKeys.has(key) && !outboxHasKey(key)) keysToRemove.push(key);
      }
      keysToRemove.forEach(key => window.storage.removeItem(key));
    }

    if (allRows.length > 0) {
      // Pula chaves sensiveis ao escrever no local: ex master:user:* nao
      // pode ser sobrescrito pelo Supabase (so existe local, e pra evitar
      // que uma versao stripada do servidor apague o password do device).
      allRows.forEach((row) => {
        if (isSensitive(row.key)) return;
        let value = row.value;
        // erp:user:* sobe SEM segredos (sanitizeForSync remove password,
        // sessionTokenHash, 2FA). Ao hidratar, preserva esses campos da cópia
        // LOCAL — senão o hydrate apaga o sessionTokenHash e a sessão cai a cada
        // reload (a restauração compara savedUser.sessionTokenHash === hash).
        if (value && typeof value === 'object' && row.key.startsWith('erp:user:')) {
          try {
            const localRaw = window.storage.getItem(row.key);
            if (localRaw) {
              const local = JSON.parse(localRaw);
              const preserved = {};
              USER_SECRET_FIELDS.forEach((f) => { if (local[f] !== undefined) preserved[f] = local[f]; });
              value = { ...value, ...preserved };
            }
          } catch { /* mantém value remoto puro */ }
        }
        window.storage.setItem(row.key, JSON.stringify(value));
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
      if (!canWriteKey(key)) continue; // role sem permissão → fora do batch (RLS rejeitaria o upsert inteiro)
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
// ─── Outbox offline ──────────────────────────────────────────────────────────
// Fila persistente de escritas que falharam por falta de rede. Cada item:
// { op:'set'|'del', key, value? }. Dedupe por key (mantém a última). É esvaziada
// no evento 'online' e no boot (antes do hydrate). hydrateFromSupabase preserva
// chaves ainda na fila — senão um registro feito offline (ex.: ponto) seria
// apagado pela limpeza do hydrate antes de chegar ao servidor.
const OUTBOX_KEY = 'erp:syncOutbox';
// Pub/sub: notifica a UI (indicador "X aguardando envio") quando a fila muda.
const _outboxListeners = new Set();
export function onOutboxChange(cb) {
  _outboxListeners.add(cb);
  return () => _outboxListeners.delete(cb);
}
function _notifyOutbox(n) {
  _outboxListeners.forEach((cb) => { try { cb(n); } catch { /* noop */ } });
}
function _loadOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; }
}
function _saveOutbox(arr) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(arr)); } catch { /* noop */ }
  _notifyOutbox(arr.length);
}
function enqueueOutbox(op, key, value) {
  if (isSensitive(key)) return;
  const arr = _loadOutbox().filter((e) => e.key !== key);
  arr.push(op === 'del' ? { op, key } : { op, key, value });
  _saveOutbox(arr);
}
// Usada pelo hydrate pra NÃO apagar chaves locais ainda pendentes de envio.
export function outboxHasKey(key) {
  return _loadOutbox().some((e) => e.key === key);
}
export function outboxSize() { return _loadOutbox().length; }

let _flushing = false;
// Reenvia a fila ao servidor. Chamada no boot e no evento 'online'.
export async function flushOutbox() {
  if (_flushing || !supabase) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const companyId = getCompanyId();
  if (!companyId) return;
  const arr = _loadOutbox();
  if (arr.length === 0) return;
  _flushing = true;
  const remaining = [];
  for (const e of arr) {
    // Limpa poison-pills: chaves que o role não pode gravar (RLS) nunca vão
    // passar — descarta da fila em vez de retentar pra sempre.
    if (!canWriteKey(e.key)) continue;
    try {
      if (e.op === 'del') {
        const { error } = await supabase.from('kv_store').delete().eq('key', e.key).eq('company_id', companyId);
        if (error && !isPermissionError(error)) remaining.push(e);
      } else {
        const safeValue = sanitizeForSync(e.key, e.value);
        const { error } = await supabase.from('kv_store').upsert({ key: e.key, value: safeValue, company_id: companyId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error && !isPermissionError(error)) remaining.push(e);
      }
    } catch { remaining.push(e); }
  }
  _saveOutbox(remaining);
  _flushing = false;
}

if (typeof window !== 'undefined') {
  // Ao reconectar, tenta esvaziar a fila automaticamente.
  window.addEventListener('online', () => { flushOutbox(); });
}

export function syncToSupabase(key, value) {
  if (!supabase) return;
  if (isSensitive(key)) return;
  // Role do usuário não pode gravar esta chave (RLS) → fica local-only, sem
  // tentar (evita erro 42501 e poison-pill na outbox).
  if (!canWriteKey(key)) return;
  const companyId = getCompanyId();
  if (!companyId) return; // sem auth → fica só local; será uploaded no próximo login
  // Offline: enfileira direto sem tentar (evita erro de rede e garante reenvio).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueueOutbox('set', key, value);
    return;
  }
  const safeValue = sanitizeForSync(key, value);
  supabase
    .from('kv_store')
    .upsert({ key, value: safeValue, company_id: companyId, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .then(({ error }) => {
      if (error) {
        console.warn('Sync error:', key, error.message);
        // Erro de RLS/permissão não some em retry → descarta (não vira poison-pill).
        if (!isPermissionError(error)) enqueueOutbox('set', key, value);
      }
    }, () => enqueueOutbox('set', key, value)); // rejeição (rede) → fila
}

// ─── Delete unitário (chamado por DB.delete) ─────────────────────────────────
export function deleteFromSupabase(key) {
  if (!supabase) return;
  if (!canWriteKey(key)) return; // role sem permissão de gravar essa chave → no-op
  const companyId = getCompanyId();
  if (!companyId) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueueOutbox('del', key);
    return;
  }
  supabase
    .from('kv_store')
    .delete()
    .eq('key', key)
    .eq('company_id', companyId)
    .then(({ error }) => {
      if (error) {
        console.warn('Delete sync error:', key, error.message);
        if (!isPermissionError(error)) enqueueOutbox('del', key);
      }
    }, () => enqueueOutbox('del', key));
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

// ─── Storage: upload/delete de fotos e assinaturas da OS ─────────────────────
// HARDENING C0-2: buckets 'os-fotos' e 'os-assinaturas' passam a ser PRIVADOS.
// Antes eram públicos: qualquer um com a URL lia foto/assinatura/CPF do cliente
// (vazamento de PII) e qualquer usuário autenticado apagava arquivo de outra
// empresa (sem escopo de pasta). Agora:
//   1. Path escopado por empresa: `${companyId}/${osId}/...` → a RLS do Storage
//      isola por pasta (foldername[1] = company_id), igual a ponto-docs.
//   2. Acesso por signed URL de TTL longo (não há mais leitura pública por path);
//      as URLs ficam embutidas nos documentos de OS/recibo gerados sob demanda.
// IMPORTANTE: privatizar os buckets e aplicar a RLS de pasta SÓ pode ocorrer
// JUNTO com o deploy deste código (ver migração harden_os_storage_buckets).
const SIGNED_URL_TTL = 60 * 60 * 24 * 365 * 5; // ~5 anos

export async function uploadFotoOS(file, osId) {
  if (!supabase) return null;
  const companyId = getCompanyId();
  if (!companyId) { console.warn('uploadFotoOS: sem company_id (usuário não autenticado).'); return null; }
  try {
    const ext = (file.name || 'foto.jpg').split('.').pop();
    const ts = Date.now();
    const path = `${companyId}/${osId}/${ts}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('os-fotos')
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
    if (upErr) {
      console.warn('Upload foto erro:', upErr.message);
      return null;
    }
    const { data, error: signErr } = await supabase.storage.from('os-fotos').createSignedUrl(path, SIGNED_URL_TTL);
    if (signErr) {
      console.warn('Signed URL foto erro:', signErr.message);
      return null;
    }
    return data?.signedUrl || null;
  } catch (err) {
    console.warn('Upload foto falhou:', err.message);
    return null;
  }
}

export async function deleteFotoOS(url) {
  if (!supabase || !url) return;
  try {
    const marker = '/os-fotos/';
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    // Remove a querystring (?token=...) das signed URLs antes de extrair o path.
    const path = url.slice(idx + marker.length).split('?')[0];
    await supabase.storage.from('os-fotos').remove([path]);
  } catch (err) {
    console.warn('Delete foto falhou:', err.message);
  }
}

// Assinatura do cliente na OS. Bucket PRIVADO 'os-assinaturas'.
// Estrutura: {companyId}/{osId}/{timestamp}.png — uma assinatura por OS (sobrescreve).
export async function uploadAssinaturaOS(blob, osId) {
  if (!supabase) return null;
  const companyId = getCompanyId();
  if (!companyId) { console.warn('uploadAssinaturaOS: sem company_id (usuário não autenticado).'); return null; }
  try {
    const path = `${companyId}/${osId}/${Date.now()}.png`;
    const { error: upErr } = await supabase.storage
      .from('os-assinaturas')
      .upload(path, blob, { cacheControl: '3600', upsert: true, contentType: 'image/png' });
    if (upErr) {
      console.warn('Upload assinatura erro:', upErr.message);
      return null;
    }
    const { data, error: signErr } = await supabase.storage.from('os-assinaturas').createSignedUrl(path, SIGNED_URL_TTL);
    if (signErr) {
      console.warn('Signed URL assinatura erro:', signErr.message);
      return null;
    }
    return data?.signedUrl || null;
  } catch (err) {
    console.warn('Upload assinatura falhou:', err.message);
    return null;
  }
}

export async function deleteAssinaturaOS(url) {
  if (!supabase || !url) return;
  try {
    const marker = '/os-assinaturas/';
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    // Remove a querystring (?token=...) das signed URLs antes de extrair o path.
    const path = url.slice(idx + marker.length).split('?')[0];
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
