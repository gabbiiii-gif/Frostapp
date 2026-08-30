# Telas do app usadas na vitrine da landing

O bloco "Veja como funciona" (`index.html` → `.demo-shots`) roda um CardSwap com as
telas do FrostERP. O `scroll.js` **pré-carrega cada arquivo antes de montar a pilha**:
tela que não estiver aqui é simplesmente ignorada, e com menos de duas a vitrine some
sozinha em vez de mostrar quadro quebrado. Ou seja: dá pra ir soltando os arquivos aos
poucos, sem quebrar a seção no meio do caminho.

Nomes esperados (JPG, proporção larga — as atuais são 1600×~750, ou seja ~2,1:1). O recorte é a partir do canto
superior esquerdo, então sidebar e cabeçalho são a parte que aparece:

| Arquivo          | Tela              |
| ---------------- | ----------------- |
| `dashboard.jpg`  | Dashboard         |
| `os.jpg`         | Ordens de Serviço |
| `agenda.jpg`     | Agenda            |
| `financeiro.jpg` | Financeiro        |
| `cadastros.jpg`  | Cadastros         |
| `relatorios.jpg` | Relatórios        |
| `lembrete.jpg`   | Lembrete          |
| `config.jpg`     | Configurações     |

## Regra: nada de dado real de cliente

A landing é pública e indexada. **Capture tudo no modo demonstração**
(`https://app.frosterp.com.br/?demo=1`), que roda com dados de exemplo.

As telas de **IA / Atendimento**, **Pós-Venda** e **Folha de Pagamento** ficaram de fora
justamente por isso: as capturas traziam nome e telefone de clientes reais da empresa, e
nomes e valores de funcionários.

As três capturas originais **não estão neste diretório de propósito** — a Vercel serve tudo
que está em `landing/`, então um arquivo aqui vira URL pública mesmo sem estar referenciado
no HTML. Elas foram para `docs/raw/telas-com-dados-reais/`, que está no `.gitignore` (ficam
na sua máquina, fora do repo e fora do ar). Para ter essas três na vitrine: recapture em
`?demo=1`, salve aqui e acrescente as linhas dentro de `.card-swap-stage`, no `index.html`.

`relatorios.jpg` e `lembrete.jpg` não têm dado pessoal, mas as capturas vieram de uma
empresa real e o nome dela aparece na sidebar. Recapturar na demo deixa a vitrine
visualmente consistente com as outras seis.

## Peso

As 8 somam ~680KB (1600px de largura, 50–110KB cada) — o WhatsApp já comprimiu no caminho.
Está aceitável, e o JS só as busca depois que a página carrega. Se um dia quiser menos:
reduza pra ~1000px de largura ou troque por WebP, mudando a extensão no `data-src` do
`index.html`.
