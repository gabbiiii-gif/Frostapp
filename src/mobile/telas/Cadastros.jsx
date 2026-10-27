// ─── Cadastros e Estoque — celular ───────────────────────────────────────────
// Cadastros: clientes, fornecedores e funcionários em lista com busca; o toque
// abre ações rápidas (ligar, WhatsApp, nova OS, agendar). Estoque: produtos com
// saldo, alerta de mínimo e movimentação (entrada/saída/ajuste) em 2 toques.

import { useMemo, useState } from "react";
import { useMobile } from "../contexto.js";
import { Acoes, Avatar, Busca, Chips, Fab, Titulo, Vazio, linkTelefone, linkWhatsApp } from "../ui.jsx";
import { casaBusca, produtosComEstoque, valorEmEstoque, normalizar } from "../dados.js";
import { formatCurrency } from "../../utils.js";

const POR_PAGINA = 50;

export function Cadastros() {
  const { user, dados, navegar, abrirForm, abrirCompleto, podeGerenciar, podeTela } = useMobile();
  const verFuncionarios = user?.role === "admin" || user?.role === "gerente";
  const [aba, setAba] = useState("clientes");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(POR_PAGINA);
  const [acoes, setAcoes] = useState(null);

  const osPorCliente = useMemo(() => {
    const m = new Map();
    for (const os of dados.os) if (os.clienteId) m.set(os.clienteId, (m.get(os.clienteId) || 0) + 1);
    return m;
  }, [dados.os]);

  const lista = useMemo(() => {
    const ordenar = (arr) => [...arr].sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
    if (aba === "fornecedores") {
      return ordenar(dados.fornecedores.filter((f) => casaBusca(busca, f.nome, f.contato, f.telefone, f.cnpj, f.cpf, f.categoria)));
    }
    if (aba === "funcionarios") {
      return ordenar(dados.funcionarios.filter((f) => casaBusca(busca, f.nome, f.cargo, f.telefone, f.cpf)));
    }
    return ordenar(dados.clientes.filter((c) => casaBusca(busca, c.nome, c.telefone, c.cpf, c.cnpj, c.email, c.endereco?.cidade, c.endereco?.bairro)));
  }, [aba, busca, dados]);

  const sub = [
    `${dados.clientes.length} clientes`,
    `${dados.fornecedores.length} fornecedores`,
    verFuncionarios ? `${dados.funcionarios.length} funcionários` : null,
  ].filter(Boolean).join(" · ");

  const abas = [
    { id: "clientes", label: "Clientes" },
    { id: "fornecedores", label: "Fornecedores" },
    verFuncionarios && { id: "funcionarios", label: "Funcionários" },
  ].filter(Boolean);

  const placeholder = aba === "clientes" ? "Nome, CPF/CNPJ ou telefone…" : aba === "fornecedores" ? "Fornecedor, contato ou categoria…" : "Nome, cargo ou telefone…";

  return (
    <div className="fm-screen">
      <Titulo titulo="Cadastros" sub={sub} />
      <div className="scroll-x">
        {abas.map((a) => (
          <button key={a.id} type="button" className={`fm-chip${aba === a.id ? " on" : ""}`} style={{ height: 36 }}
            onClick={() => { setAba(a.id); setBusca(""); setLimite(POR_PAGINA); }}>
            {a.label}
          </button>
        ))}
        {podeTela("estoque") && (
          <button type="button" className="fm-chip" style={{ height: 36 }} onClick={() => navegar("estoque")}>Produtos / Estoque</button>
        )}
      </div>
      <Busca valor={busca} onChange={(v) => { setBusca(v); setLimite(POR_PAGINA); }} placeholder={placeholder} />

      {lista.length === 0 ? (
        <Vazio>{busca ? "Nada encontrado para essa busca." : "Nenhum cadastro ainda."}</Vazio>
      ) : (
        <div className="fm-list">
          {lista.slice(0, limite).map((p) => {
            if (aba === "clientes") {
              const n = osPorCliente.get(p.id) || 0;
              const ativo = p.status !== "inativo";
              const local = p.endereco?.cidade || p.endereco?.bairro || (p.cnpj ? "CNPJ" : "");
              return (
                <button key={p.id} type="button" className="fm-li" style={{ minHeight: 64 }} onClick={() => setAcoes({ tipo: "cliente", p })}>
                  <Avatar nome={p.nome} tom={ativo ? "brand" : "mute"} />
                  <div className="grow">
                    <div className="ell" style={{ fontSize: 15, fontWeight: 600 }}>{p.nome}</div>
                    <div className="fm-li-s ell">{[p.telefone, local].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{n} OS</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: ativo ? "var(--ok)" : "var(--t3)" }}>{ativo ? "Ativo" : "Inativo"}</div>
                  </div>
                </button>
              );
            }
            const subtitulo = aba === "fornecedores" ? [p.categoria, p.contato, p.telefone].filter(Boolean).join(" · ") : [p.cargo, p.telefone].filter(Boolean).join(" · ");
            const ativo = p.status !== "inativo";
            return (
              <button key={p.id} type="button" className="fm-li" style={{ minHeight: 64 }} onClick={() => setAcoes({ tipo: aba, p })}>
                <Avatar nome={p.nome} tom={ativo ? "brand" : "mute"} />
                <div className="grow">
                  <div className="ell" style={{ fontSize: 15, fontWeight: 600 }}>{p.nome}</div>
                  <div className="fm-li-s ell">{subtitulo || "—"}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: ativo ? "var(--ok)" : "var(--t3)", flex: "none" }}>{ativo ? "Ativo" : "Inativo"}</div>
              </button>
            );
          })}
        </div>
      )}
      {lista.length > limite && (
        <button type="button" className="fm-btn ghost" onClick={() => setLimite((l) => l + POR_PAGINA)}>Mostrar mais ({lista.length - limite})</button>
      )}

      {podeGerenciar && (aba === "clientes"
        ? <Fab rotulo="Novo cliente" onClick={() => abrirForm("novoCliente")} />
        : <Fab rotulo={aba === "fornecedores" ? "Novo fornecedor" : "Novo funcionário"} onClick={() => abrirCompleto("cadastro")} />)}

      {acoes && (
        <Acoes titulo={acoes.p.nome} sub={acoes.p.telefone || acoes.p.email || ""} onFechar={() => setAcoes(null)}
          acoes={[
            acoes.tipo === "cliente" && podeGerenciar && podeTela("os") && { rotulo: "Nova OS para este cliente", icone: "os", onClick: () => abrirForm("novaOs", { clienteId: acoes.p.id }) },
            acoes.tipo === "cliente" && podeGerenciar && podeTela("agenda") && { rotulo: "Agendar visita", icone: "agenda", onClick: () => abrirForm("agendar", { clienteId: acoes.p.id }) },
            acoes.p.telefone && { rotulo: "Ligar", icone: "telefone", href: linkTelefone(acoes.p.telefone) },
            acoes.p.telefone && { rotulo: "WhatsApp", icone: "whatsapp", href: linkWhatsApp(acoes.p.telefone) },
            podeGerenciar && { rotulo: "Editar cadastro (modo completo)", icone: "editar", onClick: () => abrirCompleto("cadastro") },
          ]} />
      )}
    </div>
  );
}

