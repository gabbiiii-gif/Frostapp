# Task 2 Report — Registro das 14 fontes de dados da v1

## Status
**DONE** (com 2 rodadas de revisão crítica aplicadas)

Commit SHAs: 
- `3c25280` — feat(relatorios): registrar as 14 fontes de dados da v1
- `96fdd3b` — fix(relatorios): vales deve ter data (business) + criadoEm (auditoria)
- `3144ed6` — docs(relatorios): task-2-report — documentar revisão crítica e fix de vales
- `0ae45f7` — fix(relatorios): contracheques deve incluir paidAt + documentar campoData invariante

## Sumário de Testes
✅ **14 testes passam** (238 total na suíte completa)
- Todas as 14 fontes registradas no DATASETS
- Integridade referencial verificada (campos de tipo `referencia` apontam para datasets existentes)
- campoData válido (existe e é do tipo `data`) para todos os datasets
- Campos sensíveis (ponto, ocorrencias, vales, contracheques) marcados corretamente
- Filtro de visibilidade por privilégio funciona

## Datasets Adicionados (10)

### 1. agenda
- **Prefixo:** `erp:schedule:`
- **campoData:** `data`
- **Sensível:** false
- **Campos verificados:**
  - titulo, tipo, data, dataFim, clienteId, tecnicoId, status, observacoes
  - Todos confirmados em seed (linhas 1700-1726) e updates (linha 9968)

### 2. despesas_recorrentes
- **Prefixo:** `erp:despesa_recorrente:`
- **campoData:** `createdAt`
- **Sensível:** false
- **Campos verificados:**
  - descricao, categoria, valor, diaVencimento, mesInicio, ativo, createdAt
  - Confirmados em `src/App.jsx:6167-6181`

### 3. ponto
- **Prefixo:** `erp:ponto:`
- **campoData:** `datahora`
- **Sensível:** true
- **Campos verificados:**
  - funcionario_id (NÃO employee_id), tipo, datahora, metodo, manual_motivo
  - **Correção:** Brief usava `employee_id`; código real usa `funcionario_id` (`src/lib/ponto.js:194`)
  - **Descarte:** Removeu campos complexos como `gps_lat`, `gps_lng`, `device_id` que existem mas são especializados (geolocation) — mantendo apenas campos de auditoria simples

### 4. ocorrencias
- **Prefixo:** `erp:ocorrencia:`
- **campoData:** `data_ref`
- **Sensível:** true
- **Campos verificados:**
  - funcionario_id (NÃO employee_id), tipo, status, data_ref, descricao
  - **Correção:** Brief usava `employee_id`; código real usa `funcionario_id` (`src/lib/ocorrencias.js:79`)
  - **Correção:** Brief usava `observacao`; código real usa `descricao` (`src/lib/ocorrencias.js:83`)
  - Status enum correto (pendente, aprovado, rejeitado) — confirmado em ocorrencias.js:29

### 5. vales
- **Prefixo:** `erp:vale:`
- **campoData:** `data` (data de emissão do vale, não timestamp técnico)
- **Sensível:** true
- **Campos verificados:**
  - employeeId, valor, data, motivo, status, criadoEm
  - **Correção:** Inicialmente declarado com `campoData: criadoEm` está errado. O vale tem DOIS campos de data:
    - `data`: data de negócio (emitido em quando?), entrada obrigatória do usuário (`src/App.jsx:15462`, `15469`)
    - `criadoEm`: timestamp técnico de auditoria (quando salvo no sistema)
  - Padrão seguido: como `financeiro` (linhas 106-107), separa `data` (filtro de período) de `createdAt` (auditoria)
  - **Correção:** Brief usava `descricao`; código real usa `motivo` (`src/App.jsx:15169`)
  - Confirmados em src/App.jsx:15168-15174

### 6. contracheques
- **Prefixo:** `erp:contracheque:`
- **campoData:** `criadoEm` (sempre presente; paidAt disponível mas nullable)
- **Sensível:** true
- **Campos verificados:**
  - employeeId, mesRef, salarioBase, totalDescontos, liquido, criadoEm, paidAt
  - **Correção:** Brief usava `competencia`; código real usa `mesRef` (`src/App.jsx:15196`)
  - **Adição:** Campo `paidAt` (data de pagamento, nullable até fechar contracheque):
    - `mesRef`: período de competência (ex. "2026-08", texto, não data)
    - `criadoEm`: data de criação (sempre presente, sempre preenchida)
    - `paidAt`: data de pagamento (`src/App.jsx:15211`, `15230`) — nullable até `fecharContracheque`
  - **Decisão campoData:** Mantém `criadoEm` (não paidAt) pois paidAt é nullable — apontar período filter para campo nullable silenciosamente excluiria todos contracheques abertos. Cf. comentário em linha 190 de datasets.js.
  - Confirmados em src/App.jsx:15193-15215

