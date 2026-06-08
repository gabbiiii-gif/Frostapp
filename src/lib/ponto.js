// ─── Lib pura: domínio do módulo Ponto Eletrônico ────────────────────────────
// Sem JSX, sem React. Recebe um `db` (interface { get, set, list }) e devolve
// operações de domínio determinísticas (testáveis com Vitest).
//
// Convenções de storage:
//   erp:ponto:<uuid>          → registro individual de batida
//   erp:jornada:<funcId>      → config de jornada por funcionário (singleton)
//   erp:user:<userId>         → user inclui campo `ponto_pin_hash` quando PIN
//                               está definido (mesmo prefixo já existente)
//
// PIN: hash via sha256Hex(salt+pin). Não é PBKDF2 (mais lento e mais seguro)
// porque o PIN é curto e o vetor de ataque local é baixo — o registro inteiro
// já fica em kv_store autenticado.

import { genId, sha256Hex } from "../utils.js";

// Tipos de batida — quatro tipos para suportar intervalo configurável.
export const TIPOS_PONTO = ["entrada", "intervalo_inicio", "intervalo_fim", "saida"];

// Métodos de registro suportados (apenas PIN nesta fase; facial/biometria
// entram em fases seguintes).
export const METODOS = ["pin", "facial", "biometria", "manual"];

// Janela de bloqueio de duplicação (em milissegundos).
export const JANELA_DUP_MS = 5 * 60 * 1000; // 5 minutos

