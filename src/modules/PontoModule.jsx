// ─── Módulo Ponto Eletrônico ─────────────────────────────────────────────────
// Stub inicial. Implementação completa em fases subsequentes:
//   - Fase A: Bater ponto (PIN) + lista de registros do funcionário logado.
//   - Fase B: Reconhecimento facial (face-api.js) + foto de auditoria.
//   - Fase C: Biometria nativa (Capacitor) + fallback PIN.
//   - Fase D: Banco de horas (cálculo, gráfico, exportação PDF/Excel).
//   - Fase E: Ocorrências (atestados, faltas justificadas) + aprovação admin.
//   - Fase F: Painel admin com visão da equipe + filtros + auditoria.
//
// Dados persistem em window.storage via DB utility (App.jsx) sob prefixos:
//   erp:ponto:<uuid>            → registros individuais
//   erp:jornada:<funcionarioId> → config de jornada
//   erp:ocorrencia:<uuid>       → justificativas
// Todos auto-sincronizados via SCOPED_PREFIXES → Supabase kv_store.

import { useMemo } from "react";

export default function PontoModule({ user /*, addToast, employees, reloadData */ }) {
  // Admin/gerente veem painel da equipe; demais usuários veem apenas o próprio
  // espelho (com botão de bater ponto). Lógica completa virá nas próximas fases.
  const isAdminView = useMemo(
    () => user?.role === "admin" || user?.role === "gerente",
    [user]
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Ponto Eletrônico</h1>
        <p className="text-sm text-gray-400 mt-1">
          {isAdminView
            ? "Painel da equipe — visão consolidada de batidas, banco de horas e ocorrências."
            : "Registre sua entrada/saída e acompanhe seu banco de horas."}
        </p>
      </header>

      {/* Placeholder visual usando glassmorphism padrão do FrostERP */}
      <div className="rounded-2xl border border-gray-700 bg-gray-800/40 backdrop-blur p-8 text-center">
        <p className="text-gray-300">
          Módulo em construção. Próxima entrega: <strong>Bater Ponto (PIN)</strong>.
        </p>
        <p className="text-xs text-gray-500 mt-3">
          Reconhecimento facial e biometria nativa entram nas fases seguintes.
        </p>
      </div>
    </div>
  );
}
