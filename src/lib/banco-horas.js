// ─── Lib pura: banco de horas ────────────────────────────────────────────────
// Sem JSX, sem React. Calcula saldo (crédito/débito) por dia/período comparando
// minutos trabalhados (vindos de registros de ponto) com a jornada configurada
// e aplicando ocorrências (atestado médico aprovado zera débito do dia).
//
// Convenções:
//   - Saldo em minutos. Positivo = crédito, negativo = débito.
//   - Tolerância (minutos): se ato faltar |X| <= tolerancia, considera 0
//     (não vira crédito nem débito).
//   - Dia útil: definido por jornada.dias_semana (array com 0..6, dom=0).
//   - Em dia NÃO útil, qualquer trabalho vira crédito direto (sem desconto).

import { listarRegistrosDia, listarRegistrosPeriodo, minutosTrabalhadosDia } from "./ponto.js";

// ─── Defaults ──────────────────────────────────────────────────────────────

// Jornada padrão quando funcionário não tem config salva — útil para fallback.
export const JORNADA_DEFAULT = {
  // Carga esperada por dia da semana (0=dom..6=sáb), em horas. 0 = não trabalha.
  horas_por_dia: { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 0 },
  // Janela fixa de almoço (HH:MM). null/"" = sem almoço.
  almoco_inicio: "12:00",
  almoco_fim: "13:00",
  tolerancia_min: 10,
  ativo: true,
  // Campos legados (tolerados na leitura; não escritos pela UI nova):
  horas_dia: 8,
  horas_semana: 44,
  dias_semana: [1, 2, 3, 4, 5],
  intervalo_min: 60,
  hora_entrada: "08:00",
  hora_saida: "17:00",
};

// Converte uma jornada legada (horas_dia + dias_semana + intervalo_min) para o
// formato novo (horas_por_dia + janela de almoço). Jornada já nova passa intacta.
export function migrarJornada(raw) {
  const j = { ...raw };
  if (!j.horas_por_dia || typeof j.horas_por_dia !== "object") {
    const horas = Number(j.horas_dia) || JORNADA_DEFAULT.horas_dia;
    const dias = Array.isArray(j.dias_semana) ? j.dias_semana : JORNADA_DEFAULT.dias_semana;
    const mapa = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    dias.forEach((d) => { if (d >= 0 && d <= 6) mapa[d] = horas; });
    j.horas_por_dia = mapa;
  }
  if (j.almoco_inicio === undefined && j.almoco_fim === undefined) {
    const intv = Number(j.intervalo_min);
    if (intv > 0) {
      j.almoco_inicio = "12:00";
      const fimH = 12 + Math.floor(intv / 60);
      const fimM = intv % 60;
      j.almoco_fim = `${String(fimH).padStart(2, "0")}:${String(fimM).padStart(2, "0")}`;
    } else {
      j.almoco_inicio = null;
      j.almoco_fim = null;
    }
  }
  if (j.tolerancia_min === undefined) j.tolerancia_min = JORNADA_DEFAULT.tolerancia_min;
  if (j.ativo === undefined) j.ativo = true;
  return j;
}

// Lê a jornada de um funcionário (migrando legado), com fallback ao default.
export function getJornada(db, funcionarioId) {
  if (!db || !funcionarioId) return JORNADA_DEFAULT;
  const raw = db.get(`erp:jornada:${funcionarioId}`);
  return raw ? migrarJornada(raw) : JORNADA_DEFAULT;
}

// Grava jornada (admin/gerente — não há checagem aqui, é responsabilidade do
// caller). Retorna o objeto persistido.
export function setJornada(db, funcionarioId, dados) {
  if (!db || !funcionarioId) throw new Error("DB e funcionário obrigatórios");
  const atual = getJornada(db, funcionarioId);
  const atualizado = {
    ...atual,
    ...dados,
    funcionario_id: funcionarioId,
    updated_at: new Date().toISOString(),
  };
  db.set(`erp:jornada:${funcionarioId}`, atualizado);
  return atualizado;
}

// ─── Cálculo de saldo por dia ──────────────────────────────────────────────

// data: string "YYYY-MM-DD"
export function ehDiaUtil(data, jornada = JORNADA_DEFAULT) {
  const dia = String(data).slice(0, 10);
  // Date(YYYY-MM-DD) interpreta como UTC; somar T12:00 garante dia local correto.
  const d = new Date(dia + "T12:00:00");
  if (isNaN(d.getTime())) return false;
  return (jornada.dias_semana || []).includes(d.getDay());
}