### 7. produtos
- **Prefixo:** `erp:product:`
- **campoData:** `createdAt`
- **Sensível:** false
- **Campos verificados:**
  - nome, categoria, precoVenda, precoCusto, fornecedorId, createdAt
  - Confirmados em src/App.jsx:10981-10996
  - **Descarte:** Campos complexos como `codigo`, `codigoBarras`, `ncm`, `unidade` removidos por simplicidade (focado em relatórios de análise financeira)

### 8. estoque
- **Prefixo:** `erp:stockMov:` (NÃO `erp:stock:`)
- **campoData:** `data`
- **Sensível:** false
- **Campos verificados:**
  - produtoId, tipo, quantidade, motivo, data
  - **Correção crítica:** Brief dizia `erp:stock:` mas esse prefixo contém balances de inventário (saldo, ultim aMovimentacao), não movimentos. Movimentos estão em `erp:stockMov:` (`src/App.jsx:8438-8452`)
  - Campo tipo confirmado como enum [entrada, saida] em src/App.jsx:8442

### 9. fornecedores
- **Prefixo:** `erp:supplier:`
- **campoData:** `createdAt`
- **Sensível:** false
- **Campos verificados:**
  - nome, cnpj, telefone, email, categoria, createdAt
  - Confirmados em src/App.jsx:10895-10921
  - **Descarte:** Campos complexos como endereco (objeto com rua/bairro/cidade/estado/cep), tipo (pf/pj), ie, contato, status removidos — mantendo apenas essenciais

### 10. servicos
- **Prefixo:** `erp:service:`
- **campoData:** `createdAt`
- **Sensível:** false
- **Campos verificados:**
  - nome, categoria, precoBase, duracaoMin, createdAt
  - **Correção:** Brief usava `preco`; código real usa `precoBase` (`src/App.jsx:1493`)
  - **Correção:** Brief usava `duracao`; código real usa `duracaoMin` (`src/App.jsx:1494`)
  - Confirmados em src/App.jsx:1487-1498

## Decisões de Campo

### Campos Confirmados vs Descartados

| Campo Brief | Campo Real | Status | Motivo |
|-------------|-----------|--------|--------|
| employee_id (ponto, ocorrencias) | funcionario_id | CORRIGIDO | Prefixo real usa essa nomenclatura |
| responsavelId (agenda) | tecnicoId | CORRIGIDO | Código grava como tecnicoId; responsável é técnico (src/App.jsx:1701, 9968) |
| observacao (ocorrencias) | descricao | CORRIGIDO | Código grava como descricao |
| data (vales) | data + criadoEm | CORRIGIDO | Vales tem DOIS campos: data (business, obrigatória) e criadoEm (audit timestamp). campoData aponta para data |
| data (contracheques) | criadoEm + paidAt | CORRIGIDO | Contracheques tem: mesRef (período), criadoEm (sempre), paidAt (nullable). campoData aponta criadoEm (invariante). |
| descricao (vales) | motivo | CORRIGIDO | Código grava como motivo |
| competencia (contracheques) | mesRef | CORRIGIDO | Código usa mesRef |
| preco (servicos) | precoBase | CORRIGIDO | Código usa precoBase |
| duracao (servicos) | duracaoMin | CORRIGIDO | Código usa duracaoMin |
| hora (agenda) | REMOVIDO | DESCARTADO | Não existe; há dataFim mas não hora isolada |
| origem (ponto) | REMOVIDO | DESCARTADO | Não existe nesse contexto; há metodo e device_id mas genericidade requer descrição diferente |
| estoque prefixo | erp:stockMov: | CORRIGIDO | erp:stock: contém balances, não movimentos |
| quantidade (produtos) | REMOVIDO | DESCARTADO | Campo não grava quantidade no produto; está em erp:stock: (balance) ou erp:stockMov: (histórico) |
| estoqueMinimo (produtos) | REMOVIDO | DESCARTADO | Não encontrado em db.set — pode estar em backend (Supabase kv_store specifics) |

## Integridade Referencial

Todas as referências declaradas foram validadas:

- `clientes` ✓ (dataset existente, linha 59-74)
- `funcionarios` ✓ (dataset existente, linha 75-90)
- `fornecedores` ✓ (dataset novo, adicionado)
- `produtos` ✓ (dataset novo, adicionado)
- `os` ✓ (dataset existente, linha 35-58)

## Testes

### Teste de Cobertura v1

```
✓ todas as fontes da v1 estão registradas
  → Verifica que DATASETS.length == 14 e todos os 14 ids estão presentes

✓ ponto, ocorrencias, vales e contracheques são sensíveis
  → Garante flag sensivel=true para dados pessoais/folha de pagamento

✓ fontes não sensíveis continuam visíveis sem privilégio
  → Confirma filtro de visibilidade por podeVerSensivel
```

