# Design — Travamento por aparelho + Servidor/Terminais

**Data:** 2026-07-22
**Escopo:** Mudança #1 de 2 (a #2, "pagamento parcial com prazo no financeiro", terá seu próprio spec).
**Objetivo de negócio:** poder **vender** o app com licenciamento por máquina — cada usuário só consegue operar no aparelho físico ao qual foi vinculado, com controle total nas mãos do superadmin (vendedor).

---

## 1. Resumo

Cada membro de uma empresa (Servidor ou Terminal) fica preso a **exatamente um aparelho** aprovado pelo **superadmin** (camada Master). O vínculo é provado por **criptografia ancorada em hardware** (chave não-exportável), e revalidado no servidor a cada acesso via **RLS total**. Sem aparelho aprovado e provado, o app não carrega e o banco não retorna dado nenhum.

Simultaneamente, renomeamos a terminologia de exibição: o admin principal passa a se chamar **Servidor** e os demais membros, **Terminais** — sem alterar papéis/permissões internos.

## 2. Decisões travadas (do brainstorming)

| Tema | Decisão |
|------|---------|
| Plataformas | Android (APK) + Web/PWA |
| Autoridade sobre vínculos | **Somente o superadmin** (Master tier). O Servidor/admin da empresa **não** mexe em vínculo nenhum. |
| Primeiro vínculo | Superadmin **aprova cada aparelho antes** de liberar (login → pendente → aprovação → libera). |
| Abrangência da trava | **Todos** os membros, incluindo o Servidor. |
| Cardinalidade | **Estrito 1:1** — 1 usuário = 1 aparelho, 1 aparelho = 1 usuário. |
| Nível de bloqueio | Máximo: portão no app + RLS total + sessão amarrada ao aparelho + chave de hardware. |
| Brecha do web | Aceita web forte **exigindo passkey de dispositivo** (rejeitar passkey sincronizada quando detectável). |
| Migração no rollout | **Superadmin aprova todo mundo do zero** (sem grandfather; todos pendentes ao subir). |
| Terminologia | Servidor = admin principal (1 por empresa); Terminais = demais membros. Só exibição. |

## 3. Limites honestos (o que "impenetrável" significa)

- **Android:** praticamente impenetrável. A chave vive no **Android Keystore (StrongBox quando disponível)**, é não-exportável e isolada em hardware; copiar storage não adianta. Reforçado por detecção de root/emulador.
- **Web:** muito forte, não absoluto. A chave é uma **passkey de plataforma (WebAuthn)** no TPM/Secure Enclave, não copiável. Ressalva residual: passkeys **sincronizadas** (iCloud/Google) podem roamear — mitigado exigindo credencial de plataforma e rejeitando sincronizadas quando a attestation permitir detectar. Sem attestation confiável, tratamos como device-bound mas registramos para auditoria.

## 4. Terminologia Servidor/Terminais

- **Camada puramente de exibição.** Papéis internos (`admin`, `gerente`, `tecnico`, `atendente`), `ROLE_PERMISSIONS` e `hasPermission()` **não mudam**.
- **Servidor** = o admin principal da empresa (exatamente 1). Definição: o admin designado como principal da empresa (o bootstrap admin). Admins secundários, se existirem, contam como Terminal para fins de exibição.
- **Terminais** = todos os demais membros.
- Substituir os textos "Usuário"/"Usuários" por "Servidor"/"Terminal"/"Terminais" nos pontos de UI que se referem a membros (ex.: `UserManagement`, dashboards, telas de contagem). Um helper central de rótulo evita espalhar strings.

## 5. Identidade e prova do aparelho

Conceito único nos dois ambientes: **registrar uma chave pública do aparelho** (no cadastro/aprovação) e **provar posse** assinando um desafio do servidor a cada login e a cada renovação de sessão.

### 5.1 Android
- Plugin Capacitor **nativo customizado** (peça de maior custo) que:
  - Gera par de chaves EC no Android Keystore, `setIsStrongBoxBacked(true)` quando disponível, não-exportável.
  - Expõe: `getOrCreateDeviceKey()`, `getPublicKey()`, `signChallenge(nonce)`.
  - Fornece sinais de integridade: root/emulador/`isDeviceSecure`.
