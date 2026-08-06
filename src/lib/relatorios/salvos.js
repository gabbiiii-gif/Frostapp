// Persistência dos relatórios salvos. O que é gravado é a CONFIGURAÇÃO
// (ReportSpec), nunca o resultado: reabrir o relatório recalcula com os dados
// atuais. Escrever pela camada DB dá de graça escopo por empresa, audit trail e
// sync com o Supabase — por isso nada aqui fala com window.storage direto.

export const PREFIXO_RELATORIO = "erp:relatorio:";

export function montarRegistroSalvo({ id, nome, descricao = "", spec, usuarioNome = "", agora, criadoEm }) {
  const ts = agora || new Date().toISOString();
  return {
    id,
    // Trim ANTES do fallback: "   " é truthy e passaria direto, gravando um
    // card sem nome visível na biblioteca.
    nome: String(nome || "").trim() || "Relatório sem nome",
    descricao: String(descricao || "").trim(),
    spec,
    criadoPor: usuarioNome,
    // Edição preserva o carimbo de criação; só `atualizadoEm` anda.
    criadoEm: criadoEm || ts,
    atualizadoEm: ts,
  };
}

// Registro sem spec é lixo de versão antiga ou gravação parcial: ignorar é
// melhor que renderizar um card que quebra ao abrir.
export function listarSalvos(db) {
  const itens = (db.list(PREFIXO_RELATORIO) || []).filter((r) => r && r.id && r.spec);
  return itens.sort((a, b) => String(b.atualizadoEm || "").localeCompare(String(a.atualizadoEm || "")));
}

export function salvarRelatorio(db, registro) {
  db.set(PREFIXO_RELATORIO + registro.id, registro);
  return registro;
}

export function excluirRelatorio(db, id) {
  db.delete(PREFIXO_RELATORIO + id);
}

export function duplicarRegistro(registro, { novoId, agora }) {
  const ts = agora || new Date().toISOString();
  return {
    ...registro,
    id: novoId,
    nome: `${registro.nome} (cópia)`,
    criadoEm: ts,
    atualizadoEm: ts,
  };
}