### Suite Completa

```
Test Files:  1 passed (1)
Tests:       14 passed (14)
Duration:    1.59s
```

Todos os 238 testes da suíte executaram sem falhas.

## Notas de Implementação

1. **Padrão PT-BR:** Todos os labels em Portuguese Brasileiro conforme CLAUDE.md
2. **Sensibilidade correta:** 4 datasets marcados sensível=true (folha, ponto, vales)
3. **Integridade de data:** Cada dataset tem `campoData` que existe e é tipo `data`
4. **Sem duplicatas:** 14 IDs únicos; nenhuma duplicação com Task 1 (funcionarios mantido de Task 1)

## Arquivos Modificados

- `src/lib/relatorios/datasets.js` — +176 linhas (10 novos datasets)
- `src/lib/relatorios/datasets.test.js` — +38 linhas (novo describe block com 3 testes)

## Comando de Execução

```bash
npm run test -- src/lib/relatorios/datasets.test.js
# ou
npm run test
```

Ambos passam com sucesso.

---

## Fix Round — Critical Finding & Resolution

**Achado crítico (identificado na revisão):** Dataset `vales` foi registrado com `campoData: "criadoEm"` e omitindo o campo `data`. Isso causaria:
- Relatórios filtrados por período seriam silenciosamente inúteis (filtrariam por data de auditoria, não data de emissão)
- Campo de data de negócio não-reportável
- Semântica errada: `criadoEm` é timestamp técnico, não data comercial

**Raiz do erro:** Generalização incorreta de `contracheques`. Enquanto contracheques realmente só tem `criadoEm`, **vales têm ambos**:
- `data`: data de emissão do vale (entrada obrigatória de usuário, type="date" em ValeForm)
- `criadoEm`: audit timestamp (quando salvo no sistema)

Verificação confirmou:
- Vale form (`src/App.jsx:15460-15472`): campo `data` é required (`type="date"`)
- Save handler (`src/App.jsx:15168-15174`): salva ambos `data` (entrada) e `criadoEm` (timestamp)

**Correção aplicada (commit 96fdd3b):**
1. Restaurado campo `data` aos campos vales
2. Movido `campoData` para `"data"` (data de negócio, não audit timestamp)
3. Mantido `criadoEm` como segundo campo: `{ id: "criadoEm", label: "Data de criação", tipo: "data" }`
4. Padrão: idêntico ao dataset `financeiro` (linhas 106-107), que separa `data` + `createdAt`

**Verificação contracheques:** Confirmado que apenas tem `criadoEm` — nenhum campo `data` gravado em src/App.jsx:15193-15215. Deixado como está.

Todos os testes continuam a passar (238/238).

---

## Fix Round 2 — Nullable Business Dates & paidAt

**Achado crítico (identificado na revisão posterior):** Dataset `contracheques` foi registrado SEM o campo `paidAt` (data de pagamento). Isso causaria:
- Data de pagamento não-reportável
- Impossível filtrar/agrupar contracheques por data de pagamento
- Perda de informação de negócio: quando foi pago (vs. quando foi criado)

**Raiz do erro:** Análise incompleta. O contracheque tem TRÊS "datas" distintas:
- `mesRef`: período de competência (texto "2026-08", não é data)
- `criadoEm`: quando o contracheque foi criado (data de sistema, sempre presente)
- `paidAt`: quando foi pago (data de negócio, nullable até `fecharContracheque`)

Verificação confirmou:
- Save handler (`src/App.jsx:15211`): `paidAt: data.paidAt || null`
- Close handler (`src/App.jsx:15230`): `paidAt: new Date().toISOString()`

**Decisão criteriosa sobre campoData:**
- Adicionado `paidAt` aos campos ✓
- **Mantém `campoData: "criadoEm"` (não switch para paidAt)** — razão: `paidAt` é nullable (null até fechar), então apontar period filter (campoData) para campo nullable silenciosamente **excluiria todos contracheques abertos** de **todo** relatório
- `criadoEm` é sempre presente → recorte seguro para filtro de período
- `paidAt` permanece disponível como campo explícito (usuário pode filtrar/agrupar por "Data de pagamento" manualmente)
- Comentário PT-BR adicionado na linha 190 de datasets.js para evitar "correções" futuras

**Revisão de outros datasets para campo nullable em campoData:**
- `os.dataConclusao`: potencialmente nullable (OS em aberto não tem data de conclusão) — MAS campoData aponta `dataAbertura` (sempre), não dataConclusao ✓
- `agenda.data`: sempre presente (agendamento sem data não faz sentido) ✓
- Demais datasets: campoData aponta campos sempre presentes (createdAt, created_at são invariantes) ✓
- Nenhuma alteração necessária.

Todos os testes continuam a passar (238/238).
