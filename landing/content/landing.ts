export const landing = {
  hero: {
    headline:
      "O ERP feito para empresas de refrigeração que querem parar de perder dinheiro em planilhas.",
    subheadline:
      "Gestão de OS, agenda, financeiro e estoque em um só sistema. Sem complicação, sem fidelidade.",
    ctaPrimary: "Começar agora — R$ 59,90/mês",
    ctaSecondary: "Falar no WhatsApp",
    proof:
      "Já em uso por equipes de refrigeração no Pará. R$ 2.000+ em receita rastreada no último mês.",
  },

  pain: {
    title: "O que custa caro hoje",
    items: [
      {
        title: "Suas OS vivem em grupos de WhatsApp",
        body: "Você perde histórico técnico, fotos do serviço e prazo de garantia.",
      },
      {
        title: "Seu financeiro não conversa com o operacional",
        body: "Você fecha OS mas não sabe o que entrou no caixa.",
      },
      {
        title: "Seu estoque é uma planilha desatualizada",
        body: "Compressor que você jurou ter, sumiu. Peça parada virou prejuízo.",
      },
    ],
  },

  solution: {
    title: "Tudo em um sistema",
    subtitle: "Os módulos que sua operação de refrigeração realmente usa.",
    items: [
      {
        title: "Dashboard em tempo real",
        body: "Veja OS em andamento, receita do mês e clientes ativos em uma tela.",
        iconKey: "gauge",
      },
      {
        title: "Ordens de Serviço com Kanban",
        body: 'Acompanhe cada OS de "Aguardando" até "Finalizado" sem perder ninguém no caminho.',
        iconKey: "kanban",
      },
      {
        title: "Agenda integrada",
        body: "Próximas atividades dos técnicos sincronizadas com cada OS.",
        iconKey: "calendar",
      },
      {
        title: "Financeiro com pipeline",
        body: "A receber, a pagar, vencidos e saldo previsto em um painel.",
        iconKey: "wallet",
      },
      {
        title: "Cadastros centralizados",
        body: "Clientes, funcionários, fornecedores, produtos e estoques em um só lugar.",
        iconKey: "users",
      },
      {
        title: "Modo escuro nativo",
        body: "Sua equipe usa o sistema o dia inteiro. A gente cuida da vista deles.",
        iconKey: "moon",
      },
    ],
  },

  demo: {
    title: "Veja como funciona",
    subtitle: "Quatro telas reais do FrostERP em produção.",
    tabs: [
      {
        key: "dashboard",
        label: "Dashboard",
        caption: "KPIs do dia: OS em andamento, receita do mês, clientes ativos.",
        image: "/screenshots/dashboard.webp",
      },
      {
        key: "os",
        label: "Ordens de Serviço",
        caption: "Visões Lista e Kanban com status Aguardando → Finalizado.",
        image: "/screenshots/ordens-servico.webp",
      },
      {
        key: "financeiro",
        label: "Financeiro",
        caption: "Pipeline a receber, a pagar, vencidos e saldo previsto.",
        image: "/screenshots/financeiro.webp",
      },
      {
        key: "cadastros",
        label: "Cadastros",
        caption: "21 clientes, 7 funcionários, 128 produtos, 171 serviços.",
        image: "/screenshots/cadastros.webp",
      },
    ],
  },

  pricing: {
    title: "Um plano. Sem surpresa.",
    subtitle: "Tudo incluso. Sem fidelidade. Sem letras miúdas.",
    monthly: { label: "Mensal", price: "R$ 59,90", period: "/mês", note: "Cobrado mensalmente" },
    annual: {
      label: "Anual",
      price: "R$ 49,90",
      period: "/mês",
      note: "Cobrado R$ 598,80/ano — economia de R$ 120",
      badge: "Economize R$ 120",
    },
    name: "FrostERP — Plano Completo",
    features: [
      "Todos os módulos (Dashboard, OS, Agenda, Financeiro, Cadastros, Configurações)",
      "3 usuários inclusos",
      "Clientes, fornecedores, produtos e estoques ilimitados",
      "Ordens de Serviço ilimitadas",
      "Modo escuro",
      "Atualizações contínuas",
      "Suporte via WhatsApp e e-mail",
    ],
    addon: "+ R$ 25/mês por usuário adicional",
    guarantee: "7 dias para testar. Cancele quando quiser. Sem fidelidade.",
    cta: "Começar agora",
  },

  faq: {
    title: "Perguntas frequentes",
    items: [
      {
        q: "Quanto custa o FrostERP?",
        a: "R$ 59,90/mês no plano mensal ou R$ 49,90/mês no plano anual (cobrado R$ 598,80/ano). Inclui todos os módulos e 3 usuários. Usuário adicional: R$ 25/mês.",
      },
      {
        q: "Tem fidelidade ou multa?",
        a: "Não. Você cancela quando quiser, sem multa.",
      },
      {
        q: "Para quais empresas o FrostERP é indicado?",
        a: "Empresas de refrigeração, climatização, instalação e manutenção de ar-condicionado com 1 a 15 técnicos em campo.",
      },
      {
        q: "Quais módulos estão inclusos?",
        a: "Dashboard, Ordens de Serviço (Lista e Kanban), Agenda, Financeiro com pipeline, Cadastros (clientes, funcionários, fornecedores, produtos, estoques, serviços) e Configurações.",
      },
      {
        q: "Posso adicionar mais usuários depois?",
        a: "Sim. R$ 25/mês por usuário adicional, sem limite.",
      },
      {
        q: "Migra os dados das minhas planilhas atuais?",
        a: "Sim. Nossa equipe ajuda a importar clientes, produtos e estoques na implantação.",
      },
      {
        q: "Quanto tempo leva para começar a usar?",
        a: "Você cria a conta e entra no sistema em 5 minutos. Migração completa de dados leva de 1 a 3 dias úteis.",
      },
      {
        q: "Funciona no celular?",
        a: "Sim. Interface responsiva para usar em qualquer dispositivo.",
      },
      {
        q: "Quais formas de pagamento?",
        a: "Cartão de crédito (recorrente) via Stripe.",
      },
      {
        q: "Como funciona o suporte?",
        a: "Suporte via WhatsApp (93) 98416-6832 e e-mail suportefrosterp@gmail.com em horário comercial.",
      },
    ],
  },

  ctaFinal: {
    title: "Comece em 5 minutos. Cancele quando quiser.",
    subtitle: "R$ 59,90/mês. 7 dias para testar. Sem fidelidade.",
    primary: "Começar agora",
    secondary: "Falar no WhatsApp",
  },

  footer: {
    tagline: "Gestão integrada para refrigeração",
    columns: [
      {
        title: "Produto",
        links: [
          { label: "Recursos", href: "#solucao" },
          { label: "Preços", href: "#precos" },
          { label: "FAQ", href: "#faq" },
          { label: "Status", href: "#" },
        ],
      },
      {
        title: "Empresa",
        links: [
          { label: "Sobre", href: "#" },
          { label: "Contato", href: "#" },
          { label: "Blog", href: "#" },
        ],
      },
      {
        title: "Suporte",
        links: [
          { label: "WhatsApp (93) 98416-6832", href: "https://wa.me/5593984166832" },
          { label: "suportefrosterp@gmail.com", href: "mailto:suportefrosterp@gmail.com" },
        ],
      },
      {
        title: "Legal",
        links: [
          { label: "Termos de Uso", href: "#" },
          { label: "Política de Privacidade", href: "#" },
          { label: "LGPD", href: "#" },
        ],
      },
    ],
    legal: {
      cnpj: "66.698.470/0001-89",
      address: "Avenida João Coelho, 1896 — Bairro Brasília — Altamira/PA — CEP 68375-049",
    },
  },
};
