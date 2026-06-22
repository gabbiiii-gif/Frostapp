# Design — Escola: relatórios no portal, ofício anexo e checklist de primeiro acesso

- **Data:** 2026-06-22
- **Módulo:** Escola (portal externo da Vanda + painel interno + tela de primeiro acesso)
- **Status:** aprovado para planejamento

## Contexto

O módulo Escola já está em produção: a cliente **Vanda** (`role=cliente_escola`) usa o
portal externo isolado [`EscolaPortalVanda.jsx`](../../../src/modules/EscolaPortalVanda.jsx)
para abrir e acompanhar solicitações; a equipe interna gerencia tudo em
[`EscolaModule.jsx`](../../../src/modules/EscolaModule.jsx). O domínio puro vive em
[`src/lib/escola.js`](../../../src/lib/escola.js) e os relatórios em
[`src/lib/escola-relatorio.js`](../../../src/lib/escola-relatorio.js).

Três funcionalidades novas foram solicitadas pelo cliente.

---

## Feature 1 — Relatórios no portal da Vanda

### Objetivo
A Vanda quer gerar relatórios das **próprias** solicitações por **escola, data, semana e mês**,
direto no portal dela. Hoje o relatório existe só no painel interno (admin/gerente).

### Decisão
Reusar **integralmente** o lib existente [`escola-relatorio.js`](../../../src/lib/escola-relatorio.js)
(`montarRelatorio`, `gerarHtmlRelatorio`, `gerarCsvRelatorio`, `periodoSemana`,
`periodoMesCorrente`). **Nenhuma lógica nova de relatório.** Só nova UI no portal.

### Escopo
- Botão **"📊 Relatórios"** no header do portal.
- Modal no tema escuro do portal (não reaproveitar `RelatorioModal` do EscolaModule porque é
  tema claro e acoplado ao painel interno — criar componente próprio do portal que chama o
  mesmo lib).
- Presets **Semana / Mês corrente / Personalizado**, filtro por **escola** (texto) e datas
  início/fim. Preview de métricas (igual ao interno).
- **Fonte de dados:** apenas as demandas da própria Vanda — o estado `demandas` já carregado via
  `listarDemandasUsuario(db, user.id)`. Ela nunca vê dados de terceiros.
- Saídas: **PDF** (`gerarHtmlRelatorio` → `window.open` + print) e **CSV** (`gerarCsvRelatorio`).

### Não-objetivos
- Não alterar o relatório interno.
- Não criar novas métricas.

---

## Feature 2 — Ofício(s) anexo(s) ao abrir solicitação

### Objetivo
Permitir que a Vanda anexe um ofício (PDF ou imagem) ao abrir uma nova solicitação.

### Comportamento (decidido com o cliente)
- **Opcional** (não bloqueia o envio se faltar).
- **Múltiplos arquivos** (PDF + imagens misturados).
- **Pré-visualização antes de enviar**: miniatura para imagens; chip com nome/tamanho + link
  "abrir" para PDF. Botão de remover por arquivo.

### UI (modal "Nova solicitação" no portal)
- `<input type="file" accept="application/pdf,image/*" multiple>`.
- Validação leve no client: tipo (apenas pdf/imagem) e tamanho **máx. 10 MB por arquivo**.
- Lista de previews com remoção individual antes do envio.

### Persistência
- Novo helper `uploadEscolaOficio(file, demandaId)` em
  [`src/supabase.js`](../../../src/supabase.js), espelhando `uploadFotoOS`:
  - bucket **privado novo `escola-oficios`**;
  - path escopado `${companyId}/${demandaId}/${ts}_${rand}.${ext}`;
  - retorna **signed URL** (TTL longo, igual aos outros buckets).
- Fluxo de envio:
  1. `criarDemanda(...)` cria a demanda (síncrono, offline-first no kv_store) e devolve o `id`.
  2. Para cada arquivo selecionado: `uploadEscolaOficio(file, demanda.id)`.
  3. `db.set(demanda.id, { ...demanda, oficios: [{ url, nome, tipo, tamanho }] })`.
  - Se offline / upload falhar: a demanda **continua criada** sem ofícios (anexo é opcional);
    toast informa que o anexo não subiu.

