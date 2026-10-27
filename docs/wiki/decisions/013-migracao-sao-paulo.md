---
title: 013 — Migrar o Supabase para São Paulo (sa-east-1) — roteiro
type: decision
updated: 2026-10-27
sources: []
related:
  - 011-carga-pos-login.md
  - 012-multiempresa.md
  - ../concepts/migracoes-supabase.md
  - ../concepts/supabase-sync.md
code_refs:
  - vite.config.js#cspPlugin
  - src/sw.js
  - capacitor.config.ts
  - api/calendar.js
---

# 013 — Migrar o Supabase para São Paulo

**Status: planejado, não executado.** Decisão do Gabriel em 2026-10-27: deixar o roteiro pronto e
escolher a data depois.

## Por quê

- O projeto `frostapp2.0` (`rbwzhglsztmjvwrcydcy`) está em **us-east-2 (Ohio)**; os clientes estão no
  Pará. Nos logs de 2026-10-27, cada chamada do app levou **0,6–0,9 s** vista do celular em Altamira: o
  navegador faz um preflight CORS (`OPTIONS`) e depois a requisição, e as duas vão até Ohio.
- Um login faz de 3 a 6 chamadas em sequência (ver [[011-carga-pos-login]]). Em São Paulo, a ida e volta
  cai para algo em torno de 0,2–0,3 s por chamada **[estimativa — medir depois da migração]**.
- Não existe "mudar a região" de um projeto Supabase: cria-se um projeto novo na região certa e migra-se
  (doc oficial "Change Project Region" / "Migrating within Supabase"). O "Restaurar em novo projeto" do
  plano pago mantém a **mesma** região — não serve.

## Pré-requisitos

1. **Plano Pro na organização "Projetos Gabb"** (US$ 25/mês). Hoje é **Free**:
   - **sem backup automático** do banco de produção;
   - limite de **2 projetos ativos**, e já são 2 (`frostapp2.0` e `fintury-app`) — o projeto novo não cabe;
   - projeto Free pausa após 7 dias sem uso.
2. **Backup manual antes de qualquer passo** (e, enquanto estiver no Free, de tempos em tempos):
   ```bash
   # Docker Desktop aberto; senha do banco em Database → Settings (resetar se não souber)
   npx supabase db dump --db-url "postgresql://postgres.rbwzhglsztmjvwrcydcy:[SENHA]@aws-0-us-east-2.pooler.supabase.com:5432/postgres" -f roles.sql --role-only
   npx supabase db dump --db-url "[MESMA URL]" -f schema.sql
   npx supabase db dump --db-url "[MESMA URL]" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
   ```
   (Pegar a connection string exata em **Connect → Session pooler** no dashboard.) Guardar os 3 arquivos
   fora do computador. O `data.sql` leva os usuários do `auth.users` com as senhas (hash) preservadas.
3. **Valores dos segredos das Edge Functions** à mão — o dashboard não mostra o valor depois de salvo:
   `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `RESEND_API_KEY`, `EVOLUTION_APIKEY`, `EVOLUTION_GLOBAL_KEY`,
   `EVOLUTION_API_URL`, `INTERNAL_FUNCTION_SECRET`, `WEBHOOK_TOKEN`, `DISPATCH_KEY`, `DEBOUNCE_SECONDS`,
   `AUTO_RESUME_HOURS` (+ os da `send-push`, ex.: chaves VAPID). Chave de API perdida pode ser gerada de
   novo no painel do fornecedor; os segredos internos (`INTERNAL_FUNCTION_SECRET`, `WEBHOOK_TOKEN`,
   `DISPATCH_KEY`) podem ser novos, desde que atualizados em todo lugar que os usa (abaixo).
4. **Janela de manutenção** combinada com o cliente (noite ou domingo, 1–2 h).

## Inventário (medido em 2026-10-27)

| Item | Hoje | Como migra |
|---|---|---|
| Banco | 51 MB; 27 tabelas em `public` (`kv_store` 27,6 mil linhas, `ai_messages` 5,8 mil, `whatsapp_processed_messages` 6,7 mil) | dump/restore (CLI + psql) |
| Tabelas de backup antigas | `_backup_dedup_*`, `backup_*_20260523`, `kv_store_backup_*`, `kv_finance_dup_removed_20260518` | decidir: levar ou deixar para trás |
| Usuários | 3 em `auth.users`, 0 fatores de 2FA | no `data.sql` (todos precisam entrar de novo: o segredo JWT muda) |
| Arquivos | 7 buckets (`os-fotos`, `os-assinaturas`, `ai-media`, `escola-oficios`, `escola-anexos`, `ponto-fotos`, `ponto-docs`), 191 arquivos, 36 MB, todos privados | script oficial de cópia de Storage (doc "Backup and Restore using the CLI") |
| URLs gravadas com o domínio antigo | 185 em `ai_messages.media_url` (`…/object/public/ai-media/…`) | `replace()` do domínio depois da cópia (o caminho não muda) |
| Edge Functions | 25 publicadas: 22 no repo + **`migrate-login`, `send-push`, `groq-check` só no projeto** | `supabase functions download <nome>` antes; depois `deploy` no novo |
| Vault | `lembrete_dispatch_key`, `pos_venda_dispatch_key` | recriar (a criptografia é por projeto) |
| Cron (`pg_cron`) | `lembrete-dispatch-15min`, `pos-venda-dispatch` — URL do projeto no comando | recriar com a URL nova |
| Realtime | publicação: `kv_store`, `ai_conversations`, `ai_messages`, `ai_os_proposals`, `master_users` | reativar no projeto novo |
| Extensões | `pg_cron`, `pg_net`, `pgcrypto`, `supabase_vault`, `uuid-ossp`, `pg_stat_statements`, `hypopg`, `index_advisor` | habilitar **antes** do restore |
| Auth | Site URL, Redirect URLs (`https://app.frosterp.com.br/*`), templates de email pt-BR (convite, reset), SMTP se houver | copiar no dashboard |
| Vercel (app) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | trocar + redeploy |
| Vercel (`api/calendar.js`) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `DISPATCH_KEY`, `CRON_SECRET` | trocar + redeploy |
| Evolution API | webhook da instância → `…/functions/v1/whatsapp-webhook?token=…` | apontar para a URL nova |
| APK Android | URL e chave embutidas no build | gerar APK novo, se houver aparelho com APK instalado |

