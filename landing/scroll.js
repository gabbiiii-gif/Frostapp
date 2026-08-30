// scroll.js — orquestra texto alternado + cena 3D no scroll (GSAP + anime.js)
(function () {
  function start() {
    if (!window.gsap || !window.ScrollTrigger || !window.frostScene) {
      return setTimeout(start, 60);
    }
    const gsap = window.gsap;
    gsap.registerPlugin(window.ScrollTrigger);
    // não recalcula triggers quando a barra de endereço do mobile aparece/some (evita scroll "pulando")
    window.ScrollTrigger.config({ ignoreMobileResize: true });
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

    // ---- 2. Por painel: balanço do cristal + entrada lateral do conteúdo ----
    const narrow = window.matchMedia("(max-width: 820px)").matches;
    const SHIFT = narrow ? 44 : 110;   // quanto o conteúdo desliza na horizontal
    const USE_BLUR = !narrow;          // blur reblura a cada frame — pesado no celular

    const panels = gsap.utils.toArray(".panel");
    panels.forEach((panel, i) => {
      const side = panel.dataset.side || "center";
      // cristal vai para o lado OPOSTO ao texto
      const balance = side === "left" ? 1.9 : side === "right" ? -1.9 : 0;
      const twist = (i % 2 === 0 ? 1 : -1) * 0.25;
      // data-dim: seções de texto denso pedem o floco discreto (default 1 = cheio)
      const dimAttr = parseFloat(panel.dataset.dim);
      const dim = isNaN(dimAttr) ? 1 : dimAttr;

      ScrollTrigger.create({
        trigger: panel,
        start: "top 60%",
        end: "bottom 40%",
        onToggle: (self) => {
          if (self.isActive) {
            fs.setBalance(balance);
            fs.setTwist(twist);
            if (fs.setDim) fs.setDim(dim);
          }
        },
      });

      // Entrada lateral: cada item entra pelo lado em que o painel está ancorado,
      // com fade+blur amarrados à rolagem (scrub) — não é um disparo único.
      const items = panel.querySelectorAll("[data-reveal]");
      if (!items.length) return;

      if (reduced) {
        gsap.set(items, { opacity: 1, x: 0, y: 0, filter: "none" });
        return;
      }

      // painéis centrais alternam o lado pra não ficar monótono; o hero não desliza
      const dir = side === "left" ? -1 : side === "right" ? 1 : (i % 2 === 0 ? -1 : 1);
      const fromX = panel.id === "hero" ? 0 : dir * SHIFT;

      gsap.set(items, {
        opacity: 0,
        x: fromX,
        y: fromX ? 0 : 34,
        filter: USE_BLUR ? "blur(6px)" : "none",
      });

      gsap.timeline({
        scrollTrigger: { trigger: panel, start: "top 88%", end: "top 38%", scrub: 0.7 },
      }).to(items, {
        opacity: 1, x: 0, y: 0,
        filter: USE_BLUR ? "blur(0px)" : "none",
        ease: "power2.out", duration: 1, stagger: 0.12,
      });
    });

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

// ===== ScrollStack — porte vanilla do <ScrollStack /> do React Bits =====
// Fonte: https://reactbits.dev/components/scroll-stack (variante JS-CSS).
// Mesma matemática de pin + escala + blur por profundidade do componente React.
// Duas adaptações conscientes:
//  1. SEM Lenis (dependência do pacote original): o smooth-scroll global dele
//     sequestra o scroll da janela e brigaria com o ScrollTrigger que dirige o
//     floco 3D. Aqui a leitura é do scroll nativo, num rAF com throttle.
//  2. Offsets via offsetTop (layout) em vez de getBoundingClientRect: o rect é
//     afetado pelo transform que a própria pilha aplica → realimentação.
(function () {
  const CFG = {
    itemDistance: 120,       // espaço de rolagem entre um cartão e o próximo
    itemScale: 0.03,         // cada degrau da pilha fica um tico maior que o de baixo
    itemStackDistance: 40,   // desencontro vertical entre os cartões empilhados
    stackPosition: 0.26,     // onde a pilha "gruda" (fração da altura da viewport)
    scaleEndPosition: 0.12,  // onde a redução de escala termina
    baseScale: 0.88,         // escala do cartão do fundo da pilha
    rotationAmount: 0,       // giro por profundidade (0 = pilha reta)
    blurAmount: 1.6,         // desfoque por profundidade (só no desktop)
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const narrow = window.matchMedia("(max-width: 820px)").matches;

  // posição no documento por offsetTop — imune aos transforms da pilha
  function docTop(el) {
    let y = 0, node = el;
    while (node) { y += node.offsetTop; node = node.offsetParent; }
    return y;
  }

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const progress = (v, a, b) => (b === a ? (v >= b ? 1 : 0) : clamp01((v - a) / (b - a)));

  function initStack(root) {
    const cards = Array.from(root.querySelectorAll(".scroll-stack-card"));
    const endEl = root.querySelector(".scroll-stack-end");
    if (!cards.length || !endEl || reduced) return;  // reduced-motion: CSS já neutraliza

    const blurAmount = narrow ? 0 : CFG.blurAmount;
    const enterShift = narrow ? 44 : 110;
    // entra pelo lado em que o painel está ancorado (mesma regra do resto da página)
    const panel = root.closest(".panel");
    const side = (panel && panel.dataset.side) || "left";
    const dirX = side === "right" ? 1 : -1;

    cards.forEach((card, i) => {
      if (i < cards.length - 1) card.style.marginBottom = CFG.itemDistance + "px";
    });

    const last = new Map();
    let ticking = false;

    function update() {
      ticking = false;
      const vh = window.innerHeight;
      const scrollTop = window.scrollY;
      const stackPx = CFG.stackPosition * vh;
      const scaleEndPx = CFG.scaleEndPosition * vh;
      const pinEnd = docTop(endEl) - vh / 2;

      // qual cartão está no topo da pilha agora — define a profundidade do blur
      let topIndex = 0;
      for (let j = 0; j < cards.length; j++) {
        if (scrollTop >= docTop(cards[j]) - stackPx - CFG.itemStackDistance * j) topIndex = j;
      }

      cards.forEach((card, i) => {
        const cardTop = docTop(card);
        const pinStart = cardTop - stackPx - CFG.itemStackDistance * i;
        const scaleP = progress(scrollTop, pinStart, cardTop - scaleEndPx);
        const scale = 1 - scaleP * (1 - (CFG.baseScale + i * CFG.itemScale));
        const rotation = CFG.rotationAmount ? i * CFG.rotationAmount * scaleP : 0;
        const blur = blurAmount && i < topIndex ? (topIndex - i) * blurAmount : 0;

        // pin: o cartão acompanha o scroll pra ficar parado na tela
        let translateY = 0;
        if (scrollTop >= pinStart && scrollTop <= pinEnd) {
          translateY = scrollTop - cardTop + stackPx + CFG.itemStackDistance * i;
        } else if (scrollTop > pinEnd) {
          translateY = pinEnd - cardTop + stackPx + CFG.itemStackDistance * i;
        }

        // entrada lateral + fade no MESMO transform (o GSAP não toca nestes cartões)
        const enterP = progress(scrollTop, cardTop - vh, cardTop - vh * 0.62);
        const translateX = (1 - enterP) * enterShift * dirX;

        const t = {
          x: Math.round(translateX * 100) / 100,
          y: Math.round(translateY * 100) / 100,
          s: Math.round(scale * 1000) / 1000,
          r: Math.round(rotation * 100) / 100,
          b: Math.round(blur * 100) / 100,
          o: Math.round(enterP * 100) / 100,
        };
        const p = last.get(i);
        if (p && Math.abs(p.x - t.x) <= 0.1 && Math.abs(p.y - t.y) <= 0.1 &&
            Math.abs(p.s - t.s) <= 0.001 && Math.abs(p.r - t.r) <= 0.1 &&
            Math.abs(p.b - t.b) <= 0.1 && Math.abs(p.o - t.o) <= 0.01) return;

        card.style.transform =
          "translate3d(" + t.x + "px, " + t.y + "px, 0) scale(" + t.s + ") rotate(" + t.r + "deg)";
        card.style.filter = t.b > 0 ? "blur(" + t.b + "px)" : "";
        card.style.opacity = String(t.o);
        last.set(i, t);
      });
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", () => { last.clear(); onScroll(); });
    // a pilha muda a altura da página → o ScrollTrigger precisa remedir
    if (window.ScrollTrigger) setTimeout(() => window.ScrollTrigger.refresh(), 300);
    update();
  }

  function boot() {
    document.querySelectorAll("[data-scroll-stack]").forEach(initStack);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

// ===== CardSwap — porte vanilla do <CardSwap /> do React Bits =====
// Fonte: https://reactbits.dev/components/card-swap (variante JS-CSS).
// O original já depende de GSAP, que a landing carrega, então a matemática dos
// slots (makeSlot/placeNow) e a timeline de troca vieram inteiras. O que mudou:
//  1. Camada React (refs, cloneElement, useEffect) virou DOM puro.
//  2. As imagens são pré-carregadas: tela que não existe no servidor simplesmente
//     não entra, e com menos de 2 telas a vitrine some em vez de mostrar quadro
//     quebrado no meio da seção.
//  3. Rodízio de telas: a pilha tem 5 cartões, mas o pool de telas pode ser maior.
//     A troca de imagem acontece no instante em que o cartão da frente já caiu
//     fora do quadro — então a mudança não aparece.
//  4. Só anima com a seção na tela (IntersectionObserver): timeline rodando em
//     background é CPU à toa.
(function () {
  const CFG = {
    cardDistance: 56,       // desencontro horizontal entre cartões da pilha
    verticalDistance: 46,   // desencontro vertical
    delay: 5000,            // intervalo entre trocas
    pauseOnHover: false,
    skewAmount: 6,
    dropDistance: 500,      // quanto o cartão da frente cai antes de voltar pro fundo
    stackSize: 5,           // cartões visíveis na pilha (o resto entra por rodízio)
    easing: "elastic",
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const makeSlot = (i, distX, distY, total) => ({
    x: i * distX, y: -i * distY, z: -i * distX * 1.5, zIndex: total - i,
  });

  const placeNow = (gsap, el, slot, skew) => gsap.set(el, {
    x: slot.x, y: slot.y, z: slot.z, xPercent: -50, yPercent: -50,
    skewY: skew, transformOrigin: "center center", zIndex: slot.zIndex, force3D: true,
  });

  // resolve true/false sem estourar: tela ausente não pode derrubar a seção
  const preload = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });

  function paint(card, shot) {
    const img = card.querySelector("img");
    const tag = card.querySelector(".swap-tag");
    if (img) { img.src = shot.src; img.alt = "FrostERP — tela de " + shot.label; }
    if (tag) tag.textContent = shot.label;
  }

  async function initSwap(stage) {
    const gsap = window.gsap;
    const shots = stage.closest(".demo-shots");
    const declared = Array.from(stage.querySelectorAll(".swap-card"));
    if (!shots || !declared.length) return;

    // pool = só as telas que existem mesmo no servidor
    const pool = [];
    for (const card of declared) {
      const img = card.querySelector("img");
      const src = img && img.dataset.src;
      if (src && (await preload(src))) pool.push({ src, label: card.dataset.label || "" });
    }
    if (pool.length < 2) { declared.forEach((c) => c.remove()); return; }

    const total = Math.min(CFG.stackSize, pool.length);
    declared.slice(total).forEach((c) => c.remove());
    const cards = declared.slice(0, total);
    cards.forEach((card, i) => paint(card, pool[i]));
    let nextShot = total % pool.length;

    shots.classList.add("ready");
    cards.forEach((el, i) =>
      placeNow(gsap, el, makeSlot(i, CFG.cardDistance, CFG.verticalDistance, total), CFG.skewAmount));

    if (reduced) return;   // pilha estática, sem rodízio

    const config = CFG.easing === "elastic"
      ? { ease: "elastic.out(0.6,0.9)", durDrop: 2, durMove: 2, durReturn: 2, promoteOverlap: 0.9, returnDelay: 0.05 }
      : { ease: "power1.inOut", durDrop: 0.8, durMove: 0.8, durReturn: 0.8, promoteOverlap: 0.45, returnDelay: 0.2 };

    let order = cards.map((_, i) => i);

    function swap() {
      if (order.length < 2) return;
      const [front, ...rest] = order;
      const elFront = cards[front];
      const tl = gsap.timeline();

      tl.to(elFront, { y: "+=" + CFG.dropDistance, duration: config.durDrop, ease: config.ease });
      tl.addLabel("promote", "-=" + config.durDrop * config.promoteOverlap);

      rest.forEach((idx, i) => {
        const el = cards[idx];
        const slot = makeSlot(i, CFG.cardDistance, CFG.verticalDistance, total);
        tl.set(el, { zIndex: slot.zIndex }, "promote");
        tl.to(el, { x: slot.x, y: slot.y, z: slot.z, duration: config.durMove, ease: config.ease },
          "promote+=" + i * 0.15);
      });

      const backSlot = makeSlot(total - 1, CFG.cardDistance, CFG.verticalDistance, total);
      tl.addLabel("return", "promote+=" + config.durMove * config.returnDelay);
      tl.call(() => {
        gsap.set(elFront, { zIndex: backSlot.zIndex });
        // o cartão está caído fora do quadro agora — trocar a tela aqui é invisível
        if (pool.length > total) {
          paint(elFront, pool[nextShot]);
          nextShot = (nextShot + 1) % pool.length;
        }
      }, undefined, "return");
      tl.to(elFront, { x: backSlot.x, y: backSlot.y, z: backSlot.z, duration: config.durReturn, ease: config.ease }, "return");
      tl.call(() => { order = [...rest, front]; });
    }

    // roda só com a seção na tela. O intervalo nunca é destruído no meio de uma
    // troca — parar a timeline pela metade deixaria a pilha desalinhada.
    let visible = false;
    let hovering = false;
    setInterval(() => { if (visible && !hovering) swap(); }, CFG.delay);

    // sempre via window: o identificador solto não resolve em todo contexto
    const IO = window.IntersectionObserver;
    if (IO) {
      new IO((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !visible) { visible = true; swap(); }
          else if (!e.isIntersecting) visible = false;
        });
      }, { threshold: 0.15 }).observe(shots);
    } else { visible = true; swap(); }

    if (CFG.pauseOnHover) {
      shots.addEventListener("mouseenter", () => { hovering = true; });
      shots.addEventListener("mouseleave", () => { hovering = false; });
    }
  }

  function boot() {
    if (!window.gsap) return void setTimeout(boot, 60);
    document.querySelectorAll("[data-card-swap]").forEach(initSwap);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
