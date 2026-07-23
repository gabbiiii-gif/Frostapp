import { useState, useEffect, useMemo, useCallback } from "react";
import {
  getLembreteConfig, saveLembreteConfig, getLembreteEnviados, sendLembreteResumoDono,
} from "../supabase.js";
import {
  tipoCliente, intervaloEfetivo, ultimaVisitaCliente, proximaManutencao, manutencaoDue,
} from "../lib/lembrete.js";

// Módulo dedicado do Lembrete de manutenção. Recebe o DB (window.storage scoped)
// por prop pra calcular as listas localmente; config/histórico/teste vão ao Supabase.
const DEFAULTS = {
  ativo: false, manutencao_ativa: true, intervalo_pj_dias: 90, intervalo_pf_dias: 180,
  antecedencia_dias: 15, agendados_ativo: true, lookahead_dias: 7, resumo_hora: "07:00",
  canais: ["whatsapp"], para_cliente: true, para_admin: true, para_dono: false,
  dono_telefone: "", template_cliente: "", template_admin: "",
};
const ABAS = [
  ["config", "Configuração"], ["proximas", "Próximas manutenções"],
  ["agendadas", "Visitas agendadas"], ["historico", "Histórico"], ["dono", "Dono"],
];
const fmt = (iso) => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR"); };

