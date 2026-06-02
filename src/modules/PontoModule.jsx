// ─── Módulo Ponto Eletrônico — Fase A ────────────────────────────────────────
// Funcionalidades nesta fase:
//   1. Setup do PIN no primeiro acesso (auto-cadastro).
//   2. Bater ponto via PIN (anti-duplicação 5 min, GPS opcional).
//   3. Histórico do dia + minutos trabalhados acumulados.
//   4. Painel admin/gerente: tabela de batidas do dia da equipe inteira,
//      filtros (funcionário, dia), inclusão manual com motivo obrigatório.
//
// Próximas fases (não implementadas aqui):
//   - Reconhecimento facial (face-api.js)
//   - Biometria nativa (Capacitor)
//   - Banco de horas (cálculo + gráfico + exportação)
//   - Ocorrências/justificativas (atestados etc.)
//
// PIN: hash sha256 (salt = id do funcionário) gravado em erp:user:<id>.user
// .ponto_pin_hash. Cada user gerencia o próprio PIN. Admin pode resetar
// editando user em UserManagement (fora deste módulo nesta fase).

import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from "react";
import {
  registrarPonto,
  hashPin,
  verifyPin,
  ultimoRegistro,
  proximaAcao,
  listarRegistrosDia,
  listarRegistrosDiaTodos,
  minutosTrabalhadosDia,
  formatMinutos,
  labelTipo,
  labelMetodo,
  TIPOS_PONTO,
  getOuCriarDeviceId,
} from "../lib/ponto.js";
import { formatDate } from "../utils.js";
// Biometria nativa (Capacitor) — funciona só em APK Android/iOS.
// authenticateBiometric: prompt do OS (Touch/Face ID). Retorna boolean.
// isBiometricAvailable: checa sensor + cadastro no device.
import { isNative, isBiometricAvailable, authenticateBiometric } from "../platform.js";

// Componentes faciais lazy — o chunk só baixa quando o usuário abre o modal
// pela primeira vez. Mantém o bundle inicial leve para quem usa apenas PIN.
const PontoFaceLazy = {
  Enrollment: lazy(() => import("./PontoFaceComponents.jsx").then((m) => ({ default: m.FaceEnrollmentModal }))),
  Verify: lazy(() => import("./PontoFaceComponents.jsx").then((m) => ({ default: m.FaceVerifyModal }))),
};

// Coleta GPS de forma não-bloqueante. Resolve sempre — null em caso de erro
// ou ausência de permissão. A captura roda em paralelo ao registro: se demorar
// mais de 4s, segue sem GPS.
function tryGetGps(timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; resolve(null); }
    }, timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