// Device ID persistente — usado para auditoria/fraud (qual aparelho bateu).
// Vive em localStorage com chave própria (NÃO scoped) para sobreviver a
// trocas de empresa no mesmo aparelho.
const DEVICE_ID_KEY = "erp:ponto:deviceId";
export function getOuCriarDeviceId(storage = (typeof window !== "undefined" ? window.storage : null)) {
  if (!storage) return null;
  try {
    let id = storage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = "dev_" + genId();
      storage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

// ─── PIN: hash e verificação ────────────────────────────────────────────────
// Salt é fixo por funcionário (id) para que mesmo PIN de funcionários
// diferentes gere hashes diferentes. Sem necessidade de salt aleatório porque
// não há banco de dump exposto — kv_store é autenticado.
function buildSaltedInput(funcionarioId, pin) {
  return `frosterp-ponto-v1:${funcionarioId}:${pin}`;
}
export async function hashPin(funcionarioId, pin) {
  if (!funcionarioId || !pin) throw new Error("Funcionário e PIN são obrigatórios");
  if (!/^\d{4,8}$/.test(String(pin))) throw new Error("PIN deve ter de 4 a 8 dígitos");
  return await sha256Hex(buildSaltedInput(funcionarioId, pin));
}
export async function verifyPin(funcionarioId, pin, storedHash) {
  if (!storedHash || !pin) return false;
  try {
    const candidate = await sha256Hex(buildSaltedInput(funcionarioId, pin));
    return candidate === storedHash;
  } catch {
    return false;
  }
}

// ─── Geofencing (cerca virtual ao redor da empresa) ─────────────────────────
// A empresa define um ponto central (lat/lng) + raio em metros. Cada batida
// avalia a distância do GPS ao centro e sinaliza quando está FORA da área.
// Não bloqueia — só marca, pra o admin enxergar no painel (trabalho externo
// legítimo continua passando, mas fica rastro).

// Distância em metros entre dois pontos (fórmula de Haversine).
export function distanciaMetros(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => typeof v !== "number" || isNaN(v))) return NaN;
  const R = 6371000; // raio da Terra em metros
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// Avalia uma batida contra a cerca configurada.
//   gps:      { lat, lng, acc } ou null
//   geofence: { ativo, lat, lng, raio_m } ou null/undefined
// Retorna { fora_da_area, distancia_m, geo_motivo }:
//   - geo_motivo "desativado": cerca off (ou sem config) → nunca sinaliza
//   - geo_motivo "sem_gps":    cerca on mas GPS ausente → sinaliza (suspeito)
//   - geo_motivo "fora":       distância além do raio (com tolerância da acurácia)
//   - geo_motivo "ok":         dentro da área
// Tolerância: desconta a acurácia do GPS (gps.acc) da distância antes de comparar
// com o raio — evita falso-positivo quando o sinal está impreciso.
export function avaliarGeofence(gps, geofence) {
  const ativo = !!(geofence && geofence.ativo &&
    typeof geofence.lat === "number" && typeof geofence.lng === "number" &&
    typeof geofence.raio_m === "number" && geofence.raio_m > 0);
  if (!ativo) {
    return { fora_da_area: false, distancia_m: null, geo_motivo: "desativado" };
  }
  if (!gps || typeof gps.lat !== "number" || typeof gps.lng !== "number") {
    return { fora_da_area: true, distancia_m: null, geo_motivo: "sem_gps" };
  }
  const dist = distanciaMetros(gps.lat, gps.lng, geofence.lat, geofence.lng);
  if (isNaN(dist)) {
    return { fora_da_area: true, distancia_m: null, geo_motivo: "sem_gps" };
  }
  // Acurácia (raio de erro do GPS) abate a distância — benefício da dúvida.
  const acc = typeof gps.acc === "number" && gps.acc > 0 ? gps.acc : 0;
  const fora = dist - acc > geofence.raio_m;
  return { fora_da_area: fora, distancia_m: dist, geo_motivo: fora ? "fora" : "ok" };
}

// ─── Registros: criação e queries ──────────────────────────────────────────

// Retorna o ÚLTIMO registro de um funcionário (mais recente).
export function ultimoRegistro(db, funcionarioId) {
  if (!db || !funcionarioId) return null;
  const todos = db.list("erp:ponto:")
    .filter((p) => p && p.funcionario_id === funcionarioId)
    .sort((a, b) => new Date(b.datahora) - new Date(a.datahora));
  return todos[0] || null;
}

// True se a janela de duplicação está aberta (ou seja, NÃO pode registrar).
export function dentroJanelaDuplicacao(ultimoIso, agoraIso = new Date().toISOString()) {
  if (!ultimoIso) return false;
  return (new Date(agoraIso) - new Date(ultimoIso)) < JANELA_DUP_MS;
}

// Infere qual o próximo tipo esperado com base no histórico do dia.
// Lógica simples: 4 estados ciclando — entrada → intervalo_inicio →
// intervalo_fim → saida → (próximo dia entrada). Se a jornada não tem
// intervalo configurado, pula direto entrada → saida.
export function proximaAcao(registrosDia, jornada = null) {
  const temIntervalo = jornada?.intervalo_min && jornada.intervalo_min > 0;
  // Ordem por horário ascendente
  const ordenados = [...(registrosDia || [])].sort(
    (a, b) => new Date(a.datahora) - new Date(b.datahora)
  );
  const tipos = ordenados.map((r) => r.tipo);
  // Estado atual: o último registro indica em qual fase está
  const ultimo = tipos[tipos.length - 1];

  if (!ultimo) return "entrada";
  if (ultimo === "entrada") return temIntervalo ? "intervalo_inicio" : "saida";
  if (ultimo === "intervalo_inicio") return "intervalo_fim";
  if (ultimo === "intervalo_fim") return "saida";
  if (ultimo === "saida") return "entrada"; // próximo dia / extras
  return "entrada";
}

// Cria registro e grava no kv_store. Valida anti-duplicação e tipo válido.
// Retorna o registro criado.
export function registrarPonto(db, dados) {
  const {
    funcionario_id,
    tipo,
    metodo = "pin",
    gps = null,           // { lat, lng, acc } ou null
    ip = null,
    user_agent = null,
    device_id = null,
    foto_path = null,     // para método facial (fase futura)
    manual_motivo = null, // preenchido apenas se metodo='manual'
    manual_por = null,    // admin que registrou
    geofence = null,      // { ativo, lat, lng, raio_m } — cerca da empresa (ou null)
    datahora = new Date().toISOString(),
  } = dados || {};

  if (!funcionario_id) throw new Error("Funcionário é obrigatório");
  if (!TIPOS_PONTO.includes(tipo)) throw new Error("Tipo de ponto inválido");
  if (!METODOS.includes(metodo)) throw new Error("Método inválido");

  // Anti-duplicação: 5 min desde o ÚLTIMO registro do funcionário, exceto
  // se for registro manual feito pelo admin (admin pode corrigir histórico).
  if (metodo !== "manual") {
    const ult = ultimoRegistro(db, funcionario_id);
    if (ult && dentroJanelaDuplicacao(ult.datahora, datahora)) {
      const minRestantes = Math.ceil((JANELA_DUP_MS - (new Date(datahora) - new Date(ult.datahora))) / 60000);
      throw new Error(`Aguarde ${minRestantes} min antes de registrar novamente.`);
    }
  }

  // Registro manual exige motivo (auditoria humana).
  if (metodo === "manual" && !manual_motivo) {
    throw new Error("Registro manual exige motivo.");
  }

  // Avalia a cerca virtual (se configurada). Registros manuais do admin não
  // sinalizam — o admin está corrigindo histórico, não batendo no local.
  const geo = metodo === "manual"
    ? { fora_da_area: false, distancia_m: null, geo_motivo: "manual" }
    : avaliarGeofence(gps, geofence);

  const id = "erp:ponto:" + genId();
  const registro = {
    id,
    funcionario_id,
    tipo,
    metodo,
    datahora,
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    gps_acc: gps?.acc ?? null,
    fora_da_area: geo.fora_da_area,
    distancia_m: geo.distancia_m,
    geo_motivo: geo.geo_motivo,
    ip,
    user_agent,
    device_id,
    foto_path,
    manual_motivo,
    manual_por,
    created_at: new Date().toISOString(),
  };
  db.set(id, registro);
  return registro;
}

// Lista registros de um funcionário em um dia específico (YYYY-MM-DD local).
export function listarRegistrosDia(db, funcionarioId, dataISO) {
  if (!db) return [];
  const dia = String(dataISO).slice(0, 10);
  return db.list("erp:ponto:")
    .filter((p) => p && p.funcionario_id === funcionarioId)
    .filter((p) => String(p.datahora).slice(0, 10) === dia)
    .sort((a, b) => new Date(a.datahora) - new Date(b.datahora));
}

// Lista registros de um funcionário em um intervalo (inclusive).
export function listarRegistrosPeriodo(db, funcionarioId, dataIniISO, dataFimISO) {
  if (!db) return [];
  const ini = String(dataIniISO).slice(0, 10);
  const fim = String(dataFimISO).slice(0, 10);
  return db.list("erp:ponto:")
    .filter((p) => p && p.funcionario_id === funcionarioId)
    .filter((p) => {
      const dia = String(p.datahora).slice(0, 10);
      return dia >= ini && dia <= fim;
    })
    .sort((a, b) => new Date(a.datahora) - new Date(b.datahora));
}

// Lista registros de TODOS funcionários de um dia (uso: painel admin).
export function listarRegistrosDiaTodos(db, dataISO) {
  if (!db) return [];
  const dia = String(dataISO).slice(0, 10);
  return db.list("erp:ponto:")
    .filter((p) => p && String(p.datahora).slice(0, 10) === dia)
    .sort((a, b) => new Date(b.datahora) - new Date(a.datahora));
}

// ─── Cálculo de minutos trabalhados em um dia ────────────────────────────────
// Pares entrada/saida ordenados. Intervalos descontados.
// Retorna minutos como inteiro (>= 0). Não calcula débito vs jornada (essa
// lógica entra em fase seguinte de banco de horas).
export function minutosTrabalhadosDia(registrosDia) {
  const ordenados = [...(registrosDia || [])].sort(
    (a, b) => new Date(a.datahora) - new Date(b.datahora)
  );
  let total = 0;
  let entradaAtual = null;
  for (const r of ordenados) {
    if (r.tipo === "entrada" || r.tipo === "intervalo_fim") {
      entradaAtual = r;
    } else if ((r.tipo === "saida" || r.tipo === "intervalo_inicio") && entradaAtual) {
      total += (new Date(r.datahora) - new Date(entradaAtual.datahora)) / 60000;
      entradaAtual = null;
    }
  }
  return Math.max(0, Math.round(total));
}

// Formata minutos como "HH:MM".
export function formatMinutos(min) {
  if (min == null || isNaN(min)) return "—";
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Label amigável para o tipo de batida.
export function labelTipo(tipo) {
  switch (tipo) {
    case "entrada": return "Entrada";
    case "saida": return "Saída";
    case "intervalo_inicio": return "Início do intervalo";
    case "intervalo_fim": return "Fim do intervalo";
    default: return tipo;
  }
}

// Label amigável para o método.
export function labelMetodo(metodo) {
  switch (metodo) {
    case "pin": return "PIN";
    case "facial": return "Facial";
    case "biometria": return "Biometria";
    case "manual": return "Manual (admin)";
    default: return metodo;
  }
}
