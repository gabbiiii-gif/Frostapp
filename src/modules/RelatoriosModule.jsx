import { useState, useMemo, useCallback } from "react";
import {
  listarDatasets, getDataset, getCampo, registryCompacto, AGREGACOES, OPERADORES,
} from "../lib/relatorios/datasets.js";
import { specVazio, validarSpec, resumoSpec, colunaMetrica } from "../lib/relatorios/spec.js";
import { executarRelatorio } from "../lib/relatorios/engine.js";
import {
  listarSalvos, salvarRelatorio, excluirRelatorio, duplicarRegistro, montarRegistroSalvo,
  PREFIXO_RELATORIO,
} from "../lib/relatorios/salvos.js";
import { genId } from "../utils.js";
import { paraCSV, nomeArquivoCSV, baixarCSV, paraBase64 } from "../lib/relatorios/csv.js";
import { enviarRelatorioWhatsApp, traduzirPerguntaRelatorio } from "../supabase.js";
import { relatorioHTML } from "../lib/relatorios/html.js";
import { openHTMLDoc, gerarPDFDeHTML } from "../lib/doc.js";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ─── Módulo Relatórios — motor genérico de análise ──────────────────────────
// O usuário monta a consulta (ReportSpec) no Builder; os dois caminhos (builder
// e, numa fase seguinte, pergunta em linguagem natural) produzem o MESMO objeto,
// que é validado contra o registry e executado pelo engine puro.
// Este componente é a ÚNICA camada que toca o DB: o engine recebe arrays prontos.

const CORES = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#eab308", "#ec4899"];