export default function PontoModule({ user, addToast, employees, reloadData, db }) {
  const isAdminView = useMemo(
    () => user?.role === "admin" || user?.role === "gerente",
    [user]
  );

  // Tab principal (admin/gerente alterna entre o próprio ponto e a visão da equipe)
  const [tab, setTab] = useState(isAdminView ? "equipe" : "meu");

  // Toda mudança em registros bumpa esse contador para reler caches memoizados.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Ponto Eletrônico</h1>
          <p className="text-sm text-gray-400 mt-1">
            Registre sua jornada e acompanhe o histórico.
          </p>
        </div>
        {isAdminView && (
          <nav className="flex gap-1 rounded-lg border border-gray-700 bg-gray-800/40 p-1">
            <button
              type="button"
              onClick={() => setTab("meu")}
              className={`px-3 py-1.5 text-xs font-semibold rounded ${tab === "meu" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}
            >
              Meu ponto
            </button>
            <button
              type="button"
              onClick={() => setTab("equipe")}
              className={`px-3 py-1.5 text-xs font-semibold rounded ${tab === "equipe" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}
            >
              Equipe
            </button>
          </nav>
        )}
      </header>

      {tab === "meu" && (
        <MeuPontoView user={user} addToast={addToast} db={db} refresh={refresh} tick={tick} />
      )}
      {tab === "equipe" && isAdminView && (
        <EquipeView user={user} addToast={addToast} db={db} employees={employees} refresh={refresh} tick={tick} reloadData={reloadData} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MeuPontoView — tela do funcionário comum (e admin no modo "meu ponto")
// ────────────────────────────────────────────────────────────────────────────
function MeuPontoView({ user, addToast, db, refresh, tick }) {
  // user em FrostERP é o registro de erp:user:<id>. Para o ponto, vamos usar
  // user.id como funcionario_id (mesmo identificador).
  const userKey = `erp:user:${user?.id || ""}`;
  const userRecord = useMemo(() => (db ? db.get(userKey) : null), [db, userKey, tick]);
  const temPin = !!userRecord?.ponto_pin_hash;
  // Facial: descritor 128-dim médio gravado em ponto_face_descriptor.
  const temFacial = Array.isArray(userRecord?.ponto_face_descriptor)
    && userRecord.ponto_face_descriptor.length === 128;
  // Biometria nativa: flag opt-in por user. Diferente da facial, NÃO armazenamos
  // template — o OS (Android/iOS) gerencia. Apenas validamos quem está no
  // device naquele momento. Vetor de risco: dois funcionários compartilhando
  // device — ver doc de riscos em CLAUDE.md/wiki.
  const temBiometria = !!userRecord?.ponto_biometria_enabled;

  // Disponibilidade de biometria neste device — assíncrono, atualiza estado.
  const [biometriaDisp, setBiometriaDisp] = useState({ checked: false, available: false, type: null });
  useEffect(() => {
    let cancelled = false;
    if (!isNative()) { setBiometriaDisp({ checked: true, available: false, type: null }); return; }
    isBiometricAvailable().then((r) => {
      if (!cancelled) setBiometriaDisp({ checked: true, available: !!r?.available, type: r?.type || null });
    });
    return () => { cancelled = true; };
  }, []);

  // Dia de hoje (em ISO local — sem timezone shift).
  const hojeISO = new Date().toISOString().slice(0, 10);
  const jornada = useMemo(() => {
    if (!db || !user?.id) return null;
    return db.get(`erp:jornada:${user.id}`);
  }, [db, user, tick]);

  const registrosHoje = useMemo(
    () => (db && user?.id ? listarRegistrosDia(db, user.id, hojeISO) : []),
    [db, user, hojeISO, tick]
  );
  const minutosHoje = useMemo(() => minutosTrabalhadosDia(registrosHoje), [registrosHoje]);
  const proxima = useMemo(() => proximaAcao(registrosHoje, jornada), [registrosHoje, jornada]);

  // ─── Setup PIN ───
  const [showSetup, setShowSetup] = useState(false);
  // Modal de bater ponto
  const [showBater, setShowBater] = useState(false);
  // Setup facial (enrollment)
  const [showFaceEnroll, setShowFaceEnroll] = useState(false);

  // Quando user não tem PIN, força setup ao abrir o módulo (em ambiente real
  // seria via convite/onboarding, mas isso resolve a Fase A).
  useEffect(() => {
    if (userRecord && !temPin && !showSetup) {
      setShowSetup(true);
    }
  }, [userRecord, temPin, showSetup]);

  // ─── Callback ao concluir o enrollment facial ───
  // Recebe descritor médio (128 floats), grava em erp:user:<id>.
  const handleFaceEnrolled = useCallback((descriptor) => {
    if (!userRecord) return;
    const atualizado = {
      ...userRecord,
      ponto_face_descriptor: descriptor,
      ponto_face_enrolled_at: new Date().toISOString(),
    };
    db.set(`erp:user:${user.id}`, atualizado);
    addToast?.({ type: "success", message: "Reconhecimento facial cadastrado." });
    setShowFaceEnroll(false);
    refresh();
  }, [userRecord, db, user, addToast, refresh]);

  // Remove cadastro facial (LGPD: usuário pode revogar a qualquer momento).
  const handleRemoveFacial = useCallback(() => {
    if (!userRecord || !temFacial) return;
    if (typeof window !== "undefined" && !window.confirm("Remover seus dados faciais? Você poderá cadastrar de novo depois.")) {
      return;
    }
    const atualizado = { ...userRecord };
    delete atualizado.ponto_face_descriptor;
    delete atualizado.ponto_face_enrolled_at;
    db.set(`erp:user:${user.id}`, atualizado);
    addToast?.({ type: "info", message: "Cadastro facial removido." });
    refresh();
  }, [userRecord, temFacial, db, user, addToast, refresh]);

  // Habilita biometria nativa: testa o sensor pedindo autenticação uma vez
  // (UX explícita — usuário confirma o toque/face antes de "ativar"). Salva
  // a flag em erp:user para o fluxo de bater ponto detectar.
  const handleToggleBiometria = useCallback(async () => {
    if (!userRecord) return;
    if (temBiometria) {
      // Desabilitar — sem prompt extra (operação local, não invasiva).
      const atualizado = { ...userRecord, ponto_biometria_enabled: false };
      delete atualizado.ponto_biometria_enabled_at;
      db.set(`erp:user:${user.id}`, atualizado);
      addToast?.({ type: "info", message: "Biometria desabilitada." });
      refresh();
      return;
    }
    if (!biometriaDisp.available) {
      addToast?.({ type: "error", message: "Sensor biométrico indisponível neste device." });
      return;
    }
    const ok = await authenticateBiometric("Habilitar biometria para o ponto");
    if (!ok) {
      addToast?.({ type: "warning", message: "Autenticação biométrica falhou." });
      return;
    }
    const atualizado = {
      ...userRecord,
      ponto_biometria_enabled: true,
      ponto_biometria_enabled_at: new Date().toISOString(),
    };
    db.set(`erp:user:${user.id}`, atualizado);
    addToast?.({ type: "success", message: "Biometria habilitada para o ponto." });
    refresh();
  }, [userRecord, temBiometria, biometriaDisp, db, user, addToast, refresh]);

  return (
    <div className="space-y-5">
      {/* Card principal */}
      <section className="rounded-2xl border border-gray-700 bg-gradient-to-br from-gray-800/60 to-gray-900/40 backdrop-blur p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Hoje · {formatDate(hojeISO)}</p>
            <h2 className="text-xl font-bold text-white mt-1">{user?.nome || user?.email}</h2>
            <p className="text-sm text-gray-300 mt-1">
              Trabalhadas: <strong className="text-white">{formatMinutos(minutosHoje)}</strong>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide">Próxima ação</p>
            <p className="text-base font-semibold text-blue-300">{labelTipo(proxima)}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3 items-center">
          <button
            type="button"
            onClick={() => {
              if (!temPin) { setShowSetup(true); return; }
              setShowBater(true);
            }}
            className="flex-1 sm:flex-none px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-900/40 transition"
          >
            Registrar ponto
          </button>
          <button
            type="button"
            onClick={() => setShowSetup(true)}
            className="text-xs text-gray-400 hover:text-white px-3 py-2"
          >
            {temPin ? "Trocar PIN" : "Definir PIN"}
          </button>
          {temPin && (
            <button
              type="button"
              onClick={() => setShowFaceEnroll(true)}
              className="text-xs text-gray-400 hover:text-white px-3 py-2"
              title="Cadastrar reconhecimento facial para bater ponto sem digitar PIN"
            >
              {temFacial ? "Atualizar facial" : "+ Cadastrar facial"}
            </button>
          )}
          {temFacial && (
            <button
              type="button"
              onClick={handleRemoveFacial}
              className="text-[11px] text-red-400/80 hover:text-red-300 px-2 py-1"
            >
              Remover facial
            </button>
          )}
          {/* Toggle biometria nativa — só aparece em APK quando o sensor existe. */}
          {biometriaDisp.checked && biometriaDisp.available && (
            <button
              type="button"
              onClick={handleToggleBiometria}
              className="text-xs text-gray-400 hover:text-white px-3 py-2"
              title={temBiometria ? "Desabilitar biometria" : "Habilitar biometria nativa (impressão ou face)"}
            >
              {temBiometria ? "Desabilitar biometria" : "+ Habilitar biometria"}
            </button>
          )}
        </div>
        {temFacial && (
          <p className="mt-2 text-[11px] text-green-300/80">
            ✓ Reconhecimento facial ativo · cadastrado em {formatDate(userRecord.ponto_face_enrolled_at)}
          </p>
        )}
        {temBiometria && (
          <p className="mt-1 text-[11px] text-green-300/80">
            ✓ Biometria nativa habilitada ({biometriaDisp.type || "sensor do device"}) · {formatDate(userRecord.ponto_biometria_enabled_at)}
          </p>
        )}
      </section>

      {/* Histórico do dia */}
      <section>
        <h3 className="text-sm font-semibold text-white mb-2">Histórico de hoje</h3>
        {registrosHoje.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center text-sm text-gray-400">
            Nenhuma batida registrada hoje.
          </div>
        ) : (
          <ul className="rounded-2xl border border-gray-700 overflow-hidden">
            {registrosHoje.map((r, idx) => (
              <li
                key={r.id}
                className={`px-4 py-3 flex items-center justify-between gap-3 ${idx > 0 ? "border-t border-gray-800" : ""} bg-gray-800/40`}
              >
                <div>
                  <div className="text-sm font-semibold text-white">{labelTipo(r.tipo)}</div>
                  <div className="text-[11px] text-gray-400">
                    {new Date(r.datahora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    {" · "}
                    {labelMetodo(r.metodo)}
                    {r.manual_motivo && <> · <em className="not-italic">{r.manual_motivo}</em></>}
                  </div>
                </div>
                {r.gps_lat && (
                  <span className="text-[10px] text-gray-500" title={`lat ${r.gps_lat.toFixed(4)} lng ${r.gps_lng.toFixed(4)} acc ${Math.round(r.gps_acc || 0)}m`}>
                    📍
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Modais */}
      {showSetup && (
        <SetupPinModal
          user={user}
          userRecord={userRecord}
          db={db}
          addToast={addToast}
          temPin={temPin}
          onClose={() => setShowSetup(false)}
          onSaved={() => { setShowSetup(false); refresh(); }}
        />
      )}
      {showBater && (
        <BaterPontoModal
          user={user}
          userRecord={userRecord}
          db={db}
          addToast={addToast}
          proxima={proxima}
          temFacial={temFacial}
          temBiometria={temBiometria}
          onClose={() => setShowBater(false)}
          onRegistrado={() => { setShowBater(false); refresh(); }}
        />
      )}
      {showFaceEnroll && (
        <Suspense fallback={<LoadingOverlay msg="Carregando módulo facial…" />}>
          <PontoFaceLazy.Enrollment
            onClose={() => setShowFaceEnroll(false)}
            onSaved={handleFaceEnrolled}
            samplesNeeded={3}
          />
        </Suspense>
      )}
    </div>
  );
}

// Overlay leve enquanto o chunk facial está sendo baixado.
function LoadingOverlay({ msg }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-center justify-center">
      <div className="px-5 py-3 rounded-xl bg-gray-900 border border-gray-700 text-white text-sm">
        {msg}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SetupPinModal — cadastro/troca de PIN
// ────────────────────────────────────────────────────────────────────────────
function SetupPinModal({ user, userRecord, db, addToast, temPin, onClose, onSaved }) {
  const [pinAtual, setPinAtual] = useState("");
  const [pinNovo, setPinNovo] = useState("");
  const [pinNovo2, setPinNovo2] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault();
    setErro("");
    if (!/^\d{4,8}$/.test(pinNovo)) {
      setErro("PIN deve ter de 4 a 8 dígitos numéricos.");
      return;
    }
    if (pinNovo !== pinNovo2) {
      setErro("PINs não conferem.");
      return;
    }
    setLoading(true);
    try {
      // Se já tem PIN, exige PIN atual.
      if (temPin) {
        const ok = await verifyPin(user.id, pinAtual, userRecord.ponto_pin_hash);
        if (!ok) {
          setErro("PIN atual incorreto.");
          setLoading(false);
          return;
        }
      }
      const hash = await hashPin(user.id, pinNovo);
      const atualizado = { ...userRecord, ponto_pin_hash: hash };
      db.set(`erp:user:${user.id}`, atualizado);
      addToast?.({ type: "success", message: temPin ? "PIN atualizado." : "PIN cadastrado." });
      onSaved?.();
    } catch (err) {
      setErro(err?.message || "Erro ao salvar PIN.");
    } finally {
      setLoading(false);
    }
  }, [pinNovo, pinNovo2, pinAtual, temPin, user, userRecord, db, addToast, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-bold text-white">{temPin ? "Trocar PIN" : "Definir PIN do ponto"}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Fechar">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {temPin && (
            <PinInput
              id="pin-atual"
              label="PIN atual"
              value={pinAtual}
              onChange={setPinAtual}
              autoFocus
            />
          )}
          <PinInput
            id="pin-novo"
            label="Novo PIN (4 a 8 dígitos)"
            value={pinNovo}
            onChange={setPinNovo}
            autoFocus={!temPin}
          />
          <PinInput
            id="pin-novo-2"
            label="Confirmar novo PIN"
            value={pinNovo2}
            onChange={setPinNovo2}
          />

          {erro && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
          >
            {loading ? "Salvando…" : (temPin ? "Atualizar" : "Cadastrar PIN")}
          </button>
        </form>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BaterPontoModal — prioridade: biometria > facial > PIN
// ────────────────────────────────────────────────────────────────────────────
// Estados internos:
//   "biometria" — dispara prompt nativo do OS (Capacitor). Sucesso → grava direto.
//                 Falha → cai para facial (se temFacial) ou PIN.
//   "facial"    — abre FaceVerifyModal; falha 2x cai para PIN
//   "pin"       — entrada de PIN
function BaterPontoModal({ user, userRecord, db, addToast, proxima, temFacial, temBiometria, onClose, onRegistrado }) {
  // Modo inicial: respeita prioridade biometria > facial > PIN.
  const modoInicial = temBiometria ? "biometria" : (temFacial ? "facial" : "pin");
  const [modo, setModo] = useState(modoInicial);
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  // Cache do deviceId em ref pra não recriar a cada render.
  const deviceIdRef = useRef(getOuCriarDeviceId());

  // Helper compartilhado: grava o registro de ponto com método informado.
  const gravarRegistro = useCallback(async (metodo, extras = {}) => {
    const gps = await tryGetGps(4000);
    const reg = registrarPonto(db, {
      funcionario_id: user.id,
      tipo: proxima,
      metodo,
      gps,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      device_id: deviceIdRef.current,
      ...extras,
    });
    addToast?.({
      type: "success",
      message: `${labelTipo(reg.tipo)} registrada às ${new Date(reg.datahora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
    });
    onRegistrado?.();
  }, [db, user, proxima, addToast, onRegistrado]);

  // ─── Sub-fluxo: biometria nativa ───
  // Prompt do OS abre direto (sem UI extra). Sucesso → grava. Falha → próximo
  // método disponível. Auto-trigger ao entrar nesse modo: useEffect dispara
  // imediatamente para não exigir clique adicional.
  useEffect(() => {
    if (modo !== "biometria") return;
    let cancelled = false;
    (async () => {
      try {
        const ok = await authenticateBiometric(`Registrar ponto — ${labelTipo(proxima)}`);
        if (cancelled) return;
        if (ok) {
          await gravarRegistro("biometria");
        } else {
          // Falha (cancelado pelo usuário, sem cadastro ou sensor inacessível).
          // Cai para próximo método disponível na ordem facial → PIN.
          addToast?.({
            type: "warning",
            message: temFacial ? "Biometria falhou. Tente facial." : "Biometria falhou. Use PIN.",
          });
          setModo(temFacial ? "facial" : "pin");
        }
      } catch (err) {
        if (cancelled) return;
        addToast?.({ type: "error", message: err?.message || "Erro na biometria." });
        setModo(temFacial ? "facial" : "pin");
      }
    })();
    return () => { cancelled = true; };
  // gravarRegistro/labelTipo são estáveis suficiente; dependência só do modo
  // para evitar re-disparos.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  if (modo === "biometria") {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Próxima ação</p>
          <h3 className="text-2xl font-bold text-white mt-1">{labelTipo(proxima)}</h3>
          <p className="text-sm text-gray-300 mt-4">Aguardando autenticação biométrica…</p>
          <button
            type="button"
            onClick={() => setModo(temFacial ? "facial" : "pin")}
            className="mt-4 text-xs text-blue-400 hover:text-blue-300"
          >
            Usar {temFacial ? "facial" : "PIN"} em vez disso
          </button>
        </div>
      </div>
    );
  }

  // ─── Sub-fluxo: facial ───
  if (modo === "facial") {
    return (
      <Suspense fallback={<LoadingOverlay msg="Abrindo câmera…" />}>
        <PontoFaceLazy.Verify
          storedDescriptor={userRecord?.ponto_face_descriptor}
          onClose={onClose}
          onMatch={async ({ distance, score }) => {
            try {
              await gravarRegistro("facial", { face_score: score, face_distance: distance });
            } catch (err) {
              addToast?.({ type: "error", message: err?.message || "Erro ao registrar." });
            }
          }}
          onFail={(motivo) => {
            // Após 2 falhas (no_face ou no_match), cai pra PIN.
            addToast?.({
              type: "warning",
              message: motivo === "no_face"
                ? "Rosto não detectado. Use PIN como fallback."
                : "Reconhecimento falhou. Use PIN como fallback.",
            });
            setModo("pin");
          }}
        />
      </Suspense>
    );
  }

  // ─── Sub-fluxo: PIN ───
  const handleSubmit = async (e) => {
    e?.preventDefault();
    setErro("");
    setLoading(true);
    try {
      const ok = await verifyPin(user.id, pin, userRecord?.ponto_pin_hash);
      if (!ok) {
        setErro("PIN incorreto.");
        setLoading(false);
        return;
      }
      await gravarRegistro("pin");
    } catch (err) {
      setErro(err?.message || "Erro ao registrar ponto.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
        <div className="px-5 py-5 border-b border-gray-700 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Próxima ação</p>
          <h3 className="text-2xl font-bold text-white mt-1">{labelTipo(proxima)}</h3>
          <p className="text-xs text-gray-500 mt-1">Informe seu PIN para confirmar.</p>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <PinInput
            id="pin-bater"
            label="PIN"
            value={pin}
            onChange={setPin}
            autoFocus
            large
          />
          {erro && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {erro}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-3">
              {temBiometria && (
                <button
                  type="button"
                  onClick={() => { setModo("biometria"); setErro(""); setPin(""); }}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  ← Tentar biometria
                </button>
              )}
              {temFacial && (
                <button
                  type="button"
                  onClick={() => { setModo("facial"); setErro(""); setPin(""); }}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  ← Tentar facial
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-300 hover:text-white" disabled={loading}>
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || pin.length < 4}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Registrando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// EquipeView — painel admin/gerente
// ────────────────────────────────────────────────────────────────────────────
function EquipeView({ user, addToast, db, employees, refresh, tick, reloadData }) {
  const [dataRef, setDataRef] = useState(new Date().toISOString().slice(0, 10));
  const [filtroFunc, setFiltroFunc] = useState("");

  const registros = useMemo(() => {
    if (!db) return [];
    let r = listarRegistrosDiaTodos(db, dataRef);
    if (filtroFunc) r = r.filter((x) => x.funcionario_id === filtroFunc);
    return r;
  }, [db, dataRef, filtroFunc, tick]);

  // Mapa id→nome para enriquecer a tabela.
  const empById = useMemo(() => {
    const map = new Map();
    (employees || []).forEach((e) => map.set(e.id, e));
    // users (erp:user:*) também podem ser sujeitos do ponto — buscar dali se não achar.
    if (db) {
      db.list("erp:user:").forEach((u) => {
        if (u && !map.has(u.id)) map.set(u.id, u);
      });
    }
    return map;
  }, [employees, db, tick]);

  // KPIs do dia
  const kpis = useMemo(() => {
    const ids = new Set(registros.map((r) => r.funcionario_id));
    return {
      bateram: ids.size,
      total_registros: registros.length,
      manuais: registros.filter((r) => r.metodo === "manual").length,
    };
  }, [registros]);

  // Modal de inclusão manual
  const [showManual, setShowManual] = useState(false);

  return (
    <div className="space-y-5">
      {/* Filtros + KPIs */}
      <section className="rounded-2xl border border-gray-700 bg-gray-800/40 backdrop-blur p-4 flex flex-wrap gap-3 items-end justify-between">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label htmlFor="data-ref" className="block text-[11px] font-semibold text-gray-400 mb-1">Data</label>
            <input
              id="data-ref"
              type="date"
              value={dataRef}
              onChange={(e) => setDataRef(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label htmlFor="filtro-func" className="block text-[11px] font-semibold text-gray-400 mb-1">Funcionário</label>
            <select
              id="filtro-func"
              value={filtroFunc}
              onChange={(e) => setFiltroFunc(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Todos</option>
              {(employees || []).map((e) => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowManual(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
        >
          + Registro manual
        </button>
      </section>

      {/* KPIs */}
      <section className="grid grid-cols-3 gap-3">
        <Kpi label="Bateram hoje" value={kpis.bateram} />
        <Kpi label="Total de batidas" value={kpis.total_registros} />
        <Kpi label="Registros manuais" value={kpis.manuais} />
      </section>

      {/* Tabela */}
      {registros.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-800/30 p-10 text-center text-sm text-gray-400">
          Sem batidas nesse filtro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/70 text-gray-300">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Funcionário</th>
                <th className="text-left px-3 py-2 font-semibold">Tipo</th>
                <th className="text-left px-3 py-2 font-semibold">Horário</th>
                <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">Método</th>
                <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">GPS</th>
              </tr>
            </thead>
            <tbody>
              {registros.map((r) => {
                const e = empById.get(r.funcionario_id);
                return (
                  <tr key={r.id} className="border-t border-gray-700 hover:bg-gray-800/40">
                    <td className="px-3 py-2 text-white">{e?.nome || r.funcionario_id}</td>
                    <td className="px-3 py-2 text-gray-200">{labelTipo(r.tipo)}</td>
                    <td className="px-3 py-2 text-gray-200">
                      {new Date(r.datahora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-3 py-2 text-gray-400 hidden md:table-cell">
                      {labelMetodo(r.metodo)}
                      {r.manual_motivo && <span className="block text-[11px] text-gray-500 italic">{r.manual_motivo}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-400 hidden md:table-cell">
                      {r.gps_lat ? "📍 OK" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showManual && (
        <ManualRegistroModal
          user={user}
          db={db}
          employees={employees}
          dataRef={dataRef}
          addToast={addToast}
          onClose={() => setShowManual(false)}
          onSalvo={() => { setShowManual(false); refresh(); reloadData?.(); }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ManualRegistroModal — admin/gerente inclui batida manualmente
// ────────────────────────────────────────────────────────────────────────────
function ManualRegistroModal({ user, db, employees, dataRef, addToast, onClose, onSalvo }) {
  const [funcId, setFuncId] = useState("");
  const [tipo, setTipo] = useState("entrada");
  const [hora, setHora] = useState("08:00");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback((e) => {
    e?.preventDefault();
    setErro("");
    if (!funcId) { setErro("Selecione um funcionário."); return; }
    if (!motivo.trim()) { setErro("Informe o motivo do registro manual."); return; }
    setLoading(true);
    try {
      // dataRef + hora → ISO local. new Date com string YYYY-MM-DDTHH:MM
      // interpreta no fuso local, depois toISOString converte pra UTC.
      const datahora = new Date(`${dataRef}T${hora}:00`).toISOString();
      registrarPonto(db, {
        funcionario_id: funcId,
        tipo,
        metodo: "manual",
        datahora,
        manual_motivo: motivo.trim(),
        manual_por: user.id,
      });
      addToast?.({ type: "success", message: "Registro manual salvo." });
      onSalvo?.();
    } catch (err) {
      setErro(err?.message || "Erro ao salvar.");
    } finally {
      setLoading(false);
    }
  }, [funcId, tipo, hora, motivo, dataRef, db, user, addToast, onSalvo]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Registro manual</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Fechar">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label htmlFor="mr-func" className="block text-xs font-semibold text-gray-300 mb-1">Funcionário <span className="text-red-400">*</span></label>
            <select
              id="mr-func"
              value={funcId}
              onChange={(e) => setFuncId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              required
            >
              <option value="">Selecione…</option>
              {(employees || []).map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.nome}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="mr-tipo" className="block text-xs font-semibold text-gray-300 mb-1">Tipo</label>
              <select
                id="mr-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              >
                {TIPOS_PONTO.map((t) => <option key={t} value={t}>{labelTipo(t)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="mr-hora" className="block text-xs font-semibold text-gray-300 mb-1">Horário</label>
              <input
                id="mr-hora"
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="mr-motivo" className="block text-xs font-semibold text-gray-300 mb-1">
              Motivo <span className="text-red-400">*</span>
            </label>
            <textarea
              id="mr-motivo"
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white resize-none"
              placeholder="Ex: Bateu fora do horário (esqueceu celular)."
              required
            />
          </div>

          {erro && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {erro}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-300 hover:text-white" disabled={loading}>
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
            >
              {loading ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Componentes auxiliares
// ────────────────────────────────────────────────────────────────────────────

// Input de PIN: numérico, large quando usado em tela de bater.
function PinInput({ id, label, value, onChange, autoFocus, large }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-300 mb-1">{label}</label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
        autoFocus={autoFocus}
        className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 ${large ? "py-3 text-center tracking-[0.5em] text-xl" : "py-2"} text-white focus:outline-none focus:border-blue-500`}
        maxLength={8}
      />
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="rounded-2xl border border-gray-700 bg-gray-800/40 p-4">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}
