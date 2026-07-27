# FrostApp

Aplicativo de gestão para empresas de refrigeração, climatização e manutenção de ar-condicionado — a plataforma do **FrostERP**.

- App em produção: https://app.frosterp.com.br
- Site institucional: https://frosterp.com.br

## Visão geral

O FrostApp reúne, em um único sistema, todo o fluxo operacional de uma empresa de refrigeração: ordens de serviço, agenda de manutenção, financeiro e estoque. Funciona no navegador (PWA) e como aplicativo Android, com uso em campo mesmo sem conexão e sincronização automática.

## Principais funcionalidades

- **Ordens de serviço** — abertura, acompanhamento e fechamento de OS com registro de fotos, marcação de chegada do técnico e assinatura do cliente.
- **Dashboard** — KPIs do dia, receita do mês, clientes ativos e gráficos em tempo real.
- **Financeiro** — controle do que entra a partir das OS fechadas.
- **Agenda** — organização das manutenções e visitas.
- **Cadastro** — clientes, produtos e estoque.
- **Notificações automáticas** — avisos por WhatsApp ao cliente a cada etapa da OS.
- **Orçamentos e recibos** — gerados na hora, já formatados.
- **Segurança** — autenticação em duas etapas (2FA), biometria, acesso por função e histórico de alterações.
- **Bloqueio por dispositivo** — controle de quais aparelhos têm acesso.

## Tecnologias

- JavaScript / TypeScript
- Vite
- Capacitor (build Android)
- Supabase (backend e autenticação)
- PWA (instalação no celular e no PC, suporte offline)

## Como rodar o projeto localmente

```bash
# clonar o repositorio
git clone https://github.com/gabbiiii-gif/Frostapp.git
cd Frostapp

# instalar dependencias
npm install

# ambiente de desenvolvimento
npm run dev

# build de producao
npm run build
```

> As variáveis de ambiente (ex.: chaves do Supabase) devem ser configuradas em um arquivo `.env` local. Consulte a documentação interna em `docs/`.

## Estrutura do projeto

- `src/` — código-fonte da aplicação
- `android/` — projeto Android (Capacitor)
- `api/` — funções serverless / integrações
- `landing/` — landing page
- `supabase/` — configurações e migrações do backend
- `docs/` — documentação interna

## Contato

- WhatsApp: (93) 98416-6832
- E-mail: suportefrosterp@gmail.com
