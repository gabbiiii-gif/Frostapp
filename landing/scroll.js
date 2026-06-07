// scroll.js — orquestra texto alternado + cena 3D no scroll (GSAP + anime.js)
(function () {
  function start() {
    if (!window.gsap || !window.ScrollTrigger || !window.frostScene) {
      return setTimeout(start, 60);
    }
    const gsap = window.gsap;
    gsap.registerPlugin(window.ScrollTrigger);
    const fs = window.frostScene;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---- 1. Progresso global controla o 3D ----
    gsap.to({}, {
      scrollTrigger: {
        trigger: document.documentElement,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.6,
        onUpdate: (self) => {
          fs.setScroll(self.progress);
          // explosão por fração de scroll (imune a reflow do carrossel/reveal)
          if (fs.explode) {
            if (self.progress > 0.96) fs.explode();
            else if (self.progress < 0.90) fs.reset();
          }
        },
      },
    });

    // ---- 2. Por painel: balanço do cristal + revelação do texto ----
    const panels = gsap.utils.toArray(".panel");
    panels.forEach((panel, i) => {
      const side = panel.dataset.side || "center";
      // cristal vai para o lado OPOSTO ao texto
      const balance = side === "left" ? 1.9 : side === "right" ? -1.9 : 0;
      const twist = (i % 2 === 0 ? 1 : -1) * 0.25;

      ScrollTrigger.create({
        trigger: panel,
        start: "top 60%",
        end: "bottom 40%",
        onToggle: (self) => {
          if (self.isActive) {
            fs.setBalance(balance);
            fs.setTwist(twist);
          }
        },
      });

      // revelação dos elementos internos
      const items = panel.querySelectorAll("[data-reveal]");
      if (items.length) {
        if (reduced) {
          gsap.set(items, { opacity: 1, y: 0, filter: "none" });
        } else {
          gsap.set(items, { opacity: 0, y: 34, filter: "blur(6px)" });
          ScrollTrigger.create({
            trigger: panel,
            start: "top 72%",
            onEnter: () => revealGroup(items),
            once: false,
            onEnterBack: () => revealGroup(items),
          });
        }
      }
    });

    function revealGroup(items) {
      gsap.to(items, {
        opacity: 1, y: 0, filter: "blur(0px)",
        duration: 0.9, ease: "power3.out", stagger: 0.09, overwrite: true,
      });
    }

    // ---- 4. Hero: título com anime.js (split em palavras) ----
    const heroTitle = document.querySelector("[data-hero-title]");
    if (heroTitle && window.anime && !reduced) {
      const words = heroTitle.textContent.trim().split(/\s+/);
      heroTitle.innerHTML = words
        .map((w) => `<span class="word"><span class="w-in">${w}</span></span>`)
        .join(" ");
      anime({
        targets: heroTitle.querySelectorAll(".w-in"),
        translateY: ["110%", "0%"],
        opacity: [0, 1],
        easing: "easeOutExpo",
        duration: 1100,
        delay: anime.stagger(70, { start: 200 }),
      });
    }

    // hint de scroll some ao rolar
    const hint = document.querySelector(".scroll-hint");
    if (hint) {
      ScrollTrigger.create({
        trigger: document.documentElement, start: "top top", end: "+=400",
        onUpdate: (self) => { hint.style.opacity = String(1 - Math.min(1, self.progress * 3)); },
      });
    }

    // ---- 5. FAQ acordeão ----
    document.querySelectorAll(".faq-item").forEach((it) => {
      const q = it.querySelector(".faq-q");
      if (!q) return;
      q.addEventListener("click", () => {
        const open = it.classList.toggle("open");
        q.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });

    ScrollTrigger.refresh();
  }
  start();
})();

// ===== Carrossel de módulos (independente do 3D) =====
(function () {
  const MODS = {
    dashboard: {
      ico: "◴", name: "Dashboard", tag: ["core", "Núcleo"],
      desc: "A visão de comando da operação. KPIs do dia, gráficos e atividade recente numa tela só.",
      feats: ["OS em andamento", "Receita do mês", "Clientes ativos", "Gráficos em tempo real"],
    },
    os: {
      ico: "▦", name: "Ordens de Serviço", tag: ["core", "Núcleo"],
      desc: "O coração do FrostERP. Kanban de \"Aguardando\" a \"Finalizado\", com histórico técnico, fotos do serviço e assinatura digital do cliente. Nada se perde no caminho.",
      feats: ["Lista + Kanban", "Fotos e histórico", "Assinatura digital", "Revisão por admin"],
    },
    financeiro: {
      ico: "◷", name: "Financeiro", tag: ["core", "Núcleo"],
      desc: "Operacional conversando com o caixa. Pipeline a receber, a pagar, vencidos e saldo previsto — com relatórios prontos pra imprimir.",
      feats: ["A receber / a pagar", "Vencidos e saldo previsto", "Receitas e despesas", "Relatórios imprimíveis"],
    },
    agenda: {
      ico: "▤", name: "Agenda", tag: ["core", "Núcleo"],
      desc: "Atividades dos técnicos sincronizadas com cada OS. Exporta direto pro Google Calendar e Outlook via feed iCal.",
      feats: ["Agenda por técnico", "Sincronizada com a OS", "Feed iCal", "Google / Outlook"],
    },
    cadastro: {
      ico: "⬡", name: "Cadastro", tag: ["core", "Núcleo"],
      desc: "Tudo centralizado num lugar: clientes, funcionários, fornecedores, produtos, serviços e movimentação de estoque.",
      feats: ["Clientes e fornecedores", "Produtos e serviços", "Funcionários", "Movimentação de estoque"],
    },
    config: {
      ico: "⚙", name: "Configurações", tag: ["core", "Núcleo"],
      desc: "Controle total da conta da empresa. Usuários e permissões por papel, 2FA, login biométrico, backup automático e segurança.",
      feats: ["Usuários e permissões", "2FA + biometria", "Backup automático", "Segurança da empresa"],
    },
    ia: {
      ico: "✦", name: "IA / Atendimento", tag: ["add", "Adicional"],
      desc: "Um agente no WhatsApp que atende seus clientes 24/7: responde dúvidas, propõe Ordens de Serviço pra sua aprovação e passa pro humano quando precisa.",
      feats: ["Atende no WhatsApp", "Propõe OS pra aprovar", "Handoff pro humano", "Ativado sob demanda"],
    },
    posvenda: {
      ico: "↻", name: "Pós-venda", tag: ["add", "Adicional"],
      desc: "Mantém o cliente perto depois do serviço. Follow-up automático, pesquisas e campanhas — personalizado de empresa para empresa.",
      feats: ["Follow-up automático", "Pesquisa de satisfação", "Campanhas", "Personalizável por empresa"],
    },
    custom: {
      ico: "✜", name: "Módulos sob medida", tag: ["custom", "Exclusivo"],
      desc: "Precisa de algo que nenhum ERP de prateleira tem? A gente desenha e constrói o módulo específico pra sua operação — do seu jeito, na sua realidade.",
      feats: ["Feito pra sua operação", "Integra com o que já existe", "Do levantamento ao deploy", "Evolui junto com você"],
    },
  };

  function renderDetail(key) {
    const m = MODS[key];
    const detail = document.getElementById("mod-detail");
    if (!m || !detail) return;
    detail.innerHTML =
      '<div class="d-ico" aria-hidden="true">' + m.ico + "</div>" +
      '<div class="d-body">' +
        '<div class="d-head"><h3>' + m.name + "</h3>" +
          '<span class="tag ' + m.tag[0] + '">' + m.tag[1] + "</span></div>" +
        '<p class="d-desc">' + m.desc + "</p>" +
        '<ul class="d-feats">' +
          m.feats.map((f) => '<li><span class="ck" aria-hidden="true">✓</span>' + f + "</li>").join("") +
        "</ul>" +
      "</div>";
    if (window.gsap) {
      window.gsap.fromTo(detail, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" });
    }
  }

  function initCarousel() {
    const track = document.getElementById("car-track");
    if (!track) return;
    const cards = Array.from(track.querySelectorAll(".mod-card"));

    cards.forEach((card) => {
      // estado inicial de acessibilidade
      card.setAttribute("aria-pressed", card.classList.contains("active") ? "true" : "false");
      card.addEventListener("click", () => {
        cards.forEach((c) => { c.classList.remove("active"); c.setAttribute("aria-pressed", "false"); });
        card.classList.add("active");
        card.setAttribute("aria-pressed", "true");
        renderDetail(card.dataset.key);
        card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });
    });

    const prev = document.querySelector(".car-prev");
    const next = document.querySelector(".car-next");
    const step = () => Math.max(220, track.clientWidth * 0.7);
    prev && prev.addEventListener("click", () => track.scrollBy({ left: -step(), behavior: "smooth" }));
    next && next.addEventListener("click", () => track.scrollBy({ left: step(), behavior: "smooth" }));

    renderDetail("dashboard"); // estado inicial

    // o painel de detalhe muda a altura da página → recalcula as posições
    // dos ScrollTriggers (senão a explosão do #cta dispara cedo demais)
    if (window.ScrollTrigger) {
      window.ScrollTrigger.refresh();
      setTimeout(() => window.ScrollTrigger.refresh(), 400);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCarousel);
  } else {
    initCarousel();
  }
})();