### Exibição
- Card da Vanda: indicador "📎 N anexo(s)" com links.
- **Detalhe da demanda no painel interno** ([`EscolaModule.jsx`](../../../src/modules/EscolaModule.jsx)):
  seção "Ofícios anexados" com links/abrir, para a equipe consultar o documento.

### Setup manual obrigatório
- Criar o bucket **privado `escola-oficios`** no Supabase Dashboard (igual `os-assinaturas`),
  com RLS de pasta escopada por `company_id` (`foldername[1] = company_id`).

### Não-objetivos
- Não tornar o anexo obrigatório.
- Não fazer OCR / leitura do conteúdo do ofício.

---

## Feature 3 — Primeiro acesso com checklist de senha ao vivo

### Objetivo
Quando um usuário novo define a senha pelo link enviado por email (fluxo de convite,
`mode="invite"`), a tela deve mostrar **uma lista de requisitos que vai sendo marcada** conforme
ele digita, para que ele acompanhe o cumprimento de cada regra.

### Decisão sobre a política
A política global `validatePasswordStrength` ([`utils.js:215`](../../../src/utils.js#L215))
**permanece em 12 caracteres**. O checklist apenas **exibe** as regras já existentes; não
enfraquece nada.

### Requisitos exibidos (alinhados à política atual)
- ✓ Mínimo **12 caracteres**
- ✓ Uma letra **maiúscula**
- ✓ Uma letra **minúscula**
- ✓ Um **número**
- ✓ Um **caractere especial** (`!@#$…`)
- (regra de exclusão já existente: **sem espaço**)
- ✓ **As senhas conferem** (campo confirmar)

### UI
- Tela: `ResetPasswordScreen` ([`App.jsx:2575`](../../../src/App.jsx#L2575)).
- Abaixo do campo "Nova senha", renderizar `PasswordChecklist` — cada item cinza quando não
  cumprido, **verde com ✓** quando cumprido, em tempo real (on change).
- Botão "Ativar conta" só habilita quando `validatePasswordStrength(pwd).ok && pwd === confirm`.

### Implementação
- Novo helper puro `passwordChecklist(pwd)` em [`src/utils.js`](../../../src/utils.js) retornando
  os booleanos por regra (`min12`, `lower`, `upper`, `number`, `symbol`, `noSpace`).
  **Coberto por teste** em [`src/utils.test.js`](../../../src/utils.test.js).
- Componente `PasswordChecklist` (pode viver junto de `PasswordInput.jsx` ou inline na tela).
- Reaproveitar a barra de força que `PasswordInput` já tem (`strengthMeter`), apenas somando o
  checklist explícito.

### Não-objetivos
- Não mudar o fluxo de convite/recovery (Supabase Auth) em si.
- Não alterar a política das outras telas de senha.

---

## Arquivos tocados (resumo)

| Arquivo | Mudança |
| --- | --- |
| `src/modules/EscolaPortalVanda.jsx` | botão + modal de relatórios; input de ofícios com preview; envio com upload |
| `src/modules/EscolaModule.jsx` | exibir ofícios anexados no detalhe da demanda |
| `src/supabase.js` | `uploadEscolaOficio(file, demandaId)` (bucket `escola-oficios`) |
| `src/utils.js` | `passwordChecklist(pwd)` |
| `src/utils.test.js` | testes de `passwordChecklist` |
| `src/App.jsx` | `PasswordChecklist` na `ResetPasswordScreen` |
| Supabase Dashboard | criar bucket privado `escola-oficios` + RLS de pasta |

## Riscos / observações
- O diretório atual **não é um repositório git** — a regra de "deploy contínuo" do projeto não
  pode ser cumprida automaticamente aqui; commit/deploy ficam a cargo do usuário no repo real.
- Upload de ofício depende de estar online (Supabase Storage). Como é opcional, degrada bem.
- Bucket `escola-oficios` precisa ser criado manualmente antes de a feature funcionar de ponta a ponta.
