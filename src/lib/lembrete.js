// ─── Lib pura: regras do Lembrete de manutenção/visita ───────────────────────
// Sem JSX, sem rede. Funções determinísticas (testáveis com Vitest). A leitura
// de OS/clientes e o envio ficam na edge function; aqui só a lógica de regra.

// Tipo do cliente: usa o campo `tipo` ('pf'|'pj') quando existe; senão deduz por
// cnpj (→ pj) ou cpf (→ pf); default 'pf'.
export function tipoCliente(client) {
  const t = String(client?.tipo || "").toLowerCase();
  if (t === "pj" || t === "pf") return t;
  if (client?.cnpj && String(client.cnpj).trim()) return "pj";
  if (client?.cpf && String(client.cpf).trim()) return "pf";
  return "pf";
}

// Intervalo (em dias) até a próxima manutenção desse cliente. Override do cliente
// (`intervalo_manutencao_dias`) tem prioridade sobre o padrão por tipo.
export function intervaloEfetivo(client, config) {
  const override = Number(client?.intervalo_manutencao_dias);
  if (override > 0) return override;
  return tipoCliente(client) === "pj"
    ? Number(config?.intervalo_pj_dias) || 90
    : Number(config?.intervalo_pf_dias) || 180;
}

// Maior dataConclusao das OS finalizadas do cliente (ISO) ou null.
export function ultimaVisitaCliente(osList, clienteId) {
  let max = null;
  for (const os of osList || []) {
    if (os?.clienteId !== clienteId) continue;
    if (os?.status !== "finalizado") continue;
    const d = os.dataConclusao || os.updatedAt;
    if (!d) continue;
    if (!max || new Date(d) > new Date(max)) max = d;
  }
  return max;
}

// Próxima manutenção = última visita + intervalo (dias). Retorna Date.
export function proximaManutencao(ultimaVisitaISO, intervaloDias) {
  const base = new Date(ultimaVisitaISO);
  base.setDate(base.getDate() + (Number(intervaloDias) || 0));
  return base;
}

// Due = está dentro da janela de antecedência (0 <= dias_restantes <= antecedência).
export function manutencaoDue(proxima, hoje, antecedenciaDias) {
  const ms = proxima.getTime() - hoje.getTime();
  const dias = Math.ceil(ms / 86400000);
  return dias >= 0 && dias <= (Number(antecedenciaDias) || 0);
}

// Preenche um template trocando {chave} pelos valores de `vars` (ausente = "").
export function preencherTemplate(tpl, vars) {
  return String(tpl || "").replace(/\{(\w+)\}/g, (_, k) =>
    vars && vars[k] != null ? String(vars[k]) : ""
  );
}
