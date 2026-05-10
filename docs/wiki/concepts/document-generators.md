---
title: Document Generators (orçamento / OS / recibo HTML)
type: concept
updated: 2026-05-10
sources: []
related:
  - ../modules/process.md
  - ../modules/settings.md
code_refs:
  - src/App.jsx:4385-4910
  - src/App.jsx#openHTMLDoc
  - src/App.jsx#generateOrcamentoHTML
  - src/App.jsx#generateOSHTML
  - src/App.jsx#generateReciboHTML
---

# Document Generators

Substitutos do antigo `InvoiceModule`. Geram HTML imprimível em janela nova, sem PDF lib. Usuário usa "Imprimir → Salvar como PDF" do navegador.

## API pública

| Função | Saída | Quando |
|---|---|---|
| `generateOrcamentoHTML(os, clients)` | string HTML | botão "Orçamento" no `ProcessModule` |
| `generateOSHTML(os, clients)` | string HTML | botão "Imprimir OS" |
| `generateReciboHTML(os, clients)` | string HTML | botão "Recibo" (após pagamento) |
| `openHTMLDoc(html)` | janela nova | trigger comum dos três acima |

Padrão: `openHTMLDoc(generateXHTML(os, clients))`.

## `openHTMLDoc(html)`

```js
const blob = new Blob([html], { type: "text/html" });
const url = URL.createObjectURL(blob);
const win = window.open(url, "_blank");
setTimeout(() => URL.revokeObjectURL(url), 60000);
```

- Usa **Blob URL** pra evitar limite de `data:` URL (~2MB no Chrome).
- Revoga após 60s — janela já carregou o doc.
- Pop-up blocker pode bloquear → `win` é `null`. Hoje não tratado — `addToast` de aviso seria boa adição (lacuna).

## Blocos compartilhados

| Helper | Função |
|---|---|
| `_h(v)` | Escape XSS — replace `&<>"'` antes de injetar em template literal |
| `_docStyles(accentColor)` | Tokens de design + `@media print` (A4) |
| `_docHeader(config, docType, numero, dataStr)` | Logo + razão social + número doc + data |
| `_actionBar()` | Botões "Imprimir" / "Fechar" (visíveis em tela, escondidos no print) |
| `_clienteBlock(cliente, os)` | Bloco "Dados do Cliente" |
| `_pixBlock(config)` | Bloco PIX (chave/banco/CNPJ) |
| `_agradecimentoBlock(config)` | Texto de agradecimento configurável |
| `_equipamentoDescricao(os)` | Marca/modelo/série/defeito relatado |

### `_h(v)` — XSS guard

```js
String(v ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");
```

**Regra**: todo dado vindo de `cliente`, `os`, `config` vai por `_h` antes de entrar no template literal. Bypassar = XSS no doc impresso (improvável mas possível se nome de cliente tem `<script>`).

### `_pixBlock` — defaults

Se `config.pix` ausente, usa fallback:
- Nome: THIAGO GONÇALVES PRADO
- Banco: Sicredi
- CNPJ: 41.080.020/0001-05

> Hardcoded — esses defaults assumem operação específica. Cliente novo precisa configurar PIX em Settings antes de imprimir, senão recibo sai com dados de outro.

## Estilos (`_docStyles`)

- Tokens: `--accent` (cor da empresa), `--text`, `--muted`, `--border`
- `@page { size: A4; margin: 15mm }`
- `@media print { .no-print { display: none } }` — esconde action bar
- Font: DM Sans (mesma do app, herda da página pai não, então é re-importada via Google Fonts no `<head>`)

## `_docHeader` — resolução de logo

Ordem: `config.logoUrl` (data URL ou http) → fallback texto com inicial da razão social. Sem espaço de placeholder pra evitar quebra de layout.

## Validade do orçamento

`generateOrcamentoHTML` adiciona linha "Validade: 15 dias a partir de `dataStr`". Hardcoded — não vem de config.

## Padrões / armadilhas

- **Sempre `_h`** em valores dinâmicos. Sempre.
- **Não cole templates inline em outros lugares** — todo doc novo deve passar por `openHTMLDoc` + helpers compartilhados pra manter visual consistente.
- **Pop-up blocker**: se `window.open` retorna `null`, hoje silencia. Adicionar toast.
- **PIX hardcoded**: novo tenant → preencher `config.pix` em Settings antes de gerar recibo, senão sai com PIX de outra empresa.
- **Sem PDF server-side**: design é "print do navegador". Não introduzir `jsPDF`/`puppeteer` sem revisar trade-off (peso, font, fidelidade).

## Lacunas

- [a expandir] `generateOSHTML` e `generateReciboHTML` — diffs vs orçamento (campos, validade, totais)
- [a expandir] Internacionalização — hoje só pt-BR, formato de data e moeda fixos
