# Telas do app usadas na vitrine da landing

O bloco "Veja como funciona" (`index.html` → `.demo-shots`) roda um CardSwap com as
telas do FrostERP. O `scroll.js` **pré-carrega cada arquivo antes de montar a pilha**:
tela que não estiver aqui é simplesmente ignorada, e com menos de duas a vitrine some
sozinha em vez de mostrar quadro quebrado. Ou seja: dá pra ir soltando os arquivos aos
poucos, sem quebrar a seção no meio do caminho.

Nomes esperados (PNG, proporção larga — de 16:9 a 2:1). O recorte é a partir do canto
superior esquerdo, então sidebar e cabeçalho são a parte que aparece:

| Arquivo          | Tela              |
| ---------------- | ----------------- |
| `dashboard.png`  | Dashboard         |
| `os.png`         | Ordens de Serviço |
| `agenda.png`     | Agenda            |
| `financeiro.png` | Financeiro        |
| `cadastros.png`  | Cadastros         |
| `relatorios.png` | Relatórios        |
| `lembrete.png`   | Lembrete          |
| `config.png`     | Configurações     |

## Regra: nada de dado real de cliente

A landing é pública e indexada. **Capture tudo no modo demonstração**
(`https://app.frosterp.com.br/?demo=1`), que roda com dados de exemplo.

As telas de **IA / Atendimento**, **Pós-Venda** e **Folha de Pagamento** ficaram de fora
justamente por isso: as capturas traziam nome e telefone de clientes reais da empresa, e
nomes e valores de funcionários. Se quiser essas três na vitrine, recapture na demo e
acrescente as linhas correspondentes dentro de `.card-swap-stage`, no `index.html`.

`relatorios.png` e `lembrete.png` não têm dado pessoal, mas as capturas vieram de uma
empresa real e o nome dela aparece na sidebar. Recapturar na demo deixa a vitrine
visualmente consistente com as outras seis.

## Peso

São 8 imagens numa página de marketing. Exporte com no máximo ~1200px de largura (o
cartão tem 460px) e passe num compressor. WebP também serve — é só trocar a extensão no
`data-src` do `index.html`.
