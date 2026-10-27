// ─── FrostERP Mobile — casca do ERP no celular ───────────────────────────────
// Renderizada pelo App.jsx no lugar da sidebar/header quando a tela tem menos de
// 768px (useEhCelular). O desktop não muda. Estrutura (handoff do Claude Design):
//   topo (menu, empresa, tema, sino, perfil)
//   conteúdo rolável (uma tela por vez)
//   barra inferior com 4 módulos + "Mais", e a bolha que desliza até o ativo
//   menu lateral com todos os módulos permitidos
//   formulários em tela cheia (Nova OS, Lançamento, Cliente, Estoque, Agendar)
// Telas sem versão mobile própria (IA, Pós-Venda, Lembrete, Folha, Relatórios e
// o "modo completo" de qualquer módulo) usam o componente do desktop dentro da
// casca, via renderModulo() do App — mesma lógica, mesmo dado.

import "./mobile.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MobileCtx } from "./contexto.js";
import { Icone } from "./ui.jsx";
import { iniciais } from "./dados.js";
import Inicio from "./telas/Inicio.jsx";
import { ListaOS, DetalheOS } from "./telas/OrdensServico.jsx";
import Agenda from "./telas/Agenda.jsx";
import { Cadastros, Estoque } from "./telas/Cadastros.jsx";
import Financeiro from "./telas/Financeiro.jsx";
import Notificacoes from "./telas/Notificacoes.jsx";
import Configuracoes from "./telas/Configuracoes.jsx";
import { NovaOS, NovoLancamento, NovoCliente, MovimentarEstoque, Agendar } from "./formularios.jsx";

// Telas nativas do mobile → id do módulo no navItems do App (permissão).
const TELAS = {
  dash: { modulo: "dashboard", titulo: "Dashboard", icone: "dashboard" },
  os: { modulo: "processos", titulo: "Ordens de Serviço", icone: "os" },
  agenda: { modulo: "agenda", titulo: "Agenda", icone: "agenda" },
  financeiro: { modulo: "financeiro", titulo: "Financeiro", icone: "financeiro" },
  clientes: { modulo: "cadastro", titulo: "Cadastros", icone: "clientes" },
  estoque: { modulo: "cadastro", titulo: "Produtos / Estoque", icone: "estoque" },
  notificacoes: { modulo: null, titulo: "Notificações", icone: "sino" },
  config: { modulo: "config", titulo: "Configurações", icone: "config" },
};

// Módulos que abrem a tela do desktop dentro da casca (fase 2 do redesenho).
const LEGADOS = {
  ia: { titulo: "IA / Atendimento", icone: "ia" },
  "pos-venda": { titulo: "Pós-Venda", icone: "posvenda" },
  lembrete: { titulo: "Lembrete", icone: "lembrete" },
  folha: { titulo: "Folha de Pagamento", icone: "folha" },
  relatorios: { titulo: "Relatórios", icone: "relatorios" },
};

// Ordem do menu lateral (igual ao app real, sem Ponto Eletrônico — decisão do
// Gabriel no design). `null` = separador.
const MENU = ["dash", "os", "agenda", "financeiro", "clientes", "estoque", null,
  "ia", "pos-venda", "lembrete", "folha", "relatorios", null, "notificacoes", "config"];

// Barra inferior: 4 módulos mais usados + "Mais" (abre o menu lateral).
const ABAS = [
  { id: "dash", rotulo: "Início", icone: "dashboard", ativoEm: ["dash"] },
  { id: "os", rotulo: "OS", icone: "os", ativoEm: ["os"] },
  { id: "clientes", rotulo: "Clientes", icone: "clientes", ativoEm: ["clientes", "estoque"] },
  { id: "financeiro", rotulo: "Financeiro", icone: "financeiro", ativoEm: ["financeiro"] },
];

const ROTULO_PAPEL = { admin: "Admin", gerente: "Gerente", atendente: "Atendente", tecnico: "Técnico" };

