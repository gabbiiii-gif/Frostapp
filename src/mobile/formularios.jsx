// ─── Formulários em tela cheia do FrostERP Mobile ────────────────────────────
// Nova OS (3 etapas), Novo lançamento, Novo cliente, Movimentar estoque e
// Agendar. Cada um grava no MESMO formato do módulo do desktop (ver handleSave
// de ProcessModule, FinanceModule, CadastroModule e ScheduleModule no App.jsx),
// pelo DB do App — então auditoria, sync com Supabase, e-mail de OS criada e
// numeração (getNextNumber) continuam iguais.

import { useMemo, useState } from "react";
import { useMobile } from "./contexto.js";
import { Avatar, Folha, Icone, Interruptor, Seg } from "./ui.jsx";
import {
  casaBusca, lerValor, itensAgenda, horariosDoDia, cargaDoTecnico, somarDias, semanaDe, dataLocal, isoParaBR, rotuloDia, primeiroNome,
} from "./dados.js";
import { genId, toISODate, formatCurrency, formatPhone, formatCPF, formatCNPJ, camposTecnicos } from "../utils.js";
import { SERVICE_TYPES_OS, EQUIPMENT_TYPES, PAYMENT_METHODS, CATEGORIES_RECEITA, CATEGORIES_DESPESA } from "../constants.js";

// ─── Peças compartilhadas ────────────────────────────────────────────────────
function Campo({ rotulo, children }) {
  return <label className="fm-field"><span>{rotulo}</span>{children}</label>;
}

function Opcoes({ opcoes, valor, onChange, multi = false }) {
  const ativo = (o) => (multi ? (valor || []).includes(o) : valor === o);
  const tocar = (o) => {
    if (!multi) return onChange(o);
    const lista = valor || [];
    onChange(lista.includes(o) ? lista.filter((x) => x !== o) : [...lista, o]);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {opcoes.map((o) => (
        <button key={o} type="button" className={`fm-chip${ativo(o) ? " on" : ""}`} style={{ height: 36 }} onClick={() => tocar(o)}>{o}</button>
      ))}
    </div>
  );
}

function tecnicosAtivos(funcionarios) {
  return (funcionarios || []).filter((e) => e.tipo === "tecnico" && e.status === "ativo");
}

function enderecoDoCliente(c) {
  const e = c?.endereco;
  if (!e || !e.rua) return "";
  return `${e.rua}${e.numero ? ", " + e.numero : ""}${e.bairro ? " - " + e.bairro : ""}${e.cidade ? " - " + e.cidade : ""}${e.estado ? "/" + e.estado : ""}`;
}