// Lista de ocorrências do dia que zeram o débito (atestados aprovados).
function temAtestadoAprovado(ocorrenciasDia) {
  return (ocorrenciasDia || []).some((o) =>
    o.tipo === "atestado_medico" && o.status === "aprovado" && o.zera_debito
  );
}

// Calcula saldo do dia: minutosTrabalhados - jornadaEsperada (com tolerância).
// Retorna objeto detalhado para uso na UI.
//
// registros: registros do dia já filtrados (do funcionário)
// ocorrenciasDia: ocorrências cuja data_ref bate com o dia
// jornada: config do funcionário
export function calcularSaldoDia(data, registros, jornada = JORNADA_DEFAULT, ocorrenciasDia = []) {
  const dia = String(data).slice(0, 10);
  const trabalhados = minutosTrabalhadosDia(registros);
  const ehUtil = ehDiaUtil(dia, jornada);
  const esperado = ehUtil ? Math.round((jornada.horas_dia || 8) * 60) : 0;

  // Atestado aprovado zera débito (não vira crédito também — neutraliza).
  const atestado = temAtestadoAprovado(ocorrenciasDia);

  let saldo;
  if (atestado) {
    // Em dia com atestado, considera como se tivesse cumprido a jornada:
    // saldo do dia = 0 (não débita nem credita o esperado). Horas extras
    // trabalhadas mesmo assim viram crédito.
    saldo = trabalhados > 0 ? trabalhados : 0;
  } else {
    saldo = trabalhados - esperado;
  }

  // Tolerância: para débito ou crédito pequeno, considera zero.
  const tol = jornada.tolerancia_min || 0;
  let saldoEfetivo = saldo;
  if (Math.abs(saldo) <= tol) saldoEfetivo = 0;

  return {
    data: dia,
    eh_dia_util: ehUtil,
    minutos_trabalhados: trabalhados,
    minutos_esperados: esperado,
    saldo_bruto: saldo,
    saldo: saldoEfetivo,
    com_atestado: atestado,
    status: classificarStatus(saldoEfetivo, trabalhados, ehUtil, atestado),
  };
}

// Classifica o dia para UI (badge): "ok", "credito", "debito", "falta",
// "feriado_extra" (trabalhou em dia não-útil), "atestado".
function classificarStatus(saldo, trabalhados, ehUtil, atestado) {
  if (atestado) return "atestado";
  if (!ehUtil) return trabalhados > 0 ? "feriado_extra" : "folga";
  if (trabalhados === 0) return "falta";
  if (saldo > 0) return "credito";
  if (saldo < 0) return "debito";
  return "ok";
}

// Itera dia a dia no período e devolve array de objetos {data, ...saldo}.
// Inclui dias sem registros (importante para detectar faltas).
export function calcularSaldoPeriodo(db, funcionarioId, dataIni, dataFim, jornada, ocorrencias = []) {
  const dias = enumerarDias(dataIni, dataFim);
  const j = jornada || getJornada(db, funcionarioId);

  return dias.map((d) => {
    const regs = listarRegistrosDia(db, funcionarioId, d);
    const ocDia = ocorrencias.filter((o) => o.funcionario_id === funcionarioId && o.data_ref === d);
    return calcularSaldoDia(d, regs, j, ocDia);
  });
}

// Soma saldo do array (em minutos).
export function totalSaldo(saldos) {
  return (saldos || []).reduce((acc, d) => acc + (d.saldo || 0), 0);
}

// Total de minutos trabalhados (sem aplicar tolerância — bruto).
export function totalTrabalhado(saldos) {
  return (saldos || []).reduce((acc, d) => acc + (d.minutos_trabalhados || 0), 0);
}

// Conta dias por status.
export function contarPorStatus(saldos) {
  const out = { ok: 0, credito: 0, debito: 0, falta: 0, folga: 0, feriado_extra: 0, atestado: 0 };
  for (const d of saldos) {
    out[d.status] = (out[d.status] || 0) + 1;
  }
  return out;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Enumera dias inclusive entre ini e fim (YYYY-MM-DD).
export function enumerarDias(ini, fim) {
  const a = String(ini).slice(0, 10);
  const b = String(fim).slice(0, 10);
  const out = [];
  let d = new Date(a + "T12:00:00");
  const last = new Date(b + "T12:00:00");
  if (isNaN(d.getTime()) || isNaN(last.getTime())) return out;
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// Mês YYYY-MM como ini/fim de período.
export function periodoMes(yyyymm) {
  const ini = yyyymm + "-01";
  const [yStr, mStr] = yyyymm.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  // Último dia do mês = dia 0 do mês seguinte.
  const ultimo = new Date(y, m, 0).getDate();
  const fim = `${yyyymm}-${String(ultimo).padStart(2, "0")}`;
  return { ini, fim };
}
