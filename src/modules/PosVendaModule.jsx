// ============================================================
// FrostERP — PosVendaModule.jsx
// Modulo de gerenciamento de pos-venda (config + fila + inbox + historico)
// ============================================================
// Adaptado para a arquitetura kv_store do FrostERP:
//  - pos_venda_mensagens.cliente_id / os_id sao TEXT (ids do kv_store, sem FK)
//  - cliente_nome / os_numero sao snapshots gravados no agendamento client-side
//    (App.jsx scheduleOSPosVenda), entao a UI exibe sem precisar de JOIN.
//  - RLS exige sessao Supabase autenticada (o app loga via signInWithPassword).
//
// Integracao em App.jsx:
//   import PosVendaModule from "./modules/PosVendaModule.jsx";
//   navItems: { id:'pos-venda', label:'Pos-Venda', iconName:'...' }
//   ModuleSwitcher: case 'pos-venda' -> <PosVendaModule supabase={supabase} />
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react';

const TIPO_LABELS = {
  nps: 'NPS',
  lembrete_visita: 'Lembrete',
  reagendamento: 'Reagendamento',
  custom: 'Personalizada',
};

const TIPO_COLORS = {
  nps: 'bg-purple-500',
  lembrete_visita: 'bg-cyan-500',
  reagendamento: 'bg-emerald-500',
  custom: 'bg-gray-500',
};

const STATUS_COLORS = {
  pendente: 'bg-yellow-500',
  aprovada: 'bg-blue-500',
  enviada: 'bg-green-500',
  respondida: 'bg-indigo-500',
  cancelada: 'bg-gray-500',
  erro: 'bg-red-500',
};

const INTENCAO_LABELS = {
  confirma: 'Confirmou',
  reagenda: 'Quer reagendar',
  duvida: 'Duvida (humano)',
  cancela: 'Cancelou',
  parar: 'Pediu opt-out',
  outro: 'Outro',
};

const MODO_DISPARO_LABELS = {
  auto: 'Automatico (sem aprovacao)',
  aprovar: 'Requer aprovacao no app',
  manual: 'Manual (so lista, nao envia)',
};