// Lista de clientes com busca. Sem busca: os com OS mais recente primeiro.
function EscolherCliente({ valor, onChange, onNovo }) {
  const { dados } = useMobile();
  const [busca, setBusca] = useState("");
  const recentes = useMemo(() => {
    const ultima = new Map();
    for (const os of dados.os) {
      const ref = os.dataAbertura || os.createdAt || "";
      if (os.clienteId && ref > (ultima.get(os.clienteId) || "")) ultima.set(os.clienteId, ref);
    }
    return [...dados.clientes].filter((c) => c.status !== "inativo")
      .sort((a, b) => String(ultima.get(b.id) || "").localeCompare(String(ultima.get(a.id) || "")));
  }, [dados.os, dados.clientes]);
  const lista = busca ? recentes.filter((c) => casaBusca(busca, c.nome, c.telefone, c.cpf, c.cnpj)) : recentes;
  const escolhido = dados.clientes.find((c) => c.id === valor);
  // O escolhido fica sempre no topo, mesmo fora da busca
  const visiveis = [escolhido, ...lista.filter((c) => c.id !== valor)].filter(Boolean).slice(0, busca ? 20 : 6);

  return (
    <>
      <Campo rotulo="Cliente">
        <input className="fm-input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, telefone ou CNPJ" enterKeyHint="search" />
      </Campo>
      <div className="fm-label">{busca ? "Resultados" : "Recentes"}</div>
      {visiveis.length === 0 ? (
        <div className="fm-card pad" style={{ fontSize: 13.5, color: "var(--t3)" }}>Nenhum cliente encontrado.</div>
      ) : (
        <div className="fm-list">
          {visiveis.map((c) => {
            const sel = c.id === valor;
            return (
              <button key={c.id} type="button" className="fm-li" style={{ background: sel ? "var(--infobg)" : undefined }} onClick={() => onChange(c)}>
                <span className="fm-avatar-sm" style={{ width: 38, height: 38, background: sel ? "var(--brand)" : "var(--infobg)", color: sel ? "#fff" : "var(--tb)" }}>
                  {String(c.nome || "?").trim().split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                </span>
                <div className="grow">
                  <div className="ell" style={{ fontSize: 15, fontWeight: 600 }}>{c.nome}</div>
                  <div className="fm-li-s ell">{[c.telefone, c.endereco?.bairro || c.endereco?.cidade].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                {sel && <Icone nome="check" size={20} stroke={2.2} style={{ color: "var(--tb)" }} />}
              </button>
            );
          })}
        </div>
      )}
      {onNovo && (
        <button type="button" className="fm-btn dashed" onClick={onNovo}><Icone nome="mais1" size={18} stroke={2} />Cadastrar novo cliente</button>
      )}
    </>
  );
}

// ─── Nova OS (3 etapas: cliente → serviço → agenda) ──────────────────────────
export function NovaOS({ params, onFechar }) {
  const { dados, db, api, addToast, recarregar, abrirForm } = useMobile();
  const [etapa, setEtapa] = useState(1);
  const [clienteId, setClienteId] = useState(params?.clienteId || "");
  const [endereco, setEndereco] = useState(() => enderecoDoCliente(dados.clientes.find((c) => c.id === params?.clienteId)));
  const [tipo, setTipo] = useState("Manutenção");
  const [equipTipo, setEquipTipo] = useState("central");
  const [modelo, setModelo] = useState("");
  const [capacidade, setCapacidade] = useState("");
  const [problema, setProblema] = useState("");
  const [valor, setValor] = useState("");
  const [dia, setDia] = useState(toISODate(new Date()));
  const [hora, setHora] = useState("08:00");
  const [equipe, setEquipe] = useState([]); // [{id, nome}]

  const cliente = dados.clientes.find((c) => c.id === clienteId);
  const tecnicos = useMemo(() => tecnicosAtivos(dados.funcionarios), [dados.funcionarios]);
  const itens = useMemo(() => itensAgenda(dados.os, dados.agendamentos), [dados.os, dados.agendamentos]);
  const numeroPrevisto = useMemo(() => api.getNextNumber("OS", dados.os, null), [api, dados.os]);
  const valorNum = lerValor(valor);
  const capCfg = EQUIPMENT_TYPES[equipTipo] || {};

  const escolherCliente = (c) => {
    setClienteId(c.id);
    setEndereco(enderecoDoCliente(c));
  };

  const alternarTecnico = (t) => {
    setEquipe((eq) => (eq.some((x) => x.id === t.id) ? eq.filter((x) => x.id !== t.id) : [...eq, { id: t.id, nome: t.nome }]));
  };

  const continuar = () => {
    if (etapa === 1 && !clienteId) { addToast("Escolha o cliente.", "error"); return; }
    if (etapa === 2 && !tipo) { addToast("Escolha o tipo de serviço.", "error"); return; }
    setEtapa((e) => Math.min(3, e + 1));
  };

  // Mesmo formato do handleSave (OS nova) do ProcessModule: um serviço, sem
  // peças e sem desconto — o resto se ajusta depois no modo completo.
  const criar = () => {
    if (!clienteId) { addToast("Escolha o cliente.", "error"); setEtapa(1); return; }
    const numero = api.getNextNumber("OS", dados.os, "erp:os:");
    const servico = {
      servicoId: "",
      tipo,
      descricao: "",
      valor: valorNum,
      quantidade: 1,
      equipamentoTipo: equipTipo,
      equipamentoModelo: modelo.trim(),
      equipamentoCapacidade: capacidade.trim(),
    };
    const agora = new Date().toISOString();
    const nova = {
      id: genId(),
      numero,
      clienteId,
      clienteNome: cliente?.nome || "—",
      endereco: endereco.trim(),
      servicos: [servico],
      pecas: [],
      tipo,
      descricao: tipo,
      equipamentoTipo: equipTipo,
      equipamentoModelo: servico.equipamentoModelo,
      equipamentoCapacidade: servico.equipamentoCapacidade,
      equipamentoBTUs: equipTipo === "central" ? servico.equipamentoCapacidade : "",
      ...camposTecnicos(equipe),
      status: "aguardando",
      dataAbertura: agora,
      dataAgendada: dia + "T00:00:00.000Z",
      horaAgendada: hora || "",
      dataConclusao: null,
      observacoes: problema.trim(),
      subtotal: valorNum,
      descontoTipo: "valor",
      descontoValor: 0,
      descontoAplicado: 0,
      valor: valorNum,
      itensUtilizados: [],
      createdAt: agora,
    };
    db.set("erp:os:" + nova.id, nova);
    addToast(`Ordem de Serviço ${numero} criada.`, "success");
    recarregar();
    onFechar();
  };

  const cor = (n) => ({
    bg: n < etapa ? "var(--ok)" : n === etapa ? "var(--brand)" : "var(--hover)",
    c: n <= etapa ? "#fff" : "var(--t3)",
    lc: n === etapa ? "var(--t1)" : "var(--t3)",
  });

  const rodape = etapa === 1 ? (
    <button type="button" className="fm-btn primary" style={{ flex: 1 }} onClick={continuar}>Continuar</button>
  ) : (
    <>
      <button type="button" className="fm-btn ghost" style={{ height: 52 }} onClick={() => setEtapa((e) => e - 1)}>Voltar</button>
      {etapa === 2
        ? <button type="button" className="fm-btn primary" style={{ flex: 1 }} onClick={continuar}>Continuar</button>
        : <button type="button" className="fm-btn primary" style={{ flex: 1 }} onClick={criar}>Criar OS</button>}
    </>
  );

  return (
    <Folha titulo="Nova OS" sub={`Etapa ${etapa} de 3`} onFechar={onFechar} rodape={rodape}
      extra={<span style={{ fontSize: 12, fontWeight: 700, color: "var(--t3)" }}>{numeroPrevisto}</span>}>
      <div className="row" style={{ gap: 6, padding: "14px 16px 0", flex: "none" }}>
        {["Cliente", "Serviço", "Agenda"].map((r, i) => {
          const c = cor(i + 1);
          return (
            <div key={r} style={{ display: "contents" }}>
              {i > 0 && <span style={{ flex: 1, height: 2, background: "var(--b2)" }} />}
              <span className="fm-step" style={{ background: c.bg, color: c.c }}>{i + 1 < etapa ? <Icone nome="check" size={13} stroke={3} /> : i + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: c.lc }}>{r}</span>
            </div>
          );
        })}
      </div>
      <div className="fm-sheet-body scroll-y">
        {etapa === 1 && (
          <EscolherCliente valor={clienteId} onChange={escolherCliente}
            onNovo={() => abrirForm("novoCliente", { onCriado: escolherCliente })} />
        )}

        {etapa === 2 && (
          <>
            <Campo rotulo="Tipo de serviço"><Opcoes opcoes={SERVICE_TYPES_OS} valor={tipo} onChange={setTipo} /></Campo>
            <Campo rotulo="Equipamento">
              <select className="fm-input" value={equipTipo} onChange={(e) => setEquipTipo(e.target.value)}>
                {Object.entries(EQUIPMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Campo>
            <div className="grid2">
              <Campo rotulo="Marca / modelo"><input className="fm-input" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Ex.: LG Dual Inverter" /></Campo>
              <Campo rotulo={capCfg.capacityLabel || "Capacidade"}><input className="fm-input" value={capacidade} onChange={(e) => setCapacidade(e.target.value)} placeholder={capCfg.capacityPlaceholder || ""} inputMode="text" /></Campo>
            </div>
            <Campo rotulo="Problema relatado">
              <textarea className="fm-input" rows={3} value={problema} onChange={(e) => setProblema(e.target.value)} placeholder="Descreva o que o cliente relatou" />
            </Campo>
            <Campo rotulo="Valor estimado">
              <input className="fm-input" style={{ fontWeight: 600 }} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$ 0,00" inputMode="decimal" />
            </Campo>
          </>
        )}

        {etapa === 3 && (
          <>
            <div className="grid2">
              <Campo rotulo="Data"><input type="date" className="fm-input" value={dia} onChange={(e) => setDia(e.target.value)} /></Campo>
              <Campo rotulo="Hora"><input type="time" className="fm-input" value={hora} onChange={(e) => setHora(e.target.value)} /></Campo>
            </div>
            <div className="fm-field">
              <span>Técnico {equipe.length > 1 ? "(o primeiro é o responsável)" : ""}</span>
              {tecnicos.length === 0 ? (
                <div className="fm-card pad" style={{ fontSize: 13.5, color: "var(--t3)" }}>Nenhum técnico ativo cadastrado. A OS fica sem técnico.</div>
              ) : (
                <div className="fm-list">
                  {tecnicos.map((t) => {
                    const sel = equipe.some((x) => x.id === t.id);
                    const carga = cargaDoTecnico(itens, dia, t.id);
                    return (
                      <button key={t.id} type="button" className="fm-li" style={{ background: sel ? "var(--infobg)" : undefined }} onClick={() => alternarTecnico(t)}>
                        <Avatar nome={t.nome} tom={sel ? "brand" : "mute"} size={36} style={sel ? { background: "var(--brand)", color: "#fff" } : undefined} />
                        <div className="grow">
                          <div className="fm-li-t ell">{t.nome}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: carga ? "var(--warn)" : "var(--ok)" }}>
                            {carga ? `${carga} ${carga === 1 ? "compromisso" : "compromissos"} neste dia` : "Livre neste dia"}
                          </div>
                        </div>
                        {sel && <Icone nome="check" size={20} stroke={2.2} style={{ color: "var(--tb)" }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <Campo rotulo="Endereço do serviço">
              <input className="fm-input" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número - bairro - cidade" />
            </Campo>
            <div className="fm-summary">
              <b style={{ color: "var(--t1)" }}>Resumo</b><br />
              {cliente?.nome || "—"} · {tipo}{modelo ? ` · ${modelo}` : ""}<br />
              {isoParaBR(dia).slice(0, 5)} às {hora || "—"} · {equipe.length ? equipe.map((t) => primeiroNome(t.nome)).join(", ") : "sem técnico"} · <b style={{ color: "var(--t1)" }}>{formatCurrency(valorNum)}</b>
            </div>
          </>
        )}
      </div>
    </Folha>
  );
}

// ─── Novo lançamento (receita/despesa avulsa) ────────────────────────────────
export function NovoLancamento({ onFechar }) {
  const { dados, db, api, addToast, recarregar } = useMobile();
  const [tipo, setTipo] = useState("receita");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [forma, setForma] = useState("PIX");
  const [data, setData] = useState(toISODate(new Date()));
  const [categoria, setCategoria] = useState(CATEGORIES_RECEITA[0]);
  const [fornecedorId, setFornecedorId] = useState("");
  const [pago, setPago] = useState(false);
  const receita = tipo === "receita";
  const valorNum = lerValor(valor);

  const trocarTipo = (t) => {
    setTipo(t);
    setCategoria(t === "receita" ? CATEGORIES_RECEITA[0] : CATEGORIES_DESPESA[0]);
  };

  // Mesmo formato do lançamento "avulso" do FinanceModule. Parcelada e despesa
  // fixa recorrente ficam no modo completo.
  const salvar = () => {
    if (!descricao.trim()) { addToast("Informe a descrição.", "error"); return; }
    if (!(valorNum > 0)) { addToast("Informe um valor válido.", "error"); return; }
    const fornecedor = !receita ? dados.fornecedores.find((f) => f.id === fornecedorId) : null;
    const numero = api.getNextNumber(receita ? "REC" : "DESP", dados.lancamentos, "erp:finance:");
    const agora = new Date().toISOString();
    const novo = {
      id: genId(),
      numero,
      descricao: descricao.trim(),
      valor: valorNum,
      tipo,
      categoria,
      data: data + "T00:00:00.000Z",
      status: pago ? "pago" : "pendente",
      formaPagamento: forma,
      vencimento: receita && !pago ? data : null,
      observacoes: "",
      fornecedorId: fornecedor?.id || "",
      fornecedorNome: fornecedor?.nome || "",
      osId: null,
      ...(pago ? { dataPagamento: agora } : {}),
      createdAt: agora,
    };
    db.set("erp:finance:" + novo.id, novo);
    addToast(`Lançamento ${numero} registrado.`, "success");
    recarregar();
    onFechar();
  };

  return (
    <Folha titulo="Novo lançamento" sub="Financeiro" onFechar={onFechar}
      rodape={<button type="button" className="fm-btn primary" style={{ flex: 1 }} onClick={salvar}>Salvar lançamento</button>}>
      <div className="fm-sheet-body scroll-y">
        <div className="fm-seg">
          <button type="button" className={receita ? "on" : ""} style={receita ? { background: "var(--okbg)", color: "var(--ok)" } : undefined} onClick={() => trocarTipo("receita")}>
            <Icone nome="sobe" size={16} stroke={2.2} />Receita
          </button>
          <button type="button" className={!receita ? "on" : ""} style={!receita ? { background: "var(--badbg)", color: "var(--bad)" } : undefined} onClick={() => trocarTipo("despesa")}>
            <Icone nome="desce" size={16} stroke={2.2} />Despesa
          </button>
        </div>
        <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
          <div style={{ fontSize: 12.5, color: "var(--t3)" }}>Valor</div>
          <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$ 0,00" inputMode="decimal" aria-label="Valor"
            style={{ width: "100%", border: 0, background: "transparent", textAlign: "center", color: receita ? "var(--ok)" : "var(--bad)", font: "700 40px 'DM Sans', sans-serif", letterSpacing: "-.03em", outline: "none" }} />
          {valorNum > 0 && <div style={{ fontSize: 12.5, color: "var(--t3)" }}>{formatCurrency(valorNum)}</div>}
        </div>
        <Campo rotulo="Descrição">
          <input className="fm-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={receita ? "Ex.: Manutenção · Clínica Bem Estar" : "Ex.: Combustível · Posto"} />
        </Campo>
        <Campo rotulo="Forma de pagamento"><Opcoes opcoes={PAYMENT_METHODS} valor={forma} onChange={setForma} /></Campo>
        <div className="grid2">
          <Campo rotulo={pago ? "Data" : receita ? "Vencimento" : "Data"}>
            <input type="date" className="fm-input" value={data} onChange={(e) => setData(e.target.value)} />
          </Campo>
          <Campo rotulo="Categoria">
            <select className="fm-input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {(receita ? CATEGORIES_RECEITA : CATEGORIES_DESPESA).map((c) => <option key={c}>{c}</option>)}
            </select>
          </Campo>
        </div>
        {!receita && dados.fornecedores.length > 0 && (
          <Campo rotulo="Fornecedor (opcional)">
            <select className="fm-input" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
              <option value="">—</option>
              {dados.fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </Campo>
        )}
        <div className="fm-toggle-row">
          <span className="grow">{receita ? "Já foi recebido" : "Já está pago"}</span>
          <Interruptor ligado={pago} onChange={setPago} rotulo="Já está pago" />
        </div>
      </div>
    </Folha>
  );
}

// ─── Novo cliente ────────────────────────────────────────────────────────────
export function NovoCliente({ params, onFechar, topo }) {
  const { db, addToast, recarregar } = useMobile();
  const [f, setF] = useState({ tipo: "pf", nome: "", telefone: "", doc: "", nascimento: "", email: "", cep: "", rua: "", numero: "", bairro: "", cidade: "", estado: "" });
  const [buscandoCep, setBuscandoCep] = useState(false);
  const pf = f.tipo === "pf";
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  // CEP → endereço pelo ViaCEP (serviço público). Falhou: o usuário digita.
  const buscarCep = async () => {
    const cep = f.cep.replace(/\D/g, "");
    if (cep.length !== 8) { addToast("CEP precisa ter 8 dígitos.", "error"); return; }
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json();
      if (j.erro) throw new Error("não encontrado");
      setF((x) => ({ ...x, rua: j.logradouro || x.rua, bairro: j.bairro || x.bairro, cidade: j.localidade || x.cidade, estado: j.uf || x.estado }));
    } catch {
      addToast("Não achei esse CEP. Preencha o endereço à mão.", "warning");
    } finally {
      setBuscandoCep(false);
    }
  };

  // Mesmo formato do saveClient do CadastroModule.
  const salvar = () => {
    if (!f.nome.trim()) { addToast("Informe o nome do cliente.", "error"); return; }
    if (!f.telefone.replace(/\D/g, "")) { addToast("Informe o telefone do cliente.", "error"); return; }
    const novo = {
      id: genId(),
      nome: f.nome.trim(),
      tipo: f.tipo,
      cpf: pf ? f.doc : "",
      rg: "",
      cnpj: pf ? "" : f.doc,
      telefone: f.telefone,
      email: f.email.trim(),
      endereco: { rua: f.rua.trim(), numero: f.numero.trim(), bairro: f.bairro.trim(), cidade: f.cidade.trim(), estado: f.estado.trim().toUpperCase(), cep: f.cep.trim() },
      observacoes: "",
      status: "ativo",
      ...(pf && f.nascimento ? { data_nascimento: f.nascimento } : {}),
      createdAt: new Date().toISOString(),
    };
    db.set("erp:client:" + novo.id, novo);
    addToast(`Cliente ${novo.nome} cadastrado.`, "success");
    recarregar();
    params?.onCriado?.(novo);
    onFechar();
  };

  return (
    <Folha topo={topo} titulo="Novo cliente" sub="Cadastros" onFechar={onFechar}
      rodape={<button type="button" className="fm-btn primary" style={{ flex: 1 }} onClick={salvar}>Salvar cliente</button>}>
      <div className="fm-sheet-body scroll-y">
        <Seg valor={f.tipo} onChange={(t) => setF((x) => ({ ...x, tipo: t, doc: "" }))} opcoes={[{ id: "pf", label: "Pessoa física" }, { id: "pj", label: "Pessoa jurídica" }]} />
        <Campo rotulo={pf ? "Nome completo" : "Razão social / nome fantasia"}>
          <input className="fm-input" value={f.nome} onChange={set("nome")} placeholder={pf ? "Ex.: Marcos Vinícius Lima" : "Ex.: Restaurante Sabor & Arte"} autoComplete="off" />
        </Campo>
        <Campo rotulo="WhatsApp">
          <input className="fm-input" value={f.telefone} onChange={(e) => setF((x) => ({ ...x, telefone: e.target.value ? formatPhone(e.target.value) : "" }))} placeholder="(11) 9 0000-0000" inputMode="tel" />
        </Campo>
        <div className="grid2">
          <Campo rotulo={pf ? "CPF" : "CNPJ"}>
            <input className="fm-input" value={f.doc} onChange={(e) => setF((x) => ({ ...x, doc: pf ? formatCPF(e.target.value) : formatCNPJ(e.target.value) }))} placeholder={pf ? "000.000.000-00" : "00.000.000/0000-00"} inputMode="numeric" />
          </Campo>
          {pf ? (
            <Campo rotulo="Nascimento"><input type="date" className="fm-input" value={f.nascimento} onChange={set("nascimento")} /></Campo>
          ) : (
            <Campo rotulo="E-mail"><input type="email" className="fm-input" value={f.email} onChange={set("email")} placeholder="contato@empresa.com" inputMode="email" /></Campo>
          )}
        </div>
        {pf && <Campo rotulo="E-mail (opcional)"><input type="email" className="fm-input" value={f.email} onChange={set("email")} inputMode="email" /></Campo>}
        <div className="fm-label" style={{ marginTop: 4 }}>Endereço</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
          <input className="fm-input" value={f.cep} onChange={set("cep")} placeholder="CEP" inputMode="numeric" aria-label="CEP" />
          <button type="button" className="fm-btn" style={{ minHeight: 48, borderRadius: 12, color: "var(--tb)" }} onClick={buscarCep} disabled={buscandoCep}>
            {buscandoCep ? "Buscando…" : "Buscar"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 92px", gap: 8 }}>
          <input className="fm-input" value={f.rua} onChange={set("rua")} placeholder="Rua" aria-label="Rua" />
          <input className="fm-input" value={f.numero} onChange={set("numero")} placeholder="Nº" aria-label="Número" inputMode="numeric" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 64px", gap: 8 }}>
          <input className="fm-input" value={f.bairro} onChange={set("bairro")} placeholder="Bairro" aria-label="Bairro" />
          <input className="fm-input" value={f.cidade} onChange={set("cidade")} placeholder="Cidade" aria-label="Cidade" />
          <input className="fm-input" value={f.estado} onChange={set("estado")} placeholder="UF" aria-label="UF" maxLength={2} style={{ textTransform: "uppercase" }} />
        </div>
        <div className="fm-toggle-row" style={{ color: "var(--t2)" }}>
          <Icone nome="lembrete" size={18} />
          <span className="grow" style={{ lineHeight: 1.3 }}>
            Lembrete de manutenção
            <div style={{ fontSize: 12, color: "var(--t3)" }}>Automático a cada {pf ? "180 dias (PF)" : "90 dias (PJ)"}, contado da última OS finalizada</div>
          </span>
        </div>
      </div>
    </Folha>
  );
}

// ─── Movimentar estoque (entrada / saída / ajuste) ───────────────────────────
const ROTULO_MOV = { entrada: "entrada", saida: "saída", ajuste: "ajuste" };

export function MovimentarEstoque({ params, onFechar }) {
  const { user, dados, db, api, addToast, recarregar } = useMobile();
  const [tipo, setTipo] = useState(params?.tipo || "entrada");
  const [produtoId, setProdutoId] = useState(params?.produtoId || "");
  const [busca, setBusca] = useState("");
  const [qtd, setQtd] = useState("1");
  const [custo, setCusto] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [gerarConta, setGerarConta] = useState(false);

  const comEstoque = useMemo(() => {
    const stk = new Map(dados.estoques.map((s) => [s.produtoId, s]));
    return dados.produtos.filter((p) => stk.has(p.id) && p.status !== "inativo").map((p) => ({ p, s: stk.get(p.id) }))
      .sort((a, b) => String(a.p.nome).localeCompare(String(b.p.nome), "pt-BR"));
  }, [dados.produtos, dados.estoques]);
  const atual = comEstoque.find((x) => x.p.id === produtoId);
  const saldo = Number(atual?.s?.saldo) || 0;
  const minimo = Number(atual?.s?.estoqueMinimo) || 0;
  const quantidade = lerValor(qtd);
  const custoNum = lerValor(custo) || Number(atual?.p?.precoCusto) || 0;
  const unidade = String(atual?.p?.unidade || "un").toLowerCase();
  const fornecedor = dados.fornecedores.find((f) => f.id === fornecedorId);
  const lista = busca ? comEstoque.filter((x) => casaBusca(busca, x.p.nome, x.p.codigo, x.p.codigoBarras)) : comEstoque;

  const passo = (d) => setQtd((q) => String(Math.max(0, (lerValor(q) || 0) + d)));

  // Mesma regra do handleSaveMov do CadastroModule + histórico em erp:stockMov.
  const confirmar = () => {
    if (!atual) { addToast("Escolha o produto.", "error"); return; }
    if (tipo !== "ajuste" && !(quantidade > 0)) { addToast("Quantidade deve ser maior que zero.", "error"); return; }
    if (tipo === "ajuste" && quantidade < 0) { addToast("O saldo não pode ser negativo.", "error"); return; }
    const stk = db.get("erp:stock:" + atual.s.id);
    if (!stk) { addToast("Estoque não encontrado.", "error"); return; }
    const saldoAtual = Number(stk.saldo) || 0;
    if (tipo === "saida" && quantidade > saldoAtual) { addToast("Saldo insuficiente para essa saída.", "error"); return; }
    const novoSaldo = tipo === "entrada" ? saldoAtual + quantidade : tipo === "saida" ? saldoAtual - quantidade : quantidade;

    const agora = new Date().toISOString();
    db.set("erp:stock:" + stk.id, { ...stk, saldo: novoSaldo, ultimaMovimentacao: agora });
    const motivoFinal = [motivo.trim(), tipo === "entrada" && fornecedor ? `Fornecedor: ${fornecedor.nome}` : ""].filter(Boolean).join(" · ");
    const mov = {
      id: genId(),
      produtoId: stk.produtoId,
      stockId: stk.id,
      tipo,
      quantidade,
      saldoAnterior: saldoAtual,
      saldoNovo: novoSaldo,
      motivo: motivoFinal,
      data: toISODate(new Date()),
      usuarioId: user?.id || "",
      usuarioNome: user?.nome || "",
      createdAt: agora,
    };
    db.set("erp:stockMov:" + mov.id, mov);

    // Opcional: a compra vira conta a pagar no Financeiro.
    if (tipo === "entrada" && gerarConta && custoNum > 0) {
      const numero = api.getNextNumber("DESP", dados.lancamentos, "erp:finance:");
      const desp = {
        id: genId(),
        numero,
        descricao: `Compra · ${atual.p.nome} (${quantidade} ${unidade})`,
        valor: Math.round(custoNum * quantidade * 100) / 100,
        tipo: "despesa",
        categoria: "Peça/Material",
        data: toISODate(new Date()) + "T00:00:00.000Z",
        status: "pendente",
        formaPagamento: "Boleto",
        vencimento: null,
        observacoes: motivo.trim(),
        fornecedorId: fornecedor?.id || "",
        fornecedorNome: fornecedor?.nome || "",
        osId: null,
        createdAt: agora,
      };
      db.set("erp:finance:" + desp.id, desp);
    }

    addToast(`${tipo === "entrada" ? "Entrada" : tipo === "saida" ? "Saída" : "Ajuste"} registrada. Saldo: ${novoSaldo}`, "success");
    recarregar();
    onFechar();
  };

  const rotuloBotao = !atual ? "Escolha o produto"
    : tipo === "ajuste" ? `Ajustar saldo para ${quantidade} ${unidade}`
    : `Confirmar ${ROTULO_MOV[tipo]} · ${quantidade} ${unidade}`;

  return (
    <Folha titulo="Movimentar estoque" sub="Produtos & Estoque" onFechar={onFechar}
      rodape={<button type="button" className="fm-btn primary" style={{ flex: 1 }} onClick={confirmar} disabled={!atual}>{rotuloBotao}</button>}>
      <div className="fm-sheet-body scroll-y">
        <Seg valor={tipo} onChange={setTipo} opcoes={[{ id: "entrada", label: "Entrada" }, { id: "saida", label: "Saída" }, { id: "ajuste", label: "Ajuste" }]} />

        <div className="fm-field">
          <span>Produto</span>
          {atual ? (
            <button type="button" onClick={() => setProdutoId("")} className="row"
              style={{ height: 48, padding: "0 14px", borderRadius: 12, border: "1px solid var(--bb)", background: "var(--infobg)", gap: 10, fontSize: 14.5, textAlign: "left", color: "var(--t1)", cursor: "pointer" }}>
              {atual.p.codigo && <span style={{ fontWeight: 700, color: "var(--tb)", flex: "none" }}>{atual.p.codigo}</span>}
              <span className="grow ell">{atual.p.nome}</span>
              <Icone nome="fechar" size={16} stroke={1.8} style={{ color: "var(--t3)" }} />
            </button>
          ) : (
            <>
              <input className="fm-input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou código…" enterKeyHint="search" />
              <div className="fm-list" style={{ maxHeight: 280, overflowY: "auto" }}>
                {lista.length === 0 && <div style={{ padding: 14, fontSize: 13.5, color: "var(--t3)" }}>Nenhum produto com estoque cadastrado. Cadastre o estoque no modo completo.</div>}
                {lista.slice(0, 40).map((x) => (
                  <button key={x.p.id} type="button" className="fm-li" style={{ minHeight: 52 }} onClick={() => { setProdutoId(x.p.id); setBusca(""); }}>
                    <div className="grow"><div className="fm-li-t ell">{x.p.nome}</div><div className="fm-li-s">{x.p.codigo || "—"}</div></div>
                    <b style={{ flex: "none" }}>{Number(x.s.saldo) || 0}</b>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {atual && (
          <>
            <div className="fm-toggle-row" style={{ justifyContent: "space-between", fontSize: 13.5, color: "var(--t2)" }}>
              <span>Em estoque agora</span>
              <span style={{ fontWeight: 700, color: saldo <= minimo ? "var(--bad)" : "var(--t1)", fontSize: 15 }}>{saldo} {unidade}</span>
              <span>mínimo</span>
              <span style={{ fontWeight: 700, color: "var(--t1)", fontSize: 15 }}>{minimo} {unidade}</span>
            </div>

            <div className="fm-field">
              <span>{tipo === "ajuste" ? "Novo saldo (contagem do inventário)" : "Quantidade"}</span>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="fm-btn" style={{ width: 52, height: 52, padding: 0, fontSize: 22 }} onClick={() => passo(-1)} aria-label="Diminuir">−</button>
                <input className="fm-input" value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" aria-label="Quantidade"
                  style={{ flex: 1, height: 52, textAlign: "center", font: "700 24px 'DM Sans', sans-serif" }} />
                <button type="button" className="fm-btn primary" style={{ width: 52, height: 52, padding: 0, fontSize: 22, boxShadow: "none" }} onClick={() => passo(1)} aria-label="Aumentar">+</button>
              </div>
            </div>

            {tipo === "entrada" && (
              <div className="grid2">
                <Campo rotulo="Custo unitário">
                  <input className="fm-input" style={{ fontWeight: 600 }} value={custo} onChange={(e) => setCusto(e.target.value)} inputMode="decimal"
                    placeholder={atual.p.precoCusto ? formatCurrency(atual.p.precoCusto) : "R$ 0,00"} />
                </Campo>
                <Campo rotulo="Fornecedor">
                  <select className="fm-input" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                    <option value="">—</option>
                    {dados.fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                </Campo>
              </div>
            )}

            <Campo rotulo={tipo === "entrada" ? "Nota fiscal / observação" : "Motivo"}>
              <input className="fm-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === "entrada" ? "Nº da NF ou observação" : tipo === "saida" ? "Ex.: uso interno, perda" : "Ex.: inventário do mês"} />
            </Campo>

            {tipo === "entrada" && custoNum > 0 && (
              <div className="fm-toggle-row">
                <span className="grow" style={{ lineHeight: 1.3 }}>
                  Gerar conta a pagar
                  <div style={{ fontSize: 12, color: "var(--t3)" }}>{formatCurrency(custoNum * quantidade)}{fornecedor ? ` · ${fornecedor.nome}` : ""}</div>
                </span>
                <Interruptor ligado={gerarConta} onChange={setGerarConta} rotulo="Gerar conta a pagar" />
              </div>
            )}
          </>
        )}
      </div>
    </Folha>
  );
}

// ─── Agendar (visita / orçamento) ────────────────────────────────────────────
const TIPOS_AGENDA = ["Visita técnica", "Orçamento", "Manutenção", "Instalação"];
const DURACOES = [{ min: 30, r: "30 min" }, { min: 60, r: "1 h" }, { min: 90, r: "1h30" }, { min: 120, r: "2 h" }];

function horaMais(hhmm, minutos) {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10) || 0);
  const t = Math.min(23 * 60 + 59, h * 60 + m + minutos);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function Agendar({ params, onFechar }) {
  const { dados, db, addToast, recarregar, abrirForm } = useMobile();
  const hoje = toISODate(new Date());
  const [tipo, setTipo] = useState("Visita técnica");
  const [clienteId, setClienteId] = useState(params?.clienteId || "");
  const [dia, setDia] = useState(params?.dia || hoje);
  const [hora, setHora] = useState("");
  const [duracao, setDuracao] = useState(60);
  const [equipe, setEquipe] = useState([]);
  const [obs, setObs] = useState("");
  const [mostrarClientes, setMostrarClientes] = useState(!params?.clienteId);

  const cliente = dados.clientes.find((c) => c.id === clienteId);
  const tecnicos = useMemo(() => tecnicosAtivos(dados.funcionarios), [dados.funcionarios]);
  const itens = useMemo(() => itensAgenda(dados.os, dados.agendamentos), [dados.os, dados.agendamentos]);
  const dias = useMemo(() => Array.from({ length: 21 }, (_, i) => somarDias(hoje, i)), [hoje]);

  // Horário ocupado se QUALQUER técnico escolhido já tem algo no intervalo.
  const horarios = useMemo(() => {
    const base = horariosDoDia(itens, dia, null, duracao);
    if (equipe.length === 0) return base;
    return base.map((h) => ({ ...h, ocupado: equipe.some((t) => horariosDoDia(itens, dia, t.id, duracao).find((x) => x.hora === h.hora)?.ocupado) }));
  }, [itens, dia, duracao, equipe]);

  const alternarTecnico = (t) => {
    setEquipe((eq) => (eq.some((x) => x.id === t.id) ? eq.filter((x) => x.id !== t.id) : [...eq, { id: t.id, nome: t.nome }]));
  };

  // Mesmo formato e mesma checagem de conflito do ScheduleModule.
  const salvar = () => {
    if (!clienteId) { addToast("Escolha o cliente.", "error"); return; }
    if (equipe.length === 0) { addToast("Escolha pelo menos um técnico.", "error"); return; }
    if (!hora) { addToast("Escolha o horário.", "error"); return; }
    if (horarios.find((h) => h.hora === hora)?.ocupado) { addToast("Conflito de horário: o técnico já tem compromisso nesse período.", "error"); return; }
    const fim = horaMais(hora, duracao);
    const novo = {
      id: genId(),
      titulo: `${tipo} - ${cliente?.nome || ""}`,
      data: `${dia}T${hora}:00`,
      dataFim: `${dia}T${fim}:00`,
      clienteId,
      clienteNome: cliente?.nome || "—",
      ...camposTecnicos(equipe),
      tipo,
      endereco: cliente?.endereco ? `${cliente.endereco.rua || ""}${cliente.endereco.bairro ? ", " + cliente.endereco.bairro : ""}` : "",
      status: "agendado",
      observacoes: obs.trim(),
      createdAt: new Date().toISOString(),
    };
    db.set("erp:schedule:" + novo.id, novo);
    addToast("Agendamento criado.", "success");
    recarregar();
    onFechar();
  };

  const rotuloDiaSel = rotuloDia(dia, hoje);

  return (
    <Folha titulo="Novo agendamento" sub="Agenda" onFechar={onFechar}
      rodape={<button type="button" className="fm-btn primary" style={{ flex: 1 }} onClick={salvar}>
        {hora ? `Agendar · ${rotuloDiaSel.toLowerCase()}, ${hora}` : "Agendar"}
      </button>}>
      <div className="fm-sheet-body scroll-y">
        <Campo rotulo="Tipo"><Opcoes opcoes={TIPOS_AGENDA} valor={tipo} onChange={setTipo} /></Campo>

        {cliente && !mostrarClientes ? (
          <div className="fm-field">
            <span>Cliente</span>
            <button type="button" className="row" onClick={() => setMostrarClientes(true)}
              style={{ minHeight: 48, padding: "0 14px", borderRadius: 12, border: "1px solid var(--bb)", background: "var(--infobg)", gap: 10, textAlign: "left", color: "var(--t1)", cursor: "pointer", fontSize: 15 }}>
              <span className="grow ell" style={{ fontWeight: 600 }}>{cliente.nome}</span>
              <span style={{ fontSize: 12.5, color: "var(--tb)", fontWeight: 600 }}>trocar</span>
            </button>
          </div>
        ) : (
          <EscolherCliente valor={clienteId} onChange={(c) => { setClienteId(c.id); setMostrarClientes(false); }}
            onNovo={() => abrirForm("novoCliente", { onCriado: (c) => { setClienteId(c.id); setMostrarClientes(false); } })} />
        )}

        <div className="fm-field">
          <span>Data</span>
          <div className="scroll-x">
            {dias.map((iso) => {
              const d = dataLocal(iso);
              const sel = iso === dia;
              const sem = semanaDe(iso).find((x) => x.iso === iso);
              return (
                <button key={iso} type="button" onClick={() => { setDia(iso); setHora(""); }}
                  style={{ flex: "none", width: 56, padding: "8px 0", borderRadius: 12, textAlign: "center", cursor: "pointer",
                    border: sel ? "1px solid var(--brand)" : "1px solid var(--b2)", background: sel ? "var(--brand)" : "transparent",
                    color: sel ? "#fff" : d.getDay() === 0 ? "var(--t3)" : "var(--t2)" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600 }}>{iso === hoje ? "HOJE" : sem?.curto}</div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{d.getDate()}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="fm-field">
          <span>Técnico</span>
          {tecnicos.length === 0 ? (
            <div className="fm-card pad" style={{ fontSize: 13.5, color: "var(--t3)" }}>Nenhum técnico ativo cadastrado.</div>
          ) : (
            <div className="scroll-x">
              {tecnicos.map((t) => {
                const sel = equipe.some((x) => x.id === t.id);
                return (
                  <button key={t.id} type="button" onClick={() => alternarTecnico(t)}
                    style={{ flex: "none", height: 40, padding: "0 12px 0 6px", borderRadius: 999, display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                      border: sel ? "1px solid var(--brand)" : "1px solid var(--b2)", background: sel ? "var(--brand)" : "transparent", color: sel ? "#fff" : "var(--t2)" }}>
                    <span style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700,
                      background: sel ? "rgba(255,255,255,.25)" : "var(--hover)", color: sel ? "#fff" : "var(--t1)" }}>
                      {String(t.nome || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                    </span>
                    {primeiroNome(t.nome)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="fm-field">
          <span>Horário · {rotuloDiaSel.toLowerCase()}{equipe.length ? "" : " (escolha o técnico para ver a disponibilidade)"}</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            {horarios.map((h) => {
              const passou = dia === hoje && h.hora <= `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
              const bloqueado = h.ocupado || passou;
              const sel = h.hora === hora;
              return (
                <button key={h.hora} type="button" disabled={bloqueado} onClick={() => setHora(h.hora)}
                  style={{ height: 40, borderRadius: 10, fontSize: 13.5, fontWeight: sel ? 700 : 600, cursor: bloqueado ? "default" : "pointer",
                    border: sel ? "1px solid var(--brand)" : "1px solid var(--b2)", background: sel ? "var(--brand)" : "transparent",
                    color: sel ? "#fff" : bloqueado ? "var(--t3)" : "var(--t1)", textDecoration: bloqueado ? "line-through" : "none" }}>
                  {h.hora}
                </button>
              );
            })}
          </div>
        </div>

        <Campo rotulo="Duração">
          <div className="fm-seg">
            {DURACOES.map((d) => (
              <button key={d.min} type="button" className={duracao === d.min ? "on" : ""} onClick={() => { setDuracao(d.min); setHora(""); }}>{d.r}</button>
            ))}
          </div>
        </Campo>

        <Campo rotulo="Observação">
          <textarea className="fm-input" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: levar escada, portaria avisada" />
        </Campo>
      </div>
    </Folha>
  );
}