## Roteiro

### D-7 a D-1 — preparação (sem afetar o cliente)

1. Assinar o Pro. Criar o projeto **`frosterp-br` em South America (São Paulo)**, Postgres 17.
2. Habilitar as extensões da tabela acima no projeto novo.
3. `npx supabase functions download migrate-login --project-ref rbwzhglsztmjvwrcydcy` (idem `send-push`,
   `groq-check`) e commitar no repo.
4. **Atualização imediata do app** (PWA): hoje o service worker novo espera todas as abas fecharem, então
   o cliente só pega a versão nova na 2ª abertura. Antes da migração, publicar uma versão que ative o SW
   novo na hora e recarregue (ou mostre "Nova versão — atualizar"); senão, no dia D, aparelhos com a versão
   velha continuam chamando o projeto antigo.
5. **Ensaio completo** com o backup do item 2 dos pré-requisitos: restaurar no projeto novo, copiar os
   arquivos e abrir um *preview* da Vercel com as envs novas. Logar, abrir OS, foto, Financeiro. Anotar o
   tempo de cada passo.

### Dia D — janela de manutenção

1. Avisar os usuários; ninguém usa o app durante a janela.
2. No projeto antigo: `select cron.unschedule('lembrete-dispatch-15min'); select cron.unschedule('pos-venda-dispatch');`
   e desligar o webhook na Evolution (mensagem que chegar na janela não é processada; aceitar ou pausar a instância).
3. Dump final (os 3 comandos dos pré-requisitos).
4. Restore no projeto novo (doc oficial):
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "[CONNECTION STRING DO PROJETO NOVO]"
   ```
5. **Fase 2 do multiempresa direto no projeto novo** ([[012-multiempresa]]): trocar a PK do `kv_store` para
   `(company_id, key)`. Todos os aparelhos vão chegar com a versão nova do app, então é a hora mais segura.
6. Copiar os arquivos (script de Storage da doc oficial, com as chaves service role dos dois projetos).
7. `update ai_messages set media_url = replace(media_url, 'rbwzhglsztmjvwrcydcy.supabase.co', '<novo-ref>.supabase.co') where media_url like '%rbwzhglsztmjvwrcydcy%';`
8. Recriar os segredos do Vault e os 2 jobs de cron com a URL nova.
9. Reativar a publicação do Realtime nas 5 tabelas.
10. Auth no dashboard: Site URL, Redirect URLs, templates, SMTP, MFA.
11. Edge Functions: `npx supabase functions deploy --project-ref <novo-ref> --use-api` (todas) +
    `npx supabase secrets set --project-ref <novo-ref> CHAVE=valor …`. Funções com `verify_jwt=false` no
    projeto atual (`migrate-login`, `master-login`, `pos-venda-dispatch`, `whatsapp-webhook`, `send-email`,
    `frost-*`, `lembrete-dispatch`, `master-companies`, `evolution-manage`, `demo-lead`) precisam do
    `--no-verify-jwt`.
12. Vercel: trocar as envs (app e `api/`), redeploy. Atualizar o `project-ref` dos scripts `deploy:*` do
    `package.json`.
13. Evolution: webhook → URL nova da `whatsapp-webhook` (com o `WEBHOOK_TOKEN` novo, se mudou).
14. **Conferência**: login de cada papel, Dashboard, criar e finalizar uma OS com foto e assinatura,
    Financeiro, Ponto, mensagem de WhatsApp ida e volta (IA responde), um disparo manual de lembrete,
    calendário iCal. Medir o tempo do login nos logs de borda do projeto novo.

### Depois

- **Projeto antigo pausado, não apagado, por 30 dias.** Só então apagar.
- Reversão (se algo falhar na janela): voltar as envs da Vercel para o projeto antigo + redeploy, reativar
  os 2 jobs de cron e o webhook da Evolution. O projeto antigo continua intacto até ser pausado.
- APK: novo build com `npm run android:sync` + distribuição, se houver aparelhos com APK.
- Atualizar `CLAUDE.md` (project ref), `docs/wiki/concepts/migracoes-supabase.md` e este documento.

## Custo e esforço [estimativa]

- Pro: US$ 25/mês; durante a sobreposição, o 2º projeto cobra compute por hora (poucos dólares).
- Preparação + ensaio: meio dia. Janela: 1–2 h.
