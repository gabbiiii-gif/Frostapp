// Gráficos do Dashboard (Recharts), num arquivo à parte para virar chunk
// próprio: o App.jsx carrega estes componentes com React.lazy e o
// src/lib/prefetch.js os baixa em segundo plano durante o login. Assim o
// Recharts (~350 KB com d3/redux/immer) não pesa na abertura da tela de login.
//
// O JSX é o mesmo que ficava inline no Dashboard do App.jsx — visual idêntico.
// Largura/altura vêm do ChartBox (App.jsx), que mede o container antes de
// renderizar; por isso não há ResponsiveContainer aqui.
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { formatCurrency } from "./utils.js";

// Caixa do tooltip igual nos três gráficos (vidro escuro do Dashboard).
const TOOLTIP_STYLE = { backgroundColor: "#0b1220", border: "1px solid #1f2a44", borderRadius: 10, color: "#fff" };

// Receita recebida por semana (sparkline do hero). `data`: [{ name, valor }].
export function ReceitaSemanalChart({ width, height, data }) {
  return (
    <AreaChart width={width} height={height} data={data} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
      <defs>
        <linearGradient id="recArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* Eixo oculto só para nomear o ponto: sem um XAxis com
          dataKey, o Recharts rotula o tooltip com o ÍNDICE do array
          (0..7) — aparecia "6" e "2" sem significado nenhum. */}
      <XAxis dataKey="name" hide />
      <Tooltip
        contentStyle={TOOLTIP_STYLE}
        labelFormatter={(l) => `Receita recebida · ${l}`}
        formatter={(v) => [formatCurrency(v), "Total"]}
      />
      <Area type="monotone" dataKey="valor" stroke="#22d3ee" strokeWidth={2} fill="url(#recArea)" />
    </AreaChart>
  );
}

// Donut de OS por status, tamanho fixo 170x170. `data`: [{ key, label, value, color }].
export function OsPorStatusChart({ data }) {
  return (
    <PieChart width={170} height={170}>
      <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={3} stroke="none">
        {data.map((e) => <Cell key={e.key} fill={e.color} />)}
      </Pie>
      <Tooltip contentStyle={TOOLTIP_STYLE} />
    </PieChart>
  );
}

// OS concluídas por semana (8 blocos). `data`: [{ name, concluidas, periodo }].
export function OsSemanaisChart({ width, height, data }) {
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
      <defs>
        <linearGradient id="barG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,170,0.12)" vertical={false} />
      <XAxis dataKey="name" stroke="rgba(120,140,170,0.6)" fontSize={11} tickLine={false} axisLine={false} />
      <YAxis stroke="rgba(120,140,170,0.6)" fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} width={28} />
      {/* O eixo mostra S1..S8 (cabe na largura); o tooltip abre o
          intervalo de datas real do bloco. */}
      <Tooltip
        cursor={{ fill: "rgba(120,140,170,0.08)" }}
        contentStyle={TOOLTIP_STYLE}
        labelFormatter={(l, p) => p?.[0]?.payload?.periodo || l}
      />
      <Bar dataKey="concluidas" name="Concluídas" fill="url(#barG)" radius={[6, 6, 0, 0]} maxBarSize={26} />
    </BarChart>
  );
}