export default function PosVendaModule({ supabase }) {
  const [tab, setTab] = useState('fila');

  if (!supabase) {
    return (
      <div className="p-6">
        <EmptyState label="Supabase nao configurado — o modulo Pos-Venda exige conexao remota." />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Pos-Venda</h1>
        <p className="text-sm text-gray-400">
          Agente de WhatsApp para NPS, lembretes e reagendamento
        </p>
      </header>

      <nav className="flex gap-1 border-b border-gray-700 mb-6 overflow-x-auto" role="tablist">
        {[
          { id: 'fila', label: 'Fila de Envio' },
          { id: 'inbox', label: 'Inbox' },
          { id: 'historico', label: 'Historico' },
          { id: 'config', label: 'Configuracoes' },
          { id: 'templates', label: 'Templates' },
        ].map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap min-h-[44px] ${
              tab === t.id
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'fila' && <FilaTab supabase={supabase} />}
      {tab === 'inbox' && <InboxTab supabase={supabase} />}
      {tab === 'historico' && <HistoricoTab supabase={supabase} />}
      {tab === 'config' && <ConfigTab supabase={supabase} />}
      {tab === 'templates' && <TemplatesTab supabase={supabase} />}
    </div>
  );
}

// ============================================================
// FILA — pendentes/aprovadas
// ============================================================
function FilaTab({ supabase }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('pos_venda_mensagens')
      .select('id, tipo, status, conteudo, agendada_para, telefone, cliente_id, cliente_nome, os_id, os_numero')
      .in('status', ['pendente', 'aprovada'])
      .order('agendada_para', { ascending: true })
      .limit(100);

    if (!error) setItems(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  const aprovar = async (id) => {
    await supabase.from('pos_venda_mensagens').update({ status: 'aprovada' }).eq('id', id);
    carregar();
  };

  const cancelar = async (id) => {
    if (!confirm('Cancelar esta mensagem?')) return;
    await supabase.from('pos_venda_mensagens').update({ status: 'cancelada' }).eq('id', id);
    carregar();
  };

  if (loading) return <p className="text-gray-400">Carregando…</p>;
  if (items.length === 0) return <EmptyState label="Nenhuma mensagem na fila" />;

  return (
    <ul className="space-y-3">
      {items.map((m) => (
        <li
          key={m.id}
          className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 hover:bg-gray-800/70 transition-colors"
        >
          <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge color={TIPO_COLORS[m.tipo]}>{TIPO_LABELS[m.tipo]}</Badge>
              <Badge color={STATUS_COLORS[m.status]}>{m.status}</Badge>
              <span className="text-xs text-gray-400">
                {new Date(m.agendada_para).toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="flex gap-2 shrink-0">
              {m.status === 'pendente' && (
                <button
                  onClick={() => aprovar(m.id)}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded transition-colors min-h-[44px]"
                >
                  Aprovar
                </button>
              )}
              <button
                onClick={() => cancelar(m.id)}
                className="px-3 py-1 text-xs bg-gray-700 hover:bg-red-600 text-gray-200 rounded transition-colors min-h-[44px]"
              >
                Cancelar
              </button>
            </div>
          </div>
          <div className="text-xs text-gray-400 mb-1">
            {m.cliente_nome || 'Cliente'}{m.os_numero ? ` · OS ${m.os_numero}` : ''}
          </div>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{m.conteudo}</p>
          <p className="text-xs text-gray-500 mt-2">{m.telefone || 'sem telefone'}</p>
        </li>
      ))}
    </ul>
  );
}

// ============================================================
// INBOX — respostas que precisam de humano
// ============================================================
function InboxTab({ supabase }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('pos_venda_mensagens')
      .select('id, tipo, conteudo, resposta_cliente, intencao_detectada, respondida_em, cliente_id, cliente_nome, os_id, os_numero, telefone')
      .eq('precisa_humano', true)
      .is('atendida_em', null)
      .order('respondida_em', { ascending: false });

    if (!error) setItems(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  const marcarAtendida = async (id) => {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from('pos_venda_mensagens')
      .update({
        atendida_em: new Date().toISOString(),
        atendida_por: user?.id ?? null,
        precisa_humano: false,
      })
      .eq('id', id);
    carregar();
  };

  const abrirWhatsApp = (tel) => {
    const num = (tel || '').replace(/\D/g, '');
    if (num) window.open(`https://wa.me/${num}`, '_blank');
  };

  if (loading) return <p className="text-gray-400">Carregando…</p>;
  if (items.length === 0) return <EmptyState label="Nenhuma resposta aguardando voce" />;

  return (
    <ul className="space-y-3">
      {items.map((m) => (
        <li key={m.id} className="rounded-lg border border-red-700/50 bg-red-900/10 p-4">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge color="bg-red-600">Aguardando voce</Badge>
              <span className="text-xs text-gray-400">
                {INTENCAO_LABELS[m.intencao_detectada] || m.intencao_detectada}
              </span>
              <span className="text-xs text-gray-400">
                {m.cliente_nome || 'Cliente'}{m.os_numero ? ` · OS ${m.os_numero}` : ''}
              </span>
            </div>
            <div className="flex gap-2">
              {m.telefone && (
                <button
                  onClick={() => abrirWhatsApp(m.telefone)}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded min-h-[44px]"
                >
                  Abrir WhatsApp
                </button>
              )}
              <button
                onClick={() => marcarAtendida(m.id)}
                className="px-3 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded min-h-[44px]"
              >
                Marcar atendida
              </button>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="text-gray-400">
              <span className="font-semibold">Enviamos:</span> {m.conteudo}
            </div>
            <div className="text-gray-100 bg-gray-800 rounded p-2">
              <span className="font-semibold text-cyan-400">Cliente:</span> {m.resposta_cliente}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ============================================================
// HISTORICO — todas as mensagens + metricas
// ============================================================
function HistoricoTab({ supabase }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState('todos');

  const carregar = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('pos_venda_mensagens')
      .select('id, tipo, status, conteudo, resposta_cliente, intencao_detectada, enviada_em, respondida_em, cliente_nome, os_numero')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filtroTipo !== 'todos') q = q.eq('tipo', filtroTipo);

    const { data } = await q;
    setItems(data || []);
    setLoading(false);
  }, [supabase, filtroTipo]);

  useEffect(() => { carregar(); }, [carregar]);

  const stats = useMemo(() => {
    const total = items.length;
    const respondidas = items.filter((i) => i.status === 'respondida').length;
    const npsScores = items
      .filter((i) => i.tipo === 'nps' && i.resposta_cliente)
      .map((i) => parseInt(i.resposta_cliente.match(/\d+/)?.[0] ?? -1, 10))
      .filter((n) => n >= 0 && n <= 10);
    const npsMedia = npsScores.length
      ? (npsScores.reduce((a, b) => a + b, 0) / npsScores.length).toFixed(1)
      : '—';
    return {
      total,
      respondidas,
      npsMedia,
      taxa: total ? Math.round((respondidas / total) * 100) : 0,
    };
  }, [items]);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Respondidas" value={stats.respondidas} />
        <StatCard label="Taxa de resposta" value={`${stats.taxa}%`} />
        <StatCard label="NPS medio" value={stats.npsMedia} />
      </div>

      <div className="mb-3 flex gap-2 flex-wrap">
        {['todos', 'nps', 'lembrete_visita', 'reagendamento'].map((t) => (
          <button
            key={t}
            onClick={() => setFiltroTipo(t)}
            className={`px-3 py-1 text-xs rounded transition-colors min-h-[44px] ${
              filtroTipo === t ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
          >
            {t === 'todos' ? 'Todos' : TIPO_LABELS[t] || t}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400">Carregando…</p>
      ) : items.length === 0 ? (
        <EmptyState label="Nenhum historico" />
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id} className="rounded border border-gray-700 bg-gray-800/40 p-3 text-sm">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge color={TIPO_COLORS[m.tipo]}>{TIPO_LABELS[m.tipo]}</Badge>
                <Badge color={STATUS_COLORS[m.status]}>{m.status}</Badge>
                {m.cliente_nome && (
                  <span className="text-xs text-gray-400">
                    {m.cliente_nome}{m.os_numero ? ` · OS ${m.os_numero}` : ''}
                  </span>
                )}
                {m.intencao_detectada && (
                  <span className="text-xs text-gray-400">
                    {INTENCAO_LABELS[m.intencao_detectada] || m.intencao_detectada}
                  </span>
                )}
                {m.enviada_em && (
                  <span className="text-xs text-gray-500 ml-auto">
                    {new Date(m.enviada_em).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </div>
              <p className="text-gray-300 text-xs">{m.conteudo}</p>
              {m.resposta_cliente && (
                <p className="text-gray-100 text-xs mt-1 pl-2 border-l-2 border-cyan-500">
                  {m.resposta_cliente}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================
// CONFIG — configuracao global do agente
// ============================================================
function ConfigTab({ supabase }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('pos_venda_config')
      .select('*')
      .is('cliente_id', null)
      .maybeSingle();

    if (!error && data) {
      setConfig(data);
    } else {
      const { data: novo } = await supabase
        .from('pos_venda_config')
        .insert({
          cliente_id: null,
          dias_proxima_visita: 90,
          modo_disparo: 'aprovar',
        })
        .select()
        .single();
      setConfig(novo);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    if (!config) return;
    setSaving(true);
    const { error } = await supabase
      .from('pos_venda_config')
      .update({
        dias_proxima_visita: config.dias_proxima_visita,
        enviar_nps: config.enviar_nps,
        enviar_lembrete: config.enviar_lembrete,
        enviar_reagendamento: config.enviar_reagendamento,
        modo_disparo: config.modo_disparo,
        horario_envio: config.horario_envio,
        ativo: config.ativo,
      })
      .eq('id', config.id);

    setSaving(false);
    if (!error) {
      setSavedAt(new Date());
      setTimeout(() => setSavedAt(null), 3000);
    } else {
      alert('Erro ao salvar: ' + error.message);
    }
  };

  if (loading) return <p className="text-gray-400">Carregando…</p>;
  if (!config) return <p className="text-red-400">Erro ao carregar configuracao.</p>;

  const update = (campo, valor) => setConfig({ ...config, [campo]: valor });

  return (
    <div className="max-w-2xl space-y-6">
      <Card title="Status do agente">
        <Toggle
          checked={config.ativo}
          onChange={(v) => update('ativo', v)}
          label="Agente ativo"
          hint="Quando desligado, nenhuma mensagem e enviada (mas a fila continua sendo gerada)."
        />
      </Card>

      <Card title="Modo de disparo">
        <p className="text-xs text-gray-400 mb-3">
          Define como as mensagens sao enviadas apos serem geradas pelo sistema.
        </p>
        <div className="space-y-2">
          {Object.entries(MODO_DISPARO_LABELS).map(([key, label]) => (
            <label key={key} className="flex items-start gap-3 p-3 rounded border border-gray-700 hover:bg-gray-800/50 cursor-pointer">
              <input
                type="radio"
                name="modo_disparo"
                value={key}
                checked={config.modo_disparo === key}
                onChange={(e) => update('modo_disparo', e.target.value)}
                className="mt-1"
              />
              <div className="text-sm">
                <div className="text-gray-100 font-medium">{label}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {key === 'auto' && 'Mensagens disparam sozinhas no horario agendado.'}
                  {key === 'aprovar' && 'Voce precisa abrir a aba "Fila" e aprovar cada uma.'}
                  {key === 'manual' && 'Sistema gera a lista, voce decide quando e como enviar.'}
                </div>
              </div>
            </label>
          ))}
        </div>
      </Card>

      <Card title="Tipos de mensagem">
        <div className="space-y-3">
          <Toggle
            checked={config.enviar_nps}
            onChange={(v) => update('enviar_nps', v)}
            label="NPS apos finalizacao"
            hint="Envia pesquisa 24h apos a OS ser finalizada."
          />
          <Toggle
            checked={config.enviar_lembrete}
            onChange={(v) => update('enviar_lembrete', v)}
            label="Lembrete de proxima visita"
            hint="Avisa o cliente 3 dias antes da data calculada."
          />
          <Toggle
            checked={config.enviar_reagendamento}
            onChange={(v) => update('enviar_reagendamento', v)}
            label="Proposta de reagendamento"
            hint="Apos resposta positiva ao lembrete, propoe nova data."
          />
        </div>
      </Card>

      <Card title="Parametros">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">
              Dias para proxima visita (padrao)
              <span className="ml-2 text-xs text-gray-500">
                Editavel por OS individualmente
              </span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={365}
                value={config.dias_proxima_visita}
                onChange={(e) => update('dias_proxima_visita', parseInt(e.target.value, 10) || 90)}
                className="w-24 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm min-h-[44px]"
              />
              <span className="text-xs text-gray-400">dias</span>
              <div className="flex gap-1 ml-2">
                {[30, 60, 90, 180].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => update('dias_proxima_visita', n)}
                    className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
                  >
                    {n}d
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">
              Horario de envio
              <span className="ml-2 text-xs text-gray-500">
                Mensagens nao disparam fora desse horario
              </span>
            </label>
            <input
              type="time"
              value={config.horario_envio?.slice(0, 5) || '09:00'}
              onChange={(e) => update('horario_envio', e.target.value + ':00')}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm min-h-[44px]"
            />
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button
          onClick={salvar}
          disabled={saving}
          className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-600 text-white rounded font-medium transition-colors min-h-[44px]"
        >
          {saving ? 'Salvando…' : 'Salvar configuracoes'}
        </button>
        {savedAt && (
          <span className="text-sm text-green-400">
            Salvo em {savedAt.toLocaleTimeString('pt-BR')}
          </span>
        )}
      </div>

      <details className="text-xs text-gray-500 mt-6">
        <summary className="cursor-pointer hover:text-gray-300">
          Sobrescrever configuracao por cliente (avancado)
        </summary>
        <p className="mt-2 pl-4">
          Config por cliente sobrescreve a global (mesma estrutura, com cliente_id
          preenchido). Ainda nao exposto na UI — gerenciavel via banco.
        </p>
      </details>
    </div>
  );
}

// ============================================================
// TEMPLATES — editar conteudo das mensagens
// ============================================================
function TemplatesTab({ supabase }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('pos_venda_templates')
      .select('*')
      .eq('ativo', true)
      .order('tipo');
    setItems(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    if (!editing) return;
    const { error } = await supabase
      .from('pos_venda_templates')
      .update({ conteudo: editing.conteudo, nome: editing.nome })
      .eq('id', editing.id);
    if (!error) {
      setEditing(null);
      carregar();
    } else {
      alert('Erro: ' + error.message);
    }
  };

  if (loading) return <p className="text-gray-400">Carregando…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400 mb-4">
        Variaveis disponiveis: <code className="text-cyan-400">{'{{cliente_nome}}'}</code>,{' '}
        <code className="text-cyan-400">{'{{empresa_nome}}'}</code>,{' '}
        <code className="text-cyan-400">{'{{equipamento}}'}</code>,{' '}
        <code className="text-cyan-400">{'{{data_sugerida}}'}</code>
      </p>

      {items.map((t) => (
        <Card key={t.id} title={`${TIPO_LABELS[t.tipo] || t.tipo} — ${t.nome}`}>
          {editing?.id === t.id ? (
            <div className="space-y-3">
              <input
                type="text"
                value={editing.nome}
                onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                placeholder="Nome do template"
              />
              <textarea
                value={editing.conteudo}
                onChange={(e) => setEditing({ ...editing, conteudo: e.target.value })}
                rows={5}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm font-mono"
              />
              <div className="flex gap-2">
                <button
                  onClick={salvar}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm min-h-[44px]"
                >
                  Salvar
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm min-h-[44px]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-200 whitespace-pre-wrap mb-3">{t.conteudo}</p>
              <button
                onClick={() => setEditing(t)}
                className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded min-h-[44px]"
              >
                Editar
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ============================================================
// COMPONENTES AUXILIARES
// ============================================================

function Badge({ color, children }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium text-white ${color}`}>
      {children}
    </span>
  );
}

function EmptyState({ label }) {
  return (
    <div className="text-center py-12 text-gray-400 border border-dashed border-gray-700 rounded-lg">
      {label}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="rounded-lg border border-gray-700 bg-gray-800/30 p-4">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-cyan-600' : 'bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform mt-0.5 ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div className="flex-1">
        <div className="text-sm text-gray-100">{label}</div>
        {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
      </div>
    </label>
  );
}