// ─── Botão voltar (Android/navegador) ────────────────────────────────────────
// Uma pilha só para todas as camadas da casca (menu, formulários, detalhe da OS,
// módulo completo). Cada camada empilha um estado {fm: profundidade}; no
// popstate fechamos as camadas acima da profundidade atual. Estados que não são
// nossos (os Modais do desktop gravam {modal:true}) são ignorados — assim fechar
// um Modal dentro do "modo completo" não derruba a tela de baixo.
function usePilhaVoltar(irParaInicio, estaNoInicio) {
  const pilha = useRef([]);
  const inicioRef = useRef({ irParaInicio, estaNoInicio });
  useEffect(() => { inicioRef.current = { irParaInicio, estaNoInicio }; }, [irParaInicio, estaNoInicio]);

  useEffect(() => {
    // Estado-base: o primeiro "voltar" fora do Início leva ao Início em vez de sair do app.
    if (!window.history.state || window.history.state.fm === undefined) {
      window.history.pushState({ fm: 0 }, "");
    }
    const onPop = (e) => {
      const st = e.state;
      if (st && st.fm === undefined) return; // estado de outro componente (Modal legado)
      const profundidade = st ? st.fm : -1;
      while (pilha.current.length > Math.max(0, profundidade)) {
        const camada = pilha.current.pop();
        camada.fechar();
      }
      if (profundidade < 0 && !inicioRef.current.estaNoInicio) {
        inicioRef.current.irParaInicio();
        window.history.pushState({ fm: 0 }, "");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const abrir = useCallback((id, fechar) => {
    if (pilha.current.some((c) => c.id === id)) return;
    pilha.current.push({ id, fechar });
    window.history.pushState({ fm: pilha.current.length }, "");
  }, []);

  // Fecha pela interface (X, salvar, toque fora): remove a camada e o que está
  // acima dela e volta o histórico na mesma quantidade.
  const fechar = useCallback((id) => {
    const idx = pilha.current.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const removidas = pilha.current.splice(idx);
    removidas.reverse().forEach((c) => c.fechar());
    window.history.go(-removidas.length);
  }, []);

  return { abrir, fechar };
}

export default function MobileApp({
  user, data, db, addToast, reloadData, theme, setTheme, navItems,
  notifications, dismissNotif, pendingProposals, aiPendingCount, onLogout, renderModulo, api, demo, onLayoutClassico,
}) {
  const [tela, setTela] = useState("dash");
  const [drawer, setDrawer] = useState(false);
  const [osAberta, setOsAberta] = useState(null); // id da OS no detalhe
  const [form, setForm] = useState(null); // { nome, params }
  const [formTopo, setFormTopo] = useState(null); // formulário empilhado (Novo cliente dentro da Nova OS)
  const [completo, setCompleto] = useState(null); // módulo do desktop aberto em "modo completo"
  const [versao, setVersao] = useState(0); // força releitura de produtos/estoque após gravar
  const conteudoRef = useRef(null);

  const irParaInicio = useCallback(() => setTela("dash"), []);
  const voltar = usePilhaVoltar(irParaInicio, tela === "dash");

  // ─── Permissões: só o que o navItems do App liberou ───
  const permitidos = useMemo(() => new Set((navItems || []).map((n) => n.id)), [navItems]);
  const podeTela = useCallback((id) => {
    if (TELAS[id]) return TELAS[id].modulo === null || permitidos.has(TELAS[id].modulo);
    return permitidos.has(id);
  }, [permitidos]);
  const podeGerenciar = ["admin", "gerente", "atendente"].includes(user?.role);

  // ─── Dados (App.data + catálogos lidos direto do DB) ───
  const dados = useMemo(() => ({
    clientes: data?.clients || [],
    funcionarios: data?.employees || [],
    os: data?.services || [],
    agendamentos: data?.schedule || [],
    lancamentos: data?.finance || [],
    produtos: db.list("erp:product:"),
    estoques: db.list("erp:stock:"),
    fornecedores: db.list("erp:supplier:"),
  }), [data, db, versao]); // eslint-disable-line react-hooks/exhaustive-deps

  const recarregar = useCallback(() => {
    setVersao((v) => v + 1);
    if (reloadData) reloadData();
  }, [reloadData]);

  const empresa = useMemo(() => (user?.companyId ? db.get("erp:company:" + user.companyId) : null), [db, user]);

  // ─── Navegação ───
  const navegar = useCallback((id) => {
    if (!podeTela(id)) return;
    setDrawer(false);
    voltar.fechar("drawer");
    setTela(id);
    if (conteudoRef.current) conteudoRef.current.scrollTop = 0;
  }, [podeTela, voltar]);

  const abrirDrawer = useCallback(() => {
    setDrawer(true);
    voltar.abrir("drawer", () => setDrawer(false));
  }, [voltar]);
  const fecharDrawer = useCallback(() => voltar.fechar("drawer"), [voltar]);

  const abrirOS = useCallback((id) => {
    setOsAberta(id);
    voltar.abrir("os", () => setOsAberta(null));
  }, [voltar]);
  const fecharOS = useCallback(() => voltar.fechar("os"), [voltar]);

  const abrirForm = useCallback((nome, params = {}) => {
    setDrawer(false);
    // Novo cliente aberto de dentro da Nova OS/Agendar fica por cima e devolve o cliente criado.
    if (form && nome === "novoCliente") {
      setFormTopo({ nome, params });
      voltar.abrir("formTopo", () => setFormTopo(null));
      return;
    }
    setForm({ nome, params });
    voltar.abrir("form", () => setForm(null));
  }, [form, voltar]);
  const fecharForm = useCallback(() => voltar.fechar("form"), [voltar]);
  const fecharFormTopo = useCallback(() => voltar.fechar("formTopo"), [voltar]);

  const abrirCompleto = useCallback((modulo) => {
    setDrawer(false);
    setCompleto(modulo);
    voltar.abrir("completo", () => setCompleto(null));
  }, [voltar]);
  const fecharCompleto = useCallback(() => voltar.fechar("completo"), [voltar]);

  const alternarTema = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), [setTheme]);

  const ctx = useMemo(() => ({
    user, empresa, dados, db, api, addToast, recarregar, navegar, abrirOS, fecharOS, abrirForm, fecharForm,
    abrirCompleto, podeTela, podeGerenciar, theme, alternarTema, notifications: notifications || [], dismissNotif,
    pendingProposals: pendingProposals || 0, aiPendingCount: aiPendingCount || 0, onLogout, onLayoutClassico,
  }), [user, empresa, dados, db, api, addToast, recarregar, navegar, abrirOS, fecharOS, abrirForm, fecharForm,
    abrirCompleto, podeTela, podeGerenciar, theme, alternarTema, notifications, dismissNotif, pendingProposals,
    aiPendingCount, onLogout, onLayoutClassico]);

  // ─── Barra inferior: só abas permitidas; "Mais" acende no menu e nas telas do menu ───
  const abas = ABAS.filter((a) => podeTela(a.id));
  const idxAtivo = drawer ? abas.length : (() => {
    const i = abas.findIndex((a) => a.ativoEm.includes(tela));
    return i >= 0 ? i : abas.length;
  })();
  const colunas = abas.length + 1;

  const nNotif = (notifications || []).length;
  const nomeEmpresa = empresa?.nome || "FrostERP";
  const ehLegado = !!LEGADOS[tela];

  const renderTela = () => {
    if (ehLegado) return <Legado modulo={tela} renderModulo={renderModulo} />;
    switch (tela) {
      case "os": return <ListaOS />;
      case "agenda": return <Agenda />;
      case "clientes": return <Cadastros />;
      case "estoque": return <Estoque />;
      case "financeiro": return <Financeiro />;
      case "notificacoes": return <Notificacoes />;
      case "config": return <Configuracoes />;
      default: return <Inicio />;
    }
  };

  const renderForm = (f, fechar, topo) => {
    if (!f) return null;
    const props = { params: f.params, onFechar: fechar, topo };
    switch (f.nome) {
      case "novaOs": return <NovaOS {...props} />;
      case "novoLancamento": return <NovoLancamento {...props} />;
      case "novoCliente": return <NovoCliente {...props} />;
      case "estoque": return <MovimentarEstoque {...props} />;
      case "agendar": return <Agendar {...props} />;
      default: return null;
    }
  };

  return (
    <MobileCtx.Provider value={ctx}>
      <div className="fm">
        {/* ─── Topo ─── */}
        <header className="fm-top">
          <button type="button" className="fm-iconbtn" style={{ marginLeft: -10, color: "var(--t1)" }} onClick={abrirDrawer} aria-label="Abrir menu">
            <Icone nome="menu" size={22} />
          </button>
          <img src={empresa?.logoUrl || "/frosterp-snowflake.svg"} alt="" style={{ width: 26, height: 26, objectFit: "contain" }}
            onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/frosterp-snowflake.svg"; }} />
          <div className="grow" style={{ lineHeight: 1.15 }}>
            <div className="ell" style={{ fontWeight: 700, fontSize: 15 }}>{nomeEmpresa}</div>
            <div className="ell" style={{ fontSize: 11.5, color: "var(--t3)" }}>{user?.nome} · {ROTULO_PAPEL[user?.role] || user?.role}</div>
          </div>
          <button type="button" className="fm-iconbtn" onClick={alternarTema} aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}>
            <Icone nome={theme === "dark" ? "sol" : "lua"} size={20} />
          </button>
          <button type="button" className="fm-iconbtn" onClick={() => navegar("notificacoes")} aria-label={`Notificações (${nNotif})`}>
            <Icone nome="sino" size={21} />
            {nNotif > 0 && <span className="fm-dot">{nNotif > 9 ? "9+" : nNotif}</span>}
          </button>
          {podeTela("config") ? (
            <button type="button" className="fm-avatar" style={{ marginRight: -4 }} onClick={() => navegar("config")} aria-label="Perfil e configurações">
              {iniciais(user?.nome).slice(0, 1)}
            </button>
          ) : (
            <span className="fm-avatar" style={{ marginRight: -4 }}>{iniciais(user?.nome).slice(0, 1)}</span>
          )}
        </header>

        {/* ─── Conteúdo ─── */}
        <main ref={conteudoRef} className="fm-main scroll-y">
          {renderTela()}
        </main>

        {/* Modo demonstração: faixa fina acima da barra (o banner do desktop é fixo e cobriria a barra) */}
        {demo && (
          <div className="row" style={{ flex: "none", gap: 8, padding: "6px 16px", background: "#0e7490", color: "#fff", fontSize: 12.5 }}>
            <span className="grow" style={{ fontWeight: 600 }}>🧪 Modo demonstração</span>
            <button type="button" onClick={demo.onReset} style={{ border: 0, borderRadius: 8, padding: "5px 10px", background: "rgba(0,0,0,.2)", color: "#fff", fontSize: 12, fontWeight: 600 }}>Resetar</button>
          </div>
        )}

        {/* ─── Barra inferior ─── */}
        <nav className="fm-tabs" style={{ gridTemplateColumns: `repeat(${colunas}, 1fr)` }} aria-label="Navegação principal">
          <div className="fm-pill" style={{ width: `calc((100% - 12px) / ${colunas})`, left: `calc(6px + ${idxAtivo} * (100% - 12px) / ${colunas})` }} />
          {abas.map((a, i) => (
            <button key={a.id} type="button" className={`fm-tab${idxAtivo === i ? " on" : ""}`} onClick={() => navegar(a.id)}
              aria-current={idxAtivo === i ? "page" : undefined}>
              <Icone nome={a.icone} size={22} stroke={1.3} />
              {a.rotulo}
            </button>
          ))}
          <button type="button" className={`fm-tab${idxAtivo === abas.length ? " on" : ""}`} onClick={abrirDrawer}>
            <Icone nome="mais" size={22} stroke={1.3} />
            Mais
          </button>
        </nav>

        {/* ─── Camadas ─── */}
        {osAberta && <DetalheOS osId={osAberta} />}
        {completo && <Completo modulo={completo} renderModulo={renderModulo} onFechar={fecharCompleto} />}
        {renderForm(form, fecharForm, false)}
        {renderForm(formTopo, fecharFormTopo, true)}

        {drawer && (
          <div className="fm-drawer">
            <div className="fm-drawer-panel">
              <div className="row" style={{ gap: 10, padding: "6px 16px 14px", borderBottom: "1px solid var(--b1)" }}>
                <img src={empresa?.logoUrl || "/frosterp-snowflake.svg"} alt="" style={{ width: 30, height: 30, objectFit: "contain" }}
                  onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/frosterp-snowflake.svg"; }} />
                <div className="grow" style={{ lineHeight: 1.15 }}>
                  <div className="ell" style={{ fontWeight: 700, fontSize: 15 }}>{nomeEmpresa}</div>
                  <div style={{ fontSize: 11.5, color: "var(--t3)" }}>Gestão integrada</div>
                </div>
                <button type="button" className="fm-iconbtn" style={{ width: 40, height: 40 }} onClick={fecharDrawer} aria-label="Fechar menu">
                  <Icone nome="fechar" size={20} stroke={1.6} />
                </button>
              </div>
              <div className="scroll-y" style={{ flex: 1, padding: 10, display: "flex", flexDirection: "column", gap: 2 }}>
                {MENU.filter((id, i, arr) => {
                  // Some com separador duplicado quando o grupo inteiro foi filtrado
                  if (id === null) return i > 0 && arr[i - 1] !== null && podeTela(arr[i - 1]);
                  return podeTela(id);
                }).map((id, i) => {
                  if (id === null) return <div key={"sep" + i} className="fm-drawer-sep" />;
                  const def = TELAS[id] || LEGADOS[id];
                  const ativo = tela === id;
                  const contador = id === "notificacoes" ? nNotif : id === "ia" ? (aiPendingCount || 0) : id === "os" ? (pendingProposals || 0) : 0;
                  return (
                    <button key={id} type="button" className={`fm-drawer-item${ativo ? " on" : ""}`} onClick={() => navegar(id)}>
                      <Icone nome={def.icone} size={20} stroke={1.2} />
                      <span className="grow">{def.titulo}</span>
                      {contador > 0 && (
                        <span style={{ minWidth: 20, height: 20, padding: "0 6px", borderRadius: 10, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center",
                          background: id === "notificacoes" ? "#ef4444" : "var(--orgbg)", color: id === "notificacoes" ? "#fff" : "var(--org)" }}>
                          {contador > 9 ? "9+" : contador}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="row" style={{ gap: 10, padding: "10px 16px 0", borderTop: "1px solid var(--b1)" }}>
                <span className="fm-avatar" style={{ cursor: "default" }}>{iniciais(user?.nome).slice(0, 1)}</span>
                <div className="grow" style={{ lineHeight: 1.15 }}>
                  <div className="ell" style={{ fontSize: 13.5, fontWeight: 600 }}>{user?.nome}</div>
                  <div style={{ fontSize: 11.5, color: "var(--t3)" }}>{ROTULO_PAPEL[user?.role] || user?.role}</div>
                </div>
                <button type="button" className="fm-iconbtn" style={{ width: 40, height: 40, color: "var(--t3)" }} onClick={onLogout} aria-label="Sair">
                  <Icone nome="sair" size={20} stroke={1.3} />
                </button>
              </div>
            </div>
            <div className="fm-drawer-scrim" onClick={fecharDrawer} />
          </div>
        )}
      </div>
    </MobileCtx.Provider>
  );
}

// Tela do desktop dentro do conteúdo (módulos do menu sem versão mobile própria).
function Legado({ modulo, renderModulo }) {
  return (
    <div className="fm-legacy fm-screen" key={modulo}>
      {renderModulo(modulo)}
    </div>
  );
}

// "Modo completo": abre o módulo inteiro do desktop por cima da tela atual, para
// o que o celular ainda não faz (editar OS com várias peças, revisar OS do
// técnico, configurações avançadas…). Fechar volta exatamente para onde estava.
const TITULO_COMPLETO = {
  processos: "Ordens de Serviço", agenda: "Agenda", financeiro: "Financeiro", cadastro: "Cadastros", config: "Configurações",
};
function Completo({ modulo, renderModulo, onFechar }) {
  return (
    <div className="fm-sheet" role="dialog" aria-modal="true" aria-label={TITULO_COMPLETO[modulo] || "Módulo"}>
      <div className="fm-sheet-head">
        <button type="button" className="fm-iconbtn" style={{ marginLeft: -10, color: "var(--t1)" }} onClick={onFechar} aria-label="Voltar">
          <Icone nome="voltar" size={22} stroke={1.6} />
        </button>
        <div className="grow" style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{TITULO_COMPLETO[modulo] || "Módulo"}</div>
          <div style={{ fontSize: 12, color: "var(--t3)" }}>Modo completo</div>
        </div>
      </div>
      <div className="scroll-y" style={{ flex: 1, minHeight: 0, padding: "14px 16px calc(var(--safe-bottom) + 24px)" }}>
        <div className="fm-legacy" style={{ paddingTop: 0 }}>{renderModulo(modulo)}</div>
      </div>
    </div>
  );
}
