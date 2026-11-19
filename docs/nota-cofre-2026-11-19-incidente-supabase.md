---
projeto: FrostERP
data: 2026-11-19
tipo: incidente
---

# Incidente — login falhando e "permission denied" no kv_store

## Resultado
- Causa: o projeto Supabase `frostapp2.0` ficou **pausado de 31/10 a 19/11**. Ele foi restaurado hoje às ~18:39 UTC, e o Postgres reiniciou 3 vezes até ficar estável às 18:44:50. Hoje o status é `ACTIVE_HEALTHY`.
- Na volta, a sessão guardada no navegador já não valia. O app gravava como `anon`, que não tem permissão no `kv_store`, e o servidor respondia 401. O app **descartava** essas gravações.
- Correção no código: a gravação recusada por falta de sessão agora entra na fila (outbox). O login envia essa fila antes de baixar os dados, e o download não sobrescreve o que ainda está na fila.
- 450/450 testes passando, build ok.

## Decisões
- Não devolvi ao `anon` a permissão no `kv_store`. O bloqueio é de propósito: o certo é o app esperar o login.
- `migrate-login` sem alteração. Todos os 3 usuários já estão no Supabase Auth, então o 401 dele só quer dizer "senha não confere".

## Pendências
- [ ] Logar de novo. Se aparecer "Senha incorreta", usar "Esqueci minha senha".
- [ ] Descobrir por que o projeto pausou (plano Free pausa por inatividade). Se for o caso, avaliar o plano Pro, porque um ERP em produção não pode pausar.
- [ ] Conferir nos aparelhos se há dados feitos entre 31/10 e 19/11 que não subiram.
- [ ] Segurança: tabelas com GRANT para `anon` (RLS ligada): `email_otps`, `ai_*`, `pos_venda_*`, `push_subscriptions`, backups `backup_*_2026*`. Revisar e apagar os backups antigos.
- [ ] Fazer merge da branch `claude/supabase-permissions-auth-4zt2y7` em main para a Vercel publicar.

## Links
- Branch: `claude/supabase-permissions-auth-4zt2y7`
- Wiki: `docs/wiki/concepts/supabase-sync.md` (seção "Escrita sem sessão (401) e projeto pausado")
