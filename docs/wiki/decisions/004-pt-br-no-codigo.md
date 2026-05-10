---
title: ADR 004 — pt-BR no código (UI, comentários, identificadores parciais)
type: decision
updated: 2026-05-10
status: aceita
sources: []
related: []
code_refs:
  - src/App.jsx
---

# ADR 004 — pt-BR no código

## Contexto

App é ERP brasileiro pra PME. Cliente final, técnicos, admins falam só português. CLAUDE.md Regra 2 exige comentários em pt-BR.

## Decisão

- **UI 100% pt-BR** (labels, mensagens, toasts, validações)
- **Comentários em pt-BR** (Regra 2)
- **Identificadores em mix**: termos de domínio em pt-BR (`recordAudit`, `syncOSToFinance`, `clientes`, `funcionarios`), conceitos genéricos em inglês (`hashPassword`, `useState`, `companyId`)
- **Status/enums em pt-BR**: `aguardando`, `em_andamento`, `finalizado` — combinam com a UI sem mapping
- **Categorias financeiras em pt-BR**: `receita`, `despesa`, `pago`, `pendente`

## Razões

- **Domínio é brasileiro**: CNPJ, CPF, PIX, NF-e, "ordem de serviço" não traduzem bem.
- **Sem layer de i18n**: app não tem `react-i18next` nem `gettext`. Adicionar pra "futuramente" = peso sem benefício hoje.
- **Comentários em pt-BR ajudam o cliente final** (developer freelancer) a manter sem precisar saber inglês técnico.
- **Mix de identificadores reflete realidade**: `useState`/`useEffect` ficam em inglês porque são API React; `setCNome`/`handleCreateCompany` ficam em mix porque "create" é verbo curto e claro.

## Trade-offs aceitos

- **Internacionalização futura é refactor grande**: extrair strings, montar dicionário, trocar literals por `t("...")`. Estimativa: dias.
- **Devs fora do BR têm fricção** ao ler `aguardando_finalizacao` ou `tecnico.chegada`. Aceitável — equipe é BR.
- **Code search misto**: buscar "pending" não acha; buscar "pendente" sim. Documentado.

## Regras

- Strings de UI **sempre** pt-BR
- Comentários **sempre** pt-BR (Regra 2)
- Errors técnicos pra console: pt-BR ou inglês ok (não é UI)
- Termos de domínio (`os`, `cliente`, `tecnico`, `finalizado`): pt-BR consistente em código + UI
- Não traduzir parcialmente: `clienteName` ou `osStatus` é pior que `clienteNome` ou `statusOS`

## Quando rever

- Cliente expandindo pra fora do BR (improvável dado o mercado-alvo)
- Equipe de dev internacional (não previsto)
- Receber proposta de SaaS multi-país do produto (mudança de modelo de negócio, não só técnica)
