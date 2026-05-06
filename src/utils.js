// ─── Utilidades puras compartilhadas pelo app ───────────────────────────────
// Funções extraídas de App.jsx para permitir testes unitários isolados
// (Vitest) sem precisar montar a árvore React. Todo o conteúdo deste módulo
// é determinístico (com excecão de genId/genSecureToken/sha256Hex que
// dependem de Date.now/crypto, ambos disponíveis em happy-dom).

// ID curto baseado em timestamp + random — usado para chaves do storage local
export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Token criptograficamente seguro (32 bytes em hex) — usado para sessão.
// Cai num fallback inseguro só se não houver WebCrypto (ambientes sem HTTPS).
export function genSecureToken() {
  if (typeof crypto !== "undefined" && crypto?.getRandomValues) {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return genId() + genId();
}

// SHA-256 em hex — usado para validar token de sessão sem armazená-lo em claro
export async function sha256Hex(str) {
  if (typeof crypto === "undefined" || !crypto?.subtle) return str;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Formatação BRL — sempre devolve "R$ X,YZ"
export function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

// Converte YYYY-MM-DD ou ISO para DD/MM/YYYY sem deslocar fuso horário
export function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const datePart = String(dateStr).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      const [y, m, d] = datePart.split("-");
      return `${d}/${m}/${y}`;
    }
    return new Date(dateStr).toLocaleDateString("pt-BR");
  } catch {
    return dateStr;
  }
}

// DD/MM/YYYY HH:MM
export function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr;
  }
}

// 000.000.000-00 — formatação progressiva conforme o usuário digita
export function formatCPF(v) {
  const d = (v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + "." + d.slice(3);
  if (d.length <= 9) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6);
  return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
}

// 00.000.000/0000-00 — formatação progressiva conforme o usuário digita
export function formatCNPJ(v) {
  const d = (v || "").replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return d.slice(0, 2) + "." + d.slice(2);
  if (d.length <= 8) return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5);
  if (d.length <= 12) return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8);
  return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12);
}

// (DD) XXXXX-XXXX (celular) ou (DD) XXXX-XXXX (fixo) — formatação progressiva
export function formatPhone(v) {
  const d = (v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return "(" + d;
  if (d.length <= 7) return "(" + d.slice(0, 2) + ") " + d.slice(2);
  if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
  return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
}

// Filtra uma lista de objetos por um campo de data, respeitando o período do filtro
export function filterByDate(items, dateField, dateFilter) {
  if (!dateFilter || dateFilter.period === "all") return items;
  const now = new Date();
  let start, end;

  if (dateFilter.period === "custom" && dateFilter.startDate && dateFilter.endDate) {
    start = new Date(dateFilter.startDate + "T00:00:00");
    end = new Date(dateFilter.endDate + "T23:59:59");
  } else {
    end = new Date(now);
    end.setHours(23, 59, 59, 999);
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const days = { hoje: 0, "7dias": 7, "30dias": 30, "90dias": 90 };
    const d = days[dateFilter.period] || 0;
    start.setDate(start.getDate() - d);
  }

  return items.filter((item) => {
    // Strings "YYYY-MM-DD" sem hora seriam parseadas como UTC, deslocando 3h
    // em PT-BR e excluindo registros do início do range. Forçamos T00:00:00
    // local antes do parse para alinhar com os bounds (que ja são locais).
    const raw = item[dateField];
    const rawStr = raw == null ? '' : String(raw);
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawStr);
    const itemDate = isDateOnly ? new Date(rawStr + 'T00:00:00') : new Date(raw);
    return itemDate >= start && itemDate <= end;
  });
}

// Date → "YYYY-MM-DD"
export function toISODate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().split("T")[0];
}

// Daqui +N dias em "YYYY-MM-DD"
export function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

// Há N meses atrás em "YYYY-MM-DD"
export function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return toISODate(d);
}