- UUID de exibição em `@capacitor/preferences`; modelo/plataforma via `@capacitor/device` (adicionar dependência).

### 5.2 Web/PWA
- **WebAuthn**: `navigator.credentials.create()` com `authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' }` e `attestation: 'direct'`.
- Rejeitar credencial sincronizada quando a attestation/flags indicarem (`BE`/`BS` backup flags). Sem sinal confiável → aceitar como device-bound e marcar `attestation_uncertain` para auditoria.
- Prova de posse: `navigator.credentials.get()` assinando o desafio.

### 5.3 Impressão (apenas auditoria/exibição)
`{ device_uuid, platform, model, os_version, first_seen, last_seen }` — mostrado no painel do superadmin. Nunca é base de segurança sozinho; a segurança vem da chave de hardware.

## 6. Modelo de dados (Supabase)

Novas tabelas (nomes propostos):

- **`member_devices`** — o vínculo (1 ativo por membro):
  - `id`, `company_id`, `member_user_id` (→ `company_members.user_id`), `status` (`pending` | `approved` | `rejected` | `revoked`),
  - `platform` (`android` | `web`), `public_key` (COSE/DER), `credential_id` (WebAuthn) ou `keystore_alias` (Android),
  - `attestation_uncertain` (bool), `fingerprint` (jsonb da impressão),
  - `approved_by` (→ `master_users`), `approved_at`, `created_at`, `updated_at`.
  - Restrição: no máximo **um** `status='approved'` por `member_user_id` (índice único parcial). Reflete o 1:1.
- **`device_sessions`** — prova de posse viva, curta:
  - `id`, `member_user_id`, `device_id` (→ `member_devices.id`), `auth_session_id` (do JWT), `expires_at`, `created_at`.
  - TTL curto (ex.: 15 min); renovado a cada prova.
- **`device_challenges`** — nonces anti-replay:
  - `id`, `member_user_id`, `nonce`, `purpose` (`enroll` | `verify`), `expires_at`, `consumed_at`.

Ajuste em `company_members`: coluna opcional `is_primary_admin` (bool) para identificar o **Servidor**, se ainda não houver forma canônica.

## 7. Edge Functions (Deno)

Todas seguem os padrões existentes (CORS, service_role, validação de caller).

- **`device-enroll`** (verify_jwt = true): recebe chave pública + impressão do membro autenticado; cria/atualiza `member_devices` como `pending`. Se o membro já tem aparelho `approved` diferente → cria pendente e sinaliza "troca" (não libera).
- **`device-challenge`** (verify_jwt = true): emite nonce em `device_challenges`.
- **`device-verify`** (verify_jwt = true): recebe assinatura do nonce; valida contra o `public_key` do aparelho `approved` do membro; se ok, grava `device_sessions` (liga ao `auth_session_id`); retorna `approved` | `pending` | `denied`.
- **`master-devices`** (verify_jwt = false; auth via `master_users.session_token_hash`, igual `master-companies`): `list` (pendentes/aprovados por empresa), `approve`, `reject`, `revoke`, `reassign`. Só o superadmin.

## 8. Bloqueio impenetrável (A + B + C)

- **A — Portão no app:** no boot, após `signInWithFallback`, o app roda o fluxo de prova (challenge→sign→verify). Estados de tela: `pending` ("Aguardando aprovação do aparelho"), `denied` ("Aparelho não autorizado. Fale com o administrador."), `approved` (carrega ERP). UX apenas — não é a defesa.
- **B — RLS total:** função `public.current_device_ok()` retorna true apenas se existir `device_sessions` válido (não expirado) para `auth.uid()` no aparelho `approved`. Adicionar `AND public.current_device_ok()` às policies de **todas** as tabelas de dados: `kv_store`, `ai_agent_config`, `ai_conversations`, `ai_messages`, `ai_os_proposals`, `pos_venda_config`, `pos_venda_mensagens`, `pos_venda_optout`, `lembrete_config`, `lembrete_enviado`, `whatsapp_processed_messages`, `push_subscriptions`, e tabelas de ponto/escola. `companies`/`company_members`/`master_users`/`email_otps`/`device_*` seguem regras próprias (necessárias antes da prova).
- **C — Sessão amarrada ao aparelho:** a sessão só é "utilizável" após `device-verify` gravar `device_sessions`. O app re-prova ao abrir e a cada refresh de sessão. `device_sessions` liga ao `auth_session_id` do JWT, então o registro não pode ser reaproveitado por outra sessão/máquina; expiração curta impede cópia útil do token.

