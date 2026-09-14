---
title: Migrações Supabase — o histórico remoto NÃO bate com os arquivos locais
type: concept
updated: 2026-09-08
related:
  - ./supabase-sync.md
  - ./device-locking.md
code_refs:
  - supabase/migrations/
---

# Migrações Supabase — por que `db push` é perigoso aqui

> ⚠️ **Nunca rode `supabase db push` neste projeto** sem antes reparar o
> histórico. Ele recria coisas que já foram removidas de propósito.

## O fato

Medido em 2026-09-08 no projeto `rbwzhglsztmjvwrcydcy` (frostapp2.0):

- `supabase_migrations.schema_migrations` no remoto: **49 registros**,
  de `20260506094618` a `20260723013715`.
- Arquivos em `supabase/migrations/`: **12**.
- Versões que batem entre os dois lados: **zero**.

Os arquivos locais são uma reconstrução posterior (renomeados, consolidados,
com carimbos escolhidos à mão) — não são o que de fato rodou no banco. Boa parte
das 49 migrações remotas foi aplicada pelo dashboard ou por MCP, nunca pelo CLI.

## Por que isso morde

`db push` compara nome de arquivo com versão registrada. Como nenhuma bate, ele
trata **as 12 como pendentes**. Como as versões locais são anteriores à última
remota, o CLI recusa e sugere `--include-all` — e com essa flag ele roda tudo:

- `00000000000000_baseline_schema_base.sql` por cima do schema vivo;
- `20260722000000_device_locking.sql` + `20260722040000_device_rls_fase3.sql`,
  que **recriam** o travamento por aparelho e suas 12 políticas restritivas
  (ver [[./device-locking]], removido justamente em 2026-09-08).

Ou seja: o comando "normal" de aplicar migrações desfaz remoções deliberadas.

## Como aplicar SQL neste projeto, então

1. **SQL Editor do dashboard** — cole o conteúdo do arquivo de migração. É o que
   vem sendo feito na prática, e é o que mantém o comportamento previsível.
2. O arquivo em `supabase/migrations/` continua sendo escrito e commitado: ele é
   o **registro** da mudança, não o mecanismo de aplicação.
3. Se um dia quisermos `db push` de volta, o caminho é `supabase migration repair`
   para casar as 49 versões remotas com os arquivos — trabalho à parte, nunca no
   meio de outra mudança.

> O comentário "COMO APLICAR: supabase db push" dentro de migrações antigas
> (ex.: `20260730000000_move_current_device_ok_to_private.sql`) é anterior a essa
> descoberta. Prevalece esta página. O `CLAUDE.md` não recomenda `db push` — só
> documenta o deploy de Edge Functions (`npm run deploy:fn`), que é outra coisa.
