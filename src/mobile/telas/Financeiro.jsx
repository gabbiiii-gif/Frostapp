// ─── Financeiro — celular ────────────────────────────────────────────────────
// Saldo realizado do mês em destaque, depois a receber / a pagar / vencidos e a
// lista agrupada por prioridade. Toque no lançamento → quitar, contato ou modo
// completo. Mesmas regras do FinanceModule (computePaymentState/totaisFinanceiro).

import { useEffect, useState } from "react";
import { useMobile } from "../contexto.js";
import { Acoes, Fab, Icone, Seg, Titulo, Vazio } from "../ui.jsx";
import { resumoFinanceiro, gruposFinanceiro, diasDeAtraso, isoParaBR, rotuloDia, nomeMes } from "../dados.js";
import { formatCurrency, genId, toISODate } from "../../utils.js";

export default function Financeiro() {
  const { dados, db, api, addToast, recarregar, abrirForm, abrirCompleto, podeGerenciar } = useMobile();
  const [filtro, setFiltro] = useState("todos");

  // Ao abrir, faz o mesmo que o FinanceModule do desktop: gera as despesas fixas
  // do mês e garante a receita de toda OS finalizada (as duas são idempotentes).
  useEffect(() => {
    api.prepararFinanceiro();
    recarregar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [acoes, setAcoes] = useState(null);
  const hoje = new Date();
  const hojeIso = toISODate(hoje);

  // "Realizado" do mês corrente (o desktop usa período; aqui o mês é o recorte natural).
  // Sem useMemo manual: o React Compiler memoiza, e as contas são lineares.
  const mes = hojeIso.slice(0, 7);
  const resumoMes = resumoFinanceiro(dados.lancamentos.filter((l) => String(l.data || "").slice(0, 7) === mes), "all", hoje);
  const pipeline = resumoFinanceiro(dados.lancamentos, "all", hoje);
  const grupos = gruposFinanceiro(dados.lancamentos, filtro, hoje);

  // Quitar: mesma regra do markAsPaid do desktop — com parciais, lança o saldo restante.
  const quitar = (l, saldo) => {
    const agora = new Date().toISOString();
    let atualizado;
    if (Array.isArray(l.pagamentos) && l.pagamentos.length > 0 && saldo > 0) {
      const pagamentos = [...l.pagamentos, { id: genId(), valor: saldo, data: agora, forma: l.formaPagamento || "PIX" }];
      atualizado = { ...l, pagamentos, status: "pago", dataPagamento: agora, updatedAt: agora };
    } else {
      atualizado = { ...l, status: "pago", dataPagamento: agora, updatedAt: agora };
    }
    db.set("erp:finance:" + atualizado.id, atualizado);
    addToast(`${l.descricao || "Lançamento"}: marcado como pago.`, "success");
    recarregar();
  };

  const mesNome = nomeMes(hoje.getMonth()).replace(/^./, (c) => c.toUpperCase());
  const nVencidos = pipeline.vencReceber + pipeline.vencPagar;

  return (
    <div className="fm-screen">
      <Titulo titulo="Financeiro" sub={`${mesNome} · realizado + a receber`} />

      <div className="fm-card" style={{ borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--t3)" }}>Saldo em caixa · {mesNome.toLowerCase()}</div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1.1, color: resumoMes.saldo >= 0 ? "var(--ok)" : "var(--bad)" }}>
            {formatCurrency(resumoMes.saldo)}
          </div>
        </div>
        <div className="grid2">
          <div style={{ borderRadius: 10, padding: "10px 12px", background: "var(--okbg)" }}>
            <div style={{ fontSize: 11, color: "var(--t2)" }}>Receita paga</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ok)" }}>{formatCurrency(resumoMes.receitaPaga)}</div>
          </div>
          <div style={{ borderRadius: 10, padding: "10px 12px", background: "var(--badbg)" }}>
            <div style={{ fontSize: 11, color: "var(--t2)" }}>Despesa paga</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--bad)" }}>{formatCurrency(resumoMes.despesaPaga)}</div>
          </div>
        </div>
      </div>

      <div className="grid2">
        <Bloco rotulo="A receber" valor={pipeline.aReceber} qtd={pipeline.qtdReceber} onClick={() => setFiltro("receber")} />
        <Bloco rotulo="A pagar" valor={pipeline.aPagar} qtd={pipeline.qtdPagar} onClick={() => setFiltro("pagar")} />
        {nVencidos > 0 && (
          <button type="button" className="fm-tap" onClick={() => setFiltro("vencidos")}
            style={{ gridColumn: "1 / -1", textAlign: "left", border: "1px solid rgba(239,68,68,.3)", background: "var(--badbg)", borderRadius: 12, padding: 12, color: "var(--t1)", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
            <div>
              <div style={{ fontSize: 11.5, color: "var(--bad)", fontWeight: 700 }}>Vencidos — prioridade</div>
              <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 2 }}>{pipeline.vencReceber} a receber · {pipeline.vencPagar} a pagar</div>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--bad)" }}>{formatCurrency(pipeline.vencidos)}</div>
          </button>
        )}
      </div>

      <Seg valor={filtro} onChange={setFiltro} opcoes={[
        { id: "todos", label: "Todos" }, { id: "receber", label: "Receber" }, { id: "pagar", label: "Pagar" }, { id: "vencidos", label: "Vencidos" },
      ]} />

      {grupos.length === 0 ? (
        <Vazio>{filtro === "vencidos" ? "Nada vencido. 👍" : "Nenhum lançamento por aqui."}</Vazio>
      ) : (
        <div className="fm-list">
          {grupos.map((g) => (
            <div key={g.id}>
              <div className="fm-li-group">{g.titulo}</div>
              {g.itens.slice(0, 40).map((i) => {
                const l = i.lancamento;
                const receita = l.tipo === "receita";
                const pago = i.status === "pago";
                const atraso = i.status === "atrasado" ? diasDeAtraso(l, hojeIso) : 0;
                // Só fala em "vence" quando há vencimento; sem ele, mostra a data do lançamento.
                const quando = !i.dia || pago ? null
                  : atraso ? `venceu ${isoParaBR(i.dia).slice(0, 5)}`
                  : l.vencimento ? `vence ${rotuloDia(i.dia).toLowerCase()}`
                  : isoParaBR(i.dia).slice(0, 5);
                const detalhe = [l.categoria, l.formaPagamento, quando].filter(Boolean).join(" · ");
                return (
                  <button key={l.id} type="button" className="fm-li" onClick={() => setAcoes(i)}>
                    <span className={`fm-ic-box tone-${receita ? "ok" : "bad"}`}><Icone nome={receita ? "sobe" : "desce"} size={18} stroke={2} /></span>
                    <div className="grow">
                      <div className="fm-li-t ell">{l.descricao || l.categoria || l.numero}</div>
                      <div className="fm-li-s ell">{detalhe || l.numero}</div>
                    </div>
                    <div style={{ textAlign: "right", flex: "none" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: pago ? (receita ? "var(--ok)" : "var(--bad)") : "var(--t1)" }}>
                        {pago ? (receita ? "+ " : "− ") : ""}{formatCurrency(pago ? i.total : i.saldo)}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: pago ? "var(--ok)" : atraso ? "var(--bad)" : i.status === "parcial" ? "var(--org)" : "var(--warn)" }}>
                        {pago ? "Pago" : atraso ? `Atrasado ${atraso}d` : i.status === "parcial" ? "Parcial" : "Pendente"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {podeGerenciar && <Fab rotulo="Lançamento" onClick={() => abrirForm("novoLancamento")} />}

      {acoes && (
        <Acoes titulo={acoes.lancamento.descricao || acoes.lancamento.numero}
          sub={`${acoes.lancamento.numero || ""} · ${formatCurrency(acoes.total)}${acoes.valorPago > 0 && acoes.status !== "pago" ? ` · pago ${formatCurrency(acoes.valorPago)}` : ""}`}
          onFechar={() => setAcoes(null)}
          acoes={[
            acoes.status !== "pago" && { rotulo: acoes.lancamento.tipo === "receita" ? `Recebido — quitar ${formatCurrency(acoes.saldo)}` : `Pago — quitar ${formatCurrency(acoes.saldo)}`, icone: "pago", onClick: () => quitar(acoes.lancamento, acoes.saldo) },
            { rotulo: "Pagamento parcial, editar ou excluir (modo completo)", icone: "desktop", onClick: () => abrirCompleto("financeiro") },
          ]} />
      )}
    </div>
  );
}

function Bloco({ rotulo, valor, qtd, onClick }) {
  return (
    <button type="button" className="fm-card fm-tap" onClick={onClick} style={{ textAlign: "left", padding: 12, color: "var(--t1)", borderRadius: 12 }}>
      <div style={{ fontSize: 11.5, color: "var(--t3)" }}>{rotulo}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: valor > 0 ? "var(--warn)" : "var(--t1)" }}>{formatCurrency(valor)}</div>
      <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>{qtd} {qtd === 1 ? "lançamento" : "lançamentos"}</div>
    </button>
  );
}