## 9. Fluxos

### 9.1 Cadastro e primeira aprovação
1. Superadmin cria empresa/membros (fluxos atuais: `master-companies`, `admin-create-user`).
2. Membro loga (email+senha) na 1ª vez → app gera chave de hardware → `device-enroll` cria aparelho `pending`.
3. App mostra tela **pendente**; ERP não carrega; nenhum dado acessível (RLS nega).
4. Superadmin, no painel **"Aparelhos"** do `MasterApp`, vê pendências (empresa, membro, papel, plataforma, modelo, 1ª vez) → **Aprova/Rejeita**.
5. Aprovado → próximos logins: challenge→sign→`device-verify` → `device_sessions` → ERP carrega.

### 9.2 Login em outro aparelho (1:1)
- Nova chave → `device-enroll` como pendente; como já há `approved`, o app mostra **"Aparelho não autorizado"**. Só o superadmin desvincula o antigo (`revoke`) e aprova o novo (troca de aparelho).

### 9.3 Offline (Android)
- Após uma prova online bem-sucedida, guardar um "passe" assinado (pela chave de hardware) com validade curta, verificável **localmente**, permitindo uso offline por um período. Qualquer sincronização com o servidor exige prova online válida.

## 10. Migração / rollout

- **Sem grandfather.** Ao subir, ninguém tem `member_devices.approved`; todos caem em **pendente** no próximo login. O superadmin aprova cada aparelho no painel Master.
- Comunicar a janela de corte antes do deploy para evitar surpresa. (Como a base ainda é pequena/pré-venda, o volume de aprovações é gerenciável.)
- RLS entra junto com o deploy — não há estado intermediário em que dados fiquem acessíveis sem prova.

## 11. Testes

- **TDD** onde há lógica pura/servidor:
  - Verificação de assinatura (Android EC e WebAuthn) contra chave registrada; rejeição de assinatura inválida/replay (nonce consumido/expirado).
  - `current_device_ok()` e as policies de RLS (acesso negado sem `device_sessions`; concedido com sessão válida; negado após expiração).
  - Máquina de estados `pending`/`approved`/`rejected`/`revoked` e a regra 1:1 (índice único parcial).
  - Detecção/rejeição de passkey sincronizada (flags de backup).
  - `master-devices`: só superadmin aprova; caller não-master é negado.
- **Manual/E2E:** fluxo completo em Android real (StrongBox) e navegador (passkey de plataforma); tentativa de login em segundo aparelho.

## 12. Entrega em fases

1. **Schema + edges + painel superadmin** (`member_devices`, `device_sessions`, `device_challenges`; `device-enroll/challenge/verify`; `master-devices`; painel "Aparelhos" no `MasterApp`) — com prova ainda "soft" (não bloqueia) para validar o fluxo.
2. **Prova de hardware** (plugin Android Keystore + WebAuthn no web) substituindo a prova soft.
3. **RLS total** (`current_device_ok()` em todas as tabelas) — o bloqueio real entra aqui.
4. **Rename Servidor/Terminais** (camada de exibição).
5. **Offline pass + endurecimento** (root/emulador, attestation, expirações finas).

## 13. Riscos e mitigações

- **Plugin nativo Android** é o maior risco de esforço → isolar em fase própria, com fallback soft enquanto não pronto.
- **RLS total** toca em muitas policies → inventário completo de tabelas antes; testes de acesso por tabela; deploy atômico.
- **WebAuthn em WebView Android:** não usar WebAuthn no app Android (usar o plugin nativo); WebAuthn é só para o web/PWA.
- **Suporte a troca de aparelho** vira gargalo no superadmin → painel com busca e ação rápida `revoke`+`approve`.

## 14. Fora de escopo (deste spec)

- Mudança #2: pagamento parcial com prazo no financeiro (spec separado).
- Cobrança/billing automático de licenças (só o mecanismo de trava está aqui).