// ─── Estoque ─────────────────────────────────────────────────────────────────
export function Estoque() {
  const { dados, abrirForm, abrirCompleto, podeGerenciar } = useMobile();
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("todos");
  const [limite, setLimite] = useState(POR_PAGINA);
  const [acoes, setAcoes] = useState(null);

  const itens = useMemo(() => produtosComEstoque(dados.produtos, dados.estoques), [dados.produtos, dados.estoques]);
  const baixo = itens.filter((i) => i.nivel === "bad" || (i.nivel === "warn" && i.minimo > 0));
  const categorias = useMemo(() => {
    const set = new Set(itens.map((i) => i.produto.categoria).filter(Boolean));
    return [{ id: "todos", label: "Todos" }, ...(baixo.length ? [{ id: "baixo", label: "Abaixo do mínimo" }] : []),
      ...[...set].sort().map((c) => ({ id: c, label: c }))];
  }, [itens, baixo.length]);

  const lista = itens.filter((i) => {
    if (categoria === "baixo" && !baixo.includes(i)) return false;
    if (categoria !== "todos" && categoria !== "baixo" && i.produto.categoria !== categoria) return false;
    return casaBusca(busca, i.produto.nome, i.produto.codigo, i.produto.codigoBarras, i.produto.categoria);
  });

  const valor = valorEmEstoque(itens);

  return (
    <div className="fm-screen">
      <Titulo titulo="Estoque" sub={`${itens.length} produtos · ${formatCurrency(valor)} em estoque`} />

      {baixo.length > 0 && (
        <button type="button" className="fm-alert fm-tap" style={{ textAlign: "left", color: "var(--t1)" }} onClick={() => setCategoria("baixo")}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: "var(--bad)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, flex: "none" }}>
            {baixo.length}
          </span>
          <div className="grow" style={{ fontSize: 13.5, lineHeight: 1.3 }}>
            <b style={{ color: "var(--bad)" }}>{baixo.length === 1 ? "item abaixo do mínimo" : "itens abaixo do mínimo"}</b>
            <div className="ell" style={{ color: "var(--t2)", fontSize: 12.5 }}>{baixo.slice(0, 4).map((i) => normalizarNome(i.produto.nome)).join(", ")}</div>
          </div>
        </button>
      )}

      <Busca valor={busca} onChange={(v) => { setBusca(v); setLimite(POR_PAGINA); }} placeholder="Buscar produto ou código…" />
      {categorias.length > 1 && <Chips opcoes={categorias} valor={categoria} onChange={(v) => { setCategoria(v); setLimite(POR_PAGINA); }} soft />}

      <div className="stack" style={{ gap: 8 }}>
        {lista.length === 0 && <Vazio>{itens.length === 0 ? "Nenhum produto cadastrado." : "Nenhum produto encontrado."}</Vazio>}
        {lista.slice(0, limite).map((i) => {
          const cor = i.nivel === "bad" ? "var(--bad)" : i.nivel === "warn" ? "var(--warn)" : "var(--t1)";
          const preco = Number(i.produto.precoVenda) || Number(i.produto.precoCusto) || 0;
          return (
            <button key={i.produto.id} type="button" className="fm-card fm-tap" onClick={() => setAcoes(i)}
              style={{ padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", textAlign: "left", color: "var(--t1)", width: "100%" }}>
              <div className="grow">
                <div style={{ fontSize: 15, fontWeight: 600 }} className="ell">{i.produto.nome}</div>
                <div className="ell" style={{ fontSize: 12.5, color: "var(--t3)", marginTop: 2 }}>
                  {[i.produto.codigo, i.estoque ? `mín. ${i.minimo}` : "sem estoque cadastrado", preco ? formatCurrency(preco) : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: cor, lineHeight: 1 }}>{i.saldo == null ? "—" : i.saldo}</div>
                <div style={{ fontSize: 11, color: "var(--t3)" }}>{String(i.produto.unidade || "un").toLowerCase()}</div>
              </div>
            </button>
          );
        })}
        {lista.length > limite && (
          <button type="button" className="fm-btn ghost" onClick={() => setLimite((l) => l + POR_PAGINA)}>Mostrar mais ({lista.length - limite})</button>
        )}
      </div>

      {podeGerenciar && <Fab rotulo="Entrada" onClick={() => abrirForm("estoque", { tipo: "entrada" })} />}

      {acoes && (
        <Acoes titulo={acoes.produto.nome} sub={acoes.saldo == null ? "Sem estoque cadastrado" : `Saldo ${acoes.saldo} · mínimo ${acoes.minimo}`} onFechar={() => setAcoes(null)}
          acoes={acoes.estoque && podeGerenciar ? [
            { rotulo: "Registrar entrada", icone: "sobe", onClick: () => abrirForm("estoque", { produtoId: acoes.produto.id, tipo: "entrada" }) },
            { rotulo: "Registrar saída", icone: "desce", onClick: () => abrirForm("estoque", { produtoId: acoes.produto.id, tipo: "saida" }) },
            { rotulo: "Ajustar saldo (inventário)", icone: "editar", onClick: () => abrirForm("estoque", { produtoId: acoes.produto.id, tipo: "ajuste" }) },
            { rotulo: "Editar produto (modo completo)", icone: "desktop", onClick: () => abrirCompleto("cadastro") },
          ] : [
            podeGerenciar && { rotulo: "Cadastrar estoque (modo completo)", icone: "desktop", onClick: () => abrirCompleto("cadastro") },
            !podeGerenciar && { rotulo: "Fechar", icone: "fechar", onClick: () => {} },
          ]} />
      )}
    </div>
  );
}

// Nome curto para o alerta ("Gás R-410A · cilindro 11kg" → "Gás R-410A").
function normalizarNome(nome) {
  const curto = String(nome || "").split(/[·(]/)[0].trim();
  return normalizar(curto) ? curto : nome;
}

