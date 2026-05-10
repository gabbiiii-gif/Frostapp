---
title: App do Técnico (TecnicoMobileApp)
type: module
updated: 2026-05-10
sources: []
related:
  - ./process.md
  - ../concepts/supabase-sync.md
  - ../concepts/role-permissions.md
code_refs:
  - src/App.jsx#TecnicoMobileApp
  - src/App.jsx#TecnicoOSDetail
  - src/App.jsx:10871
  - src/App.jsx:11025
---

# App do Técnico (TecnicoMobileApp)

Shell **dedicado** para `role="tecnico"`. **Sem sidebar do ERP, sem outros módulos.** Render alternativo no nível do App principal (não passa pelo `ModuleSwitcher`).

## Regra obrigatória (CLAUDE.md Regra 4)

Técnico **só** vê este shell. Nunca dar acesso a outros módulos. Toda OS finalizada pelo técnico **precisa** revisão admin/gerente antes de virar `finalizado`.

## Tabs

- `ativas` — status ∈ `{aguardando, agendado, em_deslocamento, em_servico, em_execucao, confirmado}`
- `historico` — status ∈ `{aguardando_finalizacao, concluido, finalizado, cancelado}`

OS criada no ERP entra com `aguardando` (= primeiro de `STATUS_FLOW`), então cai em `ativas`.

## Filtragem das OS

```
DB.list("erp:os:")
  .filter(os => os.tecnicoId === user.id || os.tecnicoNome === user.nome)
```

`tecnicoNome` como fallback é defesa contra OS legadas sem `tecnicoId` populado.

## Realtime

`subscribeToChanges(cb)` (de [supabase-sync](../concepts/supabase-sync.md)) → `setReload(r=>r+1)` força refetch quando ERP envia novas OS.

## Fluxo de uma OS (TecnicoOSDetail, line 11025)

1. **Visualizar demanda** (cliente, equipamentos, agendamento)
2. **Marcar chegada** → grava `os.tecnico.chegada = ISO`
3. **Preencher descrição** (`descricaoTecnico`) + **upload fotos/vídeos** → bucket Supabase Storage `os-fotos` (público)
4. **Finalizar** → status vira `aguardando_finalizacao`, grava `os.tecnico.saida`

## Mídia

- `fotos[]` aceita imagens E vídeos (`VIDEO_EXT_RE` em constants.js)
- Durante upload usa `blob:` URLs temporárias
- `videoUrls` é Set adicional pra rastrear quais blobs são vídeo (sem extensão)

## Botão voltar (Android/navegador)

`useEffect` com **deps vazias** + `closeRef` pra `onClose`:
- `history.pushState({tecnicoDetail: true}, "")` ao montar
- `popstate` listener fecha modal
- Cleanup chama `history.back()` se ainda houver state próprio

**Por que deps vazias**: re-render do pai dispararia cleanup → `history.back()` → tela fecharia sozinha durante interação. **Não mexer.**

## Header

`user.nome` + `Técnico • FrostERP` + toggle tema + botão sair. `<StyleSheet />` re-injetado no shell (não compartilha com ERP shell).

## Fora de escopo

- Sidebar de módulos (não existe aqui)
- Edição direta da OS pelo técnico (só os campos próprios: descricaoTecnico, fotos, chegada, saida, finalizar)
- Aprovação final (admin/gerente faz no [Process](./process.md) → `reviewing`)

## Lacunas

- [a expandir] Upload exato (multipart vs base64, retry, progress) — código pós 11060