export default function LembreteModule({ db, addToast, companyId }) {
  const [aba, setAba] = useState("config");
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [historico, setHistorico] = useState([]);
  const [enviandoDono, setEnviandoDono] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const c = await getLembreteConfig(companyId);
      if (!cancel) setCfg(c || { ...DEFAULTS });
    })();
    return () => { cancel = true; };
  }, [companyId]);

  const upd = (k, v) => setCfg((p) => ({ ...p, [k]: v }));
  const salvar = useCallback(async () => {
    setSaving(true);
    const r = await saveLembreteConfig(companyId, cfg);
    setSaving(false);
    addToast(r.ok ? "Lembrete salvo." : (r.error || "Erro ao salvar."), r.ok ? "success" : "error");
  }, [companyId, cfg, addToast]);

  const clientes = useMemo(() => (db ? db.list("erp:client:") : []), [db, aba]);
  const oss = useMemo(() => (db ? db.list("erp:os:") : []), [db, aba]);

  const proximas = useMemo(() => {
    if (!cfg) return [];
    const hoje = new Date();
    const out = [];
    for (const c of clientes) {
      const ultima = ultimaVisitaCliente(oss, c.id);
      if (!ultima) continue;
      const intervalo = intervaloEfetivo(c, cfg);
      const proxima = proximaManutencao(ultima, intervalo);
      if (!manutencaoDue(proxima, hoje, cfg.antecedencia_dias)) continue;
      const dias = Math.ceil((proxima.getTime() - hoje.getTime()) / 86400000);
      out.push({ nome: c.nome, tipo: tipoCliente(c).toUpperCase(), ultima, proxima: proxima.toISOString(), dias, tel: c.telefone || "—" });
    }
    return out.sort((a, b) => a.dias - b.dias);
  }, [clientes, oss, cfg]);

  const agendadas = useMemo(() => {
    if (!cfg) return [];
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const limite = new Date(hoje); limite.setDate(limite.getDate() + Number(cfg.lookahead_dias));
    return oss.filter((os) => os && !["finalizado", "cancelado"].includes(os.status) && os.dataAgendada)
      .map((os) => ({ ...os, d: new Date(String(os.dataAgendada).slice(0, 10) + "T12:00:00") }))
      .filter((os) => !isNaN(os.d.getTime()) && os.d >= hoje && os.d <= limite)
      .sort((a, b) => a.d - b.d);
  }, [oss, cfg]);

  useEffect(() => {
    if (aba !== "historico") return;
    let cancel = false;
    getLembreteEnviados(companyId).then((h) => { if (!cancel) setHistorico(h); });
    return () => { cancel = true; };
  }, [aba, companyId]);

  const enviarDono = useCallback(async () => {
    setEnviandoDono(true);
    const r = await sendLembreteResumoDono();
    setEnviandoDono(false);
    addToast(r.ok ? `Resumo enviado para ${r.sent_to}.` : (r.error || "Falha ao enviar."), r.ok ? "success" : "error");
  }, [addToast]);

  if (!cfg) return <div className="p-6 text-gray-400">Carregando…</div>;

  const numField = (label, key) => (
    <label className="block"><span className="text-xs text-gray-300">{label}</span>
      <input type="number" min="0" max="3650" value={cfg[key] ?? 0}
        onChange={(e) => upd(key, parseInt(e.target.value, 10) || 0)}
        className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
    </label>
  );

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h2 className="text-xl font-bold text-white">Lembrete de manutenção</h2>
      <div className="flex flex-wrap gap-2 border-b border-gray-700 pb-2">
        {ABAS.map(([id, lbl]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${aba === id ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:text-white"}`}>{lbl}</button>
        ))}
      </div>

      {aba === "config" && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-4">
          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={!!cfg.ativo} onChange={(e) => upd("ativo", e.target.checked)} /> Lembrete ativo
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {numField("Intervalo PJ (dias)", "intervalo_pj_dias")}
            {numField("Intervalo PF (dias)", "intervalo_pf_dias")}
            {numField("Avisar antes (dias)", "antecedencia_dias")}
            {numField("Agendadas: janela (dias)", "lookahead_dias")}
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-200">
            <label className="flex items-center gap-2"><input type="checkbox" checked={(cfg.canais || []).includes("whatsapp")} onChange={() => upd("canais", (cfg.canais || []).includes("whatsapp") ? cfg.canais.filter((c) => c !== "whatsapp") : [...(cfg.canais || []), "whatsapp"])} /> WhatsApp</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.para_cliente} onChange={(e) => upd("para_cliente", e.target.checked)} /> Cliente</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.manutencao_ativa} onChange={(e) => upd("manutencao_ativa", e.target.checked)} /> Manutenção recorrente</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.agendados_ativo} onChange={(e) => upd("agendados_ativo", e.target.checked)} /> Visitas agendadas</label>
          </div>
          <label className="block"><span className="text-xs text-gray-300">Mensagem pro cliente (vars: {"{cliente} {empresa} {ultima_visita} {proxima_visita} {equipamento} {endereco}"})</span>
            <textarea rows={3} value={cfg.template_cliente || ""} onChange={(e) => upd("template_cliente", e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
          </label>
          <div className="flex justify-end"><button onClick={salvar} disabled={saving} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50">{saving ? "Salvando…" : "Salvar"}</button></div>
        </div>
      )}

      {aba === "proximas" && (
        <Tabela vazio="Nenhuma manutenção vencendo na janela." colunas={["Cliente", "Tipo", "Última visita", "Próxima", "Dias", "Telefone"]}
          linhas={proximas.map((p) => [p.nome, p.tipo, fmt(p.ultima), fmt(p.proxima), String(p.dias), p.tel])} />
      )}

      {aba === "agendadas" && (
        <Tabela vazio="Nenhuma visita agendada na janela." colunas={["Cliente", "Data", "Hora", "Equipamento", "Técnico"]}
          linhas={agendadas.map((o) => [o.clienteNome || "—", fmt(o.dataAgendada), o.horaAgendada || "—", o.equipamentoTipo || "—", o.tecnicoNome || "—"])} />
      )}

      {aba === "historico" && (
        <Tabela vazio="Nada enviado ainda." colunas={["Quando", "Tipo", "Cliente", "Destino", "Canal", "Status"]}
          linhas={historico.map((h) => [new Date(h.enviado_em).toLocaleString("pt-BR"), h.tipo, h.cliente_id || "—", h.destinatario, h.canal, h.status])} />
      )}

      {aba === "dono" && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-4">
          <p className="text-sm text-gray-400">Resumo diário escrito pela IA, enviado no WhatsApp do dono.</p>
          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={!!cfg.para_dono} onChange={(e) => upd("para_dono", e.target.checked)} /> Enviar resumo pro dono
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-gray-300">Telefone do dono</span>
              <input type="text" value={cfg.dono_telefone || ""} onChange={(e) => upd("dono_telefone", e.target.value)} placeholder="DDD + número (só dígitos)"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" /></label>
            <label className="block"><span className="text-xs text-gray-300">Hora do resumo</span>
              <input type="time" value={cfg.resumo_hora || "07:00"} onChange={(e) => upd("resumo_hora", e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" /></label>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={salvar} disabled={saving} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm disabled:opacity-50">{saving ? "Salvando…" : "Salvar"}</button>
            <button onClick={enviarDono} disabled={enviandoDono} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold disabled:opacity-50">{enviandoDono ? "Enviando…" : "Enviar resumo agora"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tabela({ colunas, linhas, vazio }) {
  if (!linhas.length) return <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 text-gray-400 text-sm">{vazio}</div>;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-gray-400 border-b border-gray-700">{colunas.map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}</tr></thead>
        <tbody>{linhas.map((l, i) => <tr key={i} className="border-b border-gray-700/50 text-gray-200">{l.map((cel, j) => <td key={j} className="px-3 py-2">{cel}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