// Formatação de célula/KPI conforme o tipo declarado no registry.
export function fmtNum(v, tipo) {
  if (typeof v !== "number" || !isFinite(v)) return v ?? "—";
  if (tipo === "moeda") return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

const inputCls = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none";
const labelCls = "block text-xs font-medium text-gray-400 mb-1";
const cardCls = "bg-gray-800 border border-gray-700 rounded-xl p-4";

export default function RelatoriosModule({ user, db, addToast, companyId, empresa: empresaProp }) {
  // Fontes sensíveis (folha, ponto, vales) só para admin/gerente. Hoje só esses
  // dois papéis entram no módulo — o gate existe para o dia em que o atendente
  // for liberado, para que isso seja mudança de permissão e não vazamento.
  const podeVerSensivel = user?.role === "admin" || user?.role === "gerente";
  const datasets = useMemo(() => listarDatasets({ podeVerSensivel }), [podeVerSensivel]);

  // Dados da empresa para o cabeçalho do documento imprimível. Lidos do
  // `erp:config` (já escopado por empresa pela camada DB); o prop existe só
  // para teste e para quem quiser sobrescrever.
  const empresa = useMemo(() => {
    if (empresaProp) return empresaProp;
    const c = db?.get("erp:config") || {};
    return {
      nome: c.nomeEmpresa || c.razaoSocial || "",
      cnpj: c.cnpj || "",
      telefone: c.telefone || "",
      endereco: c.endereco || "",
      logo: c.logo || "",
    };
  }, [empresaProp, db]);

  const [spec, setSpec] = useState(() => specVazio("os"));
  const [resultado, setResultado] = useState(null);
  const [erros, setErros] = useState([]);
  const [gerando, setGerando] = useState(false);

  // Biblioteca de relatórios salvos da empresa.
  const [aba, setAba] = useState("novo");            // "novo" | "salvos"
  const [salvos, setSalvos] = useState(() => listarSalvos(db));
  const [editandoId, setEditandoId] = useState(null); // id do salvo aberto, se houver
  const [nomeSalvar, setNomeSalvar] = useState("");
  const [dialogoSalvar, setDialogoSalvar] = useState(false);
  const [confirmarExcluir, setConfirmarExcluir] = useState(null);

  // Modo de montagem: builder estruturado ou pergunta em português.
  const [modo, setModo] = useState("builder");       // "builder" | "pergunta"
  const [pergunta, setPergunta] = useState("");
  const [traduzindo, setTraduzindo] = useState(false);

  // Envio por WhatsApp (resumo + CSV anexado).
  const [dialogoWhats, setDialogoWhats] = useState(false);
  const [telefoneWhats, setTelefoneWhats] = useState("");
  const [enviandoWhats, setEnviandoWhats] = useState(false);

  const ds = getDataset(spec.fonte);
  const campos = useMemo(() => ds?.campos || [], [ds]);

  // ─── Mutadores do spec ───
  const trocarFonte = useCallback((fonteId) => {
    // Fonte nova zera filtros/agrupamento/métricas: campos da fonte anterior não
    // existem aqui e virariam erro de validação na cara do usuário.
    setSpec(specVazio(fonteId));
    setResultado(null);
    setErros([]);
  }, []);

  const upd = (patch) => setSpec((s) => ({ ...s, ...patch }));
  const updPeriodo = (patch) => setSpec((s) => ({ ...s, periodo: { ...s.periodo, ...patch } }));

  const addFiltro = () => {
    const campo = campos[0];
    if (!campo) return;
    const op = OPERADORES.find((o) => o.tipos.includes(campo.tipo));
    setSpec((s) => ({ ...s, filtros: [...s.filtros, { campo: campo.id, op: op.id, valor: "" }] }));
  };
  const updFiltro = (i, patch) => setSpec((s) => ({
    ...s, filtros: s.filtros.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
  }));
  const rmFiltro = (i) => setSpec((s) => ({ ...s, filtros: s.filtros.filter((_, idx) => idx !== i) }));

  const toggleAgrupamento = (campoId) => setSpec((s) => {
    const agrupamento = s.agrupamento.includes(campoId)
      ? s.agrupamento.filter((g) => g !== campoId)
      : [...s.agrupamento, campoId];
    // Gráfico depende do agrupamento: se o eixo saiu, o gráfico morre junto
    // (validarSpec descartaria de qualquer forma, mas assim a UI não mente).
    const grafico = s.grafico && agrupamento.includes(s.grafico.eixoX) ? s.grafico : null;
    return { ...s, agrupamento, grafico };
  });

  const addMetrica = () => setSpec((s) => ({ ...s, metricas: [...s.metricas, { agregacao: "contagem" }] }));
  const updMetrica = (i, patch) => setSpec((s) => ({
    ...s, metricas: s.metricas.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
  }));
  const rmMetrica = (i) => setSpec((s) => ({ ...s, metricas: s.metricas.filter((_, idx) => idx !== i) }));

  // ─── Execução ───
  // Carrega a fonte e as fontes referenciadas pelo agrupamento, valida e roda o
  // engine. Nenhum cálculo aqui — este componente só orquestra.
  const gerar = useCallback(() => {
    setGerando(true);
    setErros([]);
    try {
      const v = validarSpec(spec);
      if (!v.ok) {
        setErros(v.erros);
        setResultado(null);
        return;
      }
      const dsAtual = getDataset(v.spec.fonte);
      const dados = db.list(dsAtual.prefixo) || [];

      // Só carrega as fontes de referência realmente usadas no agrupamento.
      const refs = {};
      for (const g of v.spec.agrupamento) {
        const campo = getCampo(dsAtual.id, g);
        if (campo?.tipo === "referencia" && !refs[campo.ref]) {
          const refDs = getDataset(campo.ref);
          if (refDs) refs[campo.ref] = db.list(refDs.prefixo) || [];
        }
      }

      const r = executarRelatorio(v.spec, { dados, refs });
      setSpec(v.spec);
      setResultado({ ...r, spec: v.spec, resumo: resumoSpec(v.spec) });
      if (r.truncado) {
        addToast("Resultado parcial: limite de 50.000 registros atingido. Estreite o período.", "info");
      }
    } catch (e) {
      console.error("[Relatorios] falha ao gerar:", e);
      addToast("Não foi possível gerar o relatório.", "error");
    } finally {
      setGerando(false);
    }
  }, [spec, db, addToast]);

  const podeGerar = Boolean(spec.periodo?.de && spec.periodo?.ate && spec.metricas.length > 0);

  // ─── Modo Pergunta ───
  // A IA só monta a consulta. O spec devolvido é validado contra o registry
  // ANTES de virar cálculo — spec inválido nunca chega ao engine — e aparece
  // preenchido no builder para o usuário conferir antes de gerar.
  const traduzirPergunta = useCallback(async () => {
    if (!pergunta.trim()) return;
    setTraduzindo(true);
    setErros([]);
    try {
      const hoje = new Date();
      const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
      const r = await traduzirPerguntaRelatorio({
        pergunta,
        registry: registryCompacto({ podeVerSensivel }),
        hoje: iso,
      });
      if (!r.ok) {
        addToast(
          r.error === "ia_nao_configurada"
            ? "A tradução por IA não está configurada nesta instalação."
            : `Não consegui interpretar a pergunta (${r.error}).`,
          "error",
        );
        return;
      }
      const v = validarSpec(r.spec);
      if (!v.ok) {
        // Não descarta tudo: leva o usuário ao builder com os erros à vista.
        setErros(["A IA montou uma consulta inválida:", ...v.erros]);
        setModo("builder");
        return;
      }
      setSpec(v.spec);
      setResultado(null);
      setModo("builder");
      addToast("Consulta montada. Confira e clique em Gerar.", "success");
    } finally {
      setTraduzindo(false);
    }
  }, [pergunta, podeVerSensivel, addToast]);

  // ─── Biblioteca de salvos ───
  // Salva a CONFIGURAÇÃO atual. Se veio de um salvo aberto, atualiza no lugar.
  const confirmarSalvar = useCallback(() => {
    const v = validarSpec(spec);
    if (!v.ok) {
      setErros(v.erros);
      setDialogoSalvar(false);
      return;
    }
    const anterior = editandoId ? db.get(PREFIXO_RELATORIO + editandoId) : null;
    const registro = montarRegistroSalvo({
      id: editandoId || genId(),
      nome: nomeSalvar,
      descricao: resumoSpec(v.spec),
      spec: v.spec,
      usuarioNome: user?.nome || user?.email || "",
      agora: new Date().toISOString(),
      criadoEm: anterior?.criadoEm,
    });
    salvarRelatorio(db, registro);
    setSalvos(listarSalvos(db));
    setEditandoId(registro.id);
    setDialogoSalvar(false);
    addToast("Relatório salvo.", "success");
  }, [spec, editandoId, nomeSalvar, db, user, addToast]);

  const abrirSalvo = useCallback((registro) => {
    setSpec(registro.spec);
    setEditandoId(registro.id);
    setNomeSalvar(registro.nome);
    setAba("novo");
    // Volta ao Builder: abrir um salvo no modo Pergunta esconderia a consulta
    // que o usuário acabou de mandar abrir.
    setModo("builder");
    setResultado(null);
    setErros([]);
  }, []);

  const removerSalvo = useCallback((registro) => {
    excluirRelatorio(db, registro.id);
    setSalvos(listarSalvos(db));
    if (editandoId === registro.id) setEditandoId(null);
    setConfirmarExcluir(null);
    addToast("Relatório excluído.", "success");
  }, [db, editandoId, addToast]);

  const duplicarSalvo = useCallback((registro) => {
    salvarRelatorio(db, duplicarRegistro(registro, { novoId: genId(), agora: new Date().toISOString() }));
    setSalvos(listarSalvos(db));
    addToast("Cópia criada.", "success");
  }, [db, addToast]);

  // ─── Exportações ───
  // Nome usado nos arquivos: o do relatório salvo, ou o rótulo da fonte quando
  // a consulta ainda não foi nomeada.
  const nomeExibicao = nomeSalvar?.trim() || `Relatório de ${getDataset(spec.fonte)?.label || "dados"}`;

  const montarHTML = useCallback(() => relatorioHTML({
    nome: nomeSalvar?.trim() || `Relatório de ${getDataset(resultado?.spec?.fonte || spec.fonte)?.label || "dados"}`,
    resumo: resultado?.resumo || resumoSpec(spec),
    colunas: resultado?.colunas || [],
    linhas: resultado?.linhas || [],
    totais: resultado?.totais || {},
    truncado: resultado?.truncado || false,
    empresa,
  }), [resultado, spec, nomeSalvar, empresa]);

  const exportarCSV = useCallback(() => {
    if (!resultado) return;
    baixarCSV(nomeArquivoCSV(nomeExibicao), paraCSV(resultado));
    addToast("CSV baixado.", "success");
  }, [resultado, nomeExibicao, addToast]);

  const abrirDocumento = useCallback(() => {
    if (!resultado) return;
    openHTMLDoc(montarHTML());
  }, [resultado, montarHTML]);

  const baixarPDF = useCallback(async () => {
    if (!resultado) return;
    try {
      addToast("Gerando PDF...", "info");
      await gerarPDFDeHTML(montarHTML(), nomeArquivoCSV(nomeExibicao).replace(/\.csv$/, ""));
    } catch (e) {
      console.error("[Relatorios] PDF:", e);
      addToast("Falha ao gerar o PDF. Use 'Abrir documento' e imprima por lá.", "error");
    }
  }, [resultado, montarHTML, nomeExibicao, addToast]);

  // ─── Envio por WhatsApp ───
  // Resumo em texto + CSV anexado. Limite defensivo: acima de ~5.000 linhas o
  // Evolution costuma recusar o anexo, então cortamos e avisamos na mensagem.
  const MAX_LINHAS_ANEXO = 5000;
  const enviarWhatsApp = useCallback(async () => {
    if (!resultado) return;
    setEnviandoWhats(true);
    try {
      const cortado = resultado.linhas.length > MAX_LINHAS_ANEXO;
      const paraExportar = cortado
        ? { ...resultado, linhas: resultado.linhas.slice(0, MAX_LINHAS_ANEXO) }
        : resultado;
      const csv = paraCSV(paraExportar);
      const resumoMsg = [
        resultado.resumo,
        ...resultado.colunas
          .filter((c) => typeof resultado.totais[c.id] === "number")
          .map((c) => `${c.label}: ${fmtNum(resultado.totais[c.id], c.tipo)}`),
        cortado ? `(anexo limitado às primeiras ${MAX_LINHAS_ANEXO} linhas)` : "",
      ].filter(Boolean).join("\n");

      const r = await enviarRelatorioWhatsApp({
        companyId,
        telefone: telefoneWhats,
        nomeRelatorio: nomeExibicao,
        resumo: resumoMsg,
        arquivoBase64: paraBase64(csv),
        arquivoNome: nomeArquivoCSV(nomeExibicao),
        mimetype: "text/csv",
      });

      if (r.ok) {
        addToast("Relatório enviado no WhatsApp.", "success");
        setDialogoWhats(false);
      } else if (r.error === "evolution_nao_configurada") {
        addToast("WhatsApp não configurado para esta empresa.", "error");
      } else if (r.texto_enviado) {
        addToast("O resumo foi enviado, mas o anexo falhou. Baixe o CSV e envie manualmente.", "error");
      } else {
        addToast(`Falha no envio: ${r.error}`, "error");
      }
    } finally {
      setEnviandoWhats(false);
    }
  }, [resultado, companyId, telefoneWhats, nomeExibicao, addToast]);

  // Relatório novo: limpa o vínculo com o salvo aberto para não sobrescrevê-lo.
  const novoRelatorio = useCallback(() => {
    setSpec(specVazio("os"));
    setEditandoId(null);
    setNomeSalvar("");
    setResultado(null);
    setErros([]);
    setAba("novo");
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Relatórios</h2>
          <p className="text-sm text-gray-400">
            {editandoId
              ? `Editando: ${nomeSalvar}`
              : "Monte a análise que quiser sobre qualquer dado do sistema."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editandoId && (
            <button type="button" onClick={novoRelatorio}
              className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">
              Novo
            </button>
          )}
          <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1">
            {[["novo", "Montar"], ["salvos", `Salvos (${salvos.length})`]].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setAba(id)}
                className={`px-3 py-1.5 text-sm rounded-md transition ${
                  aba === id ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Biblioteca de relatórios salvos ─── */}
      {aba === "salvos" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {salvos.length === 0 && (
            <p className="text-sm text-gray-500 col-span-full">
              Nenhum relatório salvo ainda. Monte um na aba Montar e clique em Salvar.
            </p>
          )}
          {salvos.map((r) => (
            <div key={r.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-col gap-2">
              <div>
                <h3 className="text-white font-semibold text-sm">{r.nome}</h3>
                <p className="text-xs text-gray-500 mt-1">{r.descricao}</p>
              </div>
              <p className="text-[11px] text-gray-600">
                {r.criadoPor ? `por ${r.criadoPor} · ` : ""}
                atualizado em {new Date(r.atualizadoEm).toLocaleDateString("pt-BR")}
              </p>
              <div className="flex flex-wrap gap-2 mt-auto pt-2">
                <button type="button" onClick={() => abrirSalvo(r)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700">Abrir</button>
                <button type="button" onClick={() => duplicarSalvo(r)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">Duplicar</button>
                <button type="button" onClick={() => setConfirmarExcluir(r)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-gray-700 text-red-400 hover:bg-gray-600">Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Alternador Builder | Pergunta ─── */}
      {aba === "novo" && (
        <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1 w-fit">
          {[["builder", "Builder"], ["pergunta", "Pergunta"]].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setModo(id)}
              className={`px-3 py-1.5 text-sm rounded-md transition ${
                modo === id ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Modo Pergunta ─── */}
      {aba === "novo" && modo === "pergunta" && (
        <div className={cardCls}>
          <label className={labelCls} htmlFor="rel-pergunta">Pergunte em português</label>
          <textarea id="rel-pergunta" rows={2} className={inputCls} value={pergunta} maxLength={500}
            onChange={(e) => setPergunta(e.target.value)}
            placeholder="Ex.: faturamento por técnico em março, só OS finalizadas" />
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" onClick={traduzirPergunta} disabled={traduzindo || !pergunta.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
              {traduzindo ? "Interpretando..." : "Montar consulta"}
            </button>
            <span className="text-xs text-gray-500">
              A consulta montada abre no Builder para você conferir antes de gerar.
            </span>
          </div>
        </div>
      )}

      {/* ─── Builder ─── */}
      <div className={cardCls} hidden={aba !== "novo" || modo !== "builder"}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls} htmlFor="rel-fonte">Fonte de dados</label>
            <select id="rel-fonte" className={inputCls} value={spec.fonte} onChange={(e) => trocarFonte(e.target.value)}>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="rel-de">Período — de</label>
            <input id="rel-de" type="date" className={inputCls} value={spec.periodo?.de || ""}
              onChange={(e) => updPeriodo({ de: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="rel-ate">Período — até</label>
            <input id="rel-ate" type="date" className={inputCls} value={spec.periodo?.ate || ""}
              onChange={(e) => updPeriodo({ ate: e.target.value })} />
          </div>
        </div>

        <div className="mt-3">
          <label className={labelCls} htmlFor="rel-campo-data">Campo de data usado no período</label>
          <select id="rel-campo-data" className={inputCls} value={spec.periodo?.campo || ""}
            onChange={(e) => updPeriodo({ campo: e.target.value })}>
            {campos.filter((c) => c.tipo === "data").map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Filtros */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-300">Filtros</span>
            <button type="button" onClick={addFiltro}
              className="text-xs px-2 py-1 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">+ Filtro</button>
          </div>
          {spec.filtros.length === 0 && (
            <p className="text-xs text-gray-500">Nenhum filtro — todos os registros do período entram.</p>
          )}
          <div className="space-y-2">
            {spec.filtros.map((f, i) => {
              const campo = getCampo(spec.fonte, f.campo);
              const ops = OPERADORES.filter((o) => o.tipos.includes(campo?.tipo));
              const precisaValor = f.op !== "vazio" && f.op !== "nao_vazio";
              return (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                  <select className={inputCls} value={f.campo} aria-label="Campo do filtro"
                    onChange={(e) => {
                      // Campo novo pode não aceitar o operador atual — reinicia
                      // com o primeiro operador válido para o tipo.
                      const novo = getCampo(spec.fonte, e.target.value);
                      const opOk = OPERADORES.find((o) => o.tipos.includes(novo.tipo));
                      updFiltro(i, { campo: e.target.value, op: opOk.id, valor: "" });
                    }}>
                    {campos.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <select className={inputCls} value={f.op} aria-label="Operador do filtro"
                    onChange={(e) => updFiltro(i, { op: e.target.value })}>
                    {ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  {precisaValor ? (
                    campo?.opcoes ? (
                      <select className={inputCls} value={f.valor ?? ""} aria-label="Valor do filtro"
                        onChange={(e) => updFiltro(i, { valor: e.target.value })}>
                        <option value="">—</option>
                        {campo.opcoes.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                      </select>
                    ) : (
                      <input className={inputCls} value={f.valor ?? ""} aria-label="Valor do filtro"
                        type={campo?.tipo === "data" ? "date" : (campo?.tipo === "numero" || campo?.tipo === "moeda" ? "number" : "text")}
                        onChange={(e) => updFiltro(i, { valor: e.target.value })} />
                    )
                  ) : <div />}
                  <button type="button" onClick={() => rmFiltro(i)} aria-label="Remover filtro"
                    className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:text-red-400 hover:bg-gray-600 text-sm">✕</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agrupamento */}
        <div className="mt-4">
          <span className="text-sm font-semibold text-gray-300 block mb-2">Agrupar por</span>
          <div className="flex flex-wrap gap-2">
            {campos.filter((c) => c.tipo !== "moeda").map((c) => (
              <button key={c.id} type="button" onClick={() => toggleAgrupamento(c.id)}
                className={`px-2.5 py-1 rounded-full text-xs border transition ${
                  spec.agrupamento.includes(c.id)
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500"}`}>
                {c.label}
              </button>
            ))}
          </div>
          {spec.agrupamento.length === 0 && (
            <p className="text-xs text-gray-500 mt-2">Sem agrupamento o relatório traz uma linha só, com os totais gerais.</p>
          )}
        </div>

        {/* Métricas */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-300">Métricas</span>
            <button type="button" onClick={addMetrica}
              className="text-xs px-2 py-1 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">+ Métrica</button>
          </div>
          <div className="space-y-2">
            {spec.metricas.map((m, i) => {
              const tiposDaAgregacao = AGREGACOES.find((a) => a.id === m.agregacao)?.tipos || [];
              const camposDaAgregacao = campos.filter((c) => tiposDaAgregacao.includes(c.tipo));
              return (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                  <select className={inputCls} value={m.agregacao} aria-label="Agregação"
                    onChange={(e) => {
                      // Trocar a agregação pode invalidar o campo (soma não vale
                      // em texto): reaponta para o primeiro campo compatível.
                      const ag = AGREGACOES.find((a) => a.id === e.target.value);
                      const campoOk = campos.find((c) => ag.tipos.includes(c.tipo));
                      updMetrica(i, { agregacao: ag.id, campo: ag.id === "contagem" ? undefined : campoOk?.id });
                    }}>
                    {AGREGACOES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                  {m.agregacao === "contagem" ? (
                    <div className="text-xs text-gray-500 self-center">conta registros</div>
                  ) : (
                    <select className={inputCls} value={m.campo || ""} aria-label="Campo da métrica"
                      onChange={(e) => updMetrica(i, { campo: e.target.value })}>
                      {camposDaAgregacao.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  )}
                  <button type="button" onClick={() => rmMetrica(i)} aria-label="Remover métrica"
                    className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:text-red-400 hover:bg-gray-600 text-sm">✕</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Gráfico — só faz sentido com agrupamento */}
        {spec.agrupamento.length > 0 && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls} htmlFor="rel-graf-tipo">Gráfico</label>
              <select id="rel-graf-tipo" className={inputCls} value={spec.grafico?.tipo || ""}
                onChange={(e) => upd({
                  grafico: e.target.value
                    ? { tipo: e.target.value, eixoX: spec.agrupamento[0], series: [colunaMetrica(spec.metricas[0])] }
                    : null,
                })}>
                <option value="">Sem gráfico</option>
                <option value="barra">Barras</option>
                <option value="linha">Linha</option>
                <option value="area">Área</option>
                <option value="pizza">Pizza</option>
              </select>
            </div>
            {spec.grafico && (
              <>
                <div>
                  <label className={labelCls} htmlFor="rel-graf-eixo">Eixo</label>
                  <select id="rel-graf-eixo" className={inputCls} value={spec.grafico.eixoX}
                    onChange={(e) => upd({ grafico: { ...spec.grafico, eixoX: e.target.value } })}>
                    {spec.agrupamento.map((g) => (
                      <option key={g} value={g}>{getCampo(spec.fonte, g)?.label || g}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="rel-graf-serie">Série</label>
                  <select id="rel-graf-serie" className={inputCls} value={spec.grafico.series[0] || ""}
                    onChange={(e) => upd({ grafico: { ...spec.grafico, series: [e.target.value] } })}>
                    {spec.metricas.map((m, i) => {
                      const id = colunaMetrica(m);
                      return <option key={`${id}-${i}`} value={id}>{id}</option>;
                    })}
                  </select>
                </div>
              </>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={gerar} disabled={gerando || !podeGerar}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {gerando ? "Gerando..." : "Gerar relatório"}
          </button>
          <button type="button" onClick={() => setDialogoSalvar(true)} disabled={!podeGerar}
            className="px-4 py-2 rounded-lg bg-gray-700 text-gray-200 text-sm hover:bg-gray-600 disabled:opacity-50">
            {editandoId ? "Salvar alterações" : "Salvar relatório"}
          </button>
          <span className="text-xs text-gray-500">{resumoSpec(spec)}</span>
        </div>

        {erros.length > 0 && (
          <ul className="mt-3 text-xs text-red-400 list-disc list-inside space-y-1">
            {erros.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
      </div>

      {/* ─── Resultado ─── */}
      {aba === "novo" && resultado && (
        <ResultadoRelatorio
          resultado={resultado}
          acoes={{
            exportarCSV,
            abrirDocumento,
            baixarPDF,
            abrirWhats: () => {
              // Telefone default: o da empresa, que costuma ser o do dono.
              if (!telefoneWhats) setTelefoneWhats(empresa.telefone || "");
              setDialogoWhats(true);
            },
          }}
        />
      )}

      {/* ─── Diálogo: salvar relatório ─── */}
      {dialogoSalvar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-sm">
            <h3 className="text-white font-semibold mb-3">
              {editandoId ? "Salvar alterações" : "Salvar relatório"}
            </h3>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="rel-nome">Nome</label>
            <input id="rel-nome" className={inputCls} value={nomeSalvar} autoFocus
              onChange={(e) => setNomeSalvar(e.target.value)} placeholder="Ex.: Faturamento por técnico" />
            <p className="text-xs text-gray-500 mt-2">{resumoSpec(spec)}</p>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setDialogoSalvar(false)}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600">Cancelar</button>
              <button type="button" onClick={confirmarSalvar} disabled={!nomeSalvar.trim()}
                className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Diálogo: enviar no WhatsApp ─── */}
      {dialogoWhats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-sm">
            <h3 className="text-white font-semibold mb-1">Enviar no WhatsApp</h3>
            <p className="text-xs text-gray-500 mb-3">
              O destinatário recebe o resumo com os totais em texto e o CSV como anexo.
            </p>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="rel-tel">Telefone</label>
            <input id="rel-tel" className={inputCls} value={telefoneWhats} autoFocus
              onChange={(e) => setTelefoneWhats(e.target.value)} placeholder="(11) 99999-9999" />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setDialogoWhats(false)}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600">Cancelar</button>
              <button type="button" onClick={enviarWhatsApp} disabled={enviandoWhats || !telefoneWhats.trim()}
                className="px-3 py-1.5 text-sm rounded-lg bg-green-700 text-white hover:bg-green-600 disabled:opacity-50">
                {enviandoWhats ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Diálogo: confirmar exclusão ─── */}
      {confirmarExcluir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-sm">
            <h3 className="text-white font-semibold mb-2">Excluir relatório</h3>
            <p className="text-sm text-gray-400">
              Excluir <strong className="text-gray-200">{confirmarExcluir.nome}</strong>? A configuração é apagada;
              os dados do sistema não são afetados.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setConfirmarExcluir(null)}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600">Cancelar</button>
              <button type="button" onClick={() => removerSalvo(confirmarExcluir)}
                className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tabela + KPIs + gráfico do resultado. Tabela própria (e não o DataTable do
// App.jsx) porque aquele componente não é exportado e importá-lo daqui criaria
// import circular — mesmo motivo pelo qual Ponto e Lembrete têm as suas.
function ResultadoRelatorio({ resultado, acoes }) {
  const { colunas, linhas, totais, truncado, spec, resumo } = resultado;
  const agrupamento = spec.agrupamento || [];
  const colunasMetrica = colunas.filter((c) => !agrupamento.includes(c.id));
  const alinhaDireita = (tipo) => (tipo === "moeda" || tipo === "numero");

  if (linhas.length === 0) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-10 text-center">
        <div className="text-4xl mb-3 opacity-50">📊</div>
        <h3 className="text-gray-300 font-semibold mb-1">Nenhum registro encontrado</h3>
        <p className="text-sm text-gray-500">{resumo}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Ações só aparecem quando há resultado — não há o que exportar sem linhas */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={acoes.exportarCSV}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">Baixar CSV</button>
        <button type="button" onClick={acoes.abrirDocumento}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">Abrir documento</button>
        <button type="button" onClick={acoes.baixarPDF}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">Baixar PDF</button>
        <button type="button" onClick={acoes.abrirWhats}
          className="px-3 py-1.5 text-sm rounded-lg bg-green-700 text-white hover:bg-green-600">Enviar no WhatsApp</button>
      </div>

      {truncado && (
        <div className="bg-amber-500/10 border border-amber-500/40 text-amber-300 text-sm rounded-lg px-4 py-3">
          Resultado parcial: o limite de 50.000 registros foi atingido. Estreite o período para obter um número exato.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {colunasMetrica.map((c) => (
          <div key={c.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">{c.label}</p>
            <p className="text-xl font-bold text-white">{fmtNum(totais[c.id], c.tipo)}</p>
          </div>
        ))}
      </div>

      {spec.grafico && <GraficoRelatorio spec={spec} linhas={linhas} />}

      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60">
              <tr>
                {colunas.map((c) => (
                  <th key={c.id} className={`px-4 py-3 text-xs font-semibold text-gray-400 ${alinhaDireita(c.tipo) ? "text-right" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-t border-gray-700/60 hover:bg-gray-700/20">
                  {colunas.map((c) => (
                    <td key={c.id} className={`px-4 py-2.5 text-gray-200 ${alinhaDireita(c.tipo) ? "text-right tabular-nums" : "text-left"}`}>
                      {fmtNum(l[c.id], c.tipo)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-blue-500/50 bg-gray-900/40">
                {colunas.map((c, i) => (
                  <td key={c.id} className={`px-4 py-2.5 font-bold text-white ${alinhaDireita(c.tipo) ? "text-right tabular-nums" : "text-left"}`}>
                    {i === 0 ? "TOTAL" : fmtNum(totais[c.id], c.tipo)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-700/60">
          {linhas.length} linha{linhas.length === 1 ? "" : "s"} · {resumo}
        </p>
      </div>
    </div>
  );
}

// Recharts em cima do resultado já agregado. Corta em 30 fatias: um gráfico com
// 500 categorias é ilegível e trava o render no celular.
function GraficoRelatorio({ spec, linhas }) {
  const { tipo, eixoX, series } = spec.grafico;
  const serie = series[0];
  const dados = linhas.slice(0, 30);
  const cortado = linhas.length > dados.length;

  return (
    <div className={cardCls}>
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          {tipo === "pizza" ? (
            <PieChart>
              <Pie data={dados} dataKey={serie} nameKey={eixoX} outerRadius={100} label>
                {dados.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          ) : tipo === "linha" ? (
            <LineChart data={dados}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey={eixoX} stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={11} />
              <Tooltip />
              <Line type="monotone" dataKey={serie} stroke={CORES[0]} strokeWidth={2} />
            </LineChart>
          ) : tipo === "area" ? (
            <AreaChart data={dados}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey={eixoX} stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={11} />
              <Tooltip />
              <Area type="monotone" dataKey={serie} stroke={CORES[0]} fill={CORES[0]} fillOpacity={0.3} />
            </AreaChart>
          ) : (
            <BarChart data={dados}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey={eixoX} stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={11} />
              <Tooltip />
              <Bar dataKey={serie} fill={CORES[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {cortado && (
        <p className="text-[11px] text-gray-500 mt-2">
          Gráfico mostrando as 30 primeiras categorias — a tabela abaixo traz todas.
        </p>
      )}
    </div>
  );
}
