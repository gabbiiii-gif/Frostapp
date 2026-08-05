// Abertura e geração de documentos imprimíveis (OS, orçamento, recibo, relatório).
// Extraído do App.jsx para poder ser usado também por src/modules/ sem criar
// import circular — o App.jsx importa os módulos, então os módulos não podem
// importar o App.jsx de volta.

import html2pdf from "html2pdf.js";

// Opções compartilhadas de renderização: A4 retrato, escala 2 para o texto não
// sair borrado, useCORS para a logo hospedada no Storage entrar no PDF.
function _opcoesPDF(filename) {
  return {
    margin: 0,
    ...(filename ? { filename: filename + ".pdf" } : {}),
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  };
}

// Renderiza o HTML num container fora da tela e devolve o objeto html2pdf já
// apontado para o elemento certo. O html2canvas precisa do elemento no DOM para
// medir a largura, daí o container temporário.
async function _comContainer(html, fn) {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:794px";
  document.body.appendChild(container);
  try {
    const alvo = container.querySelector("main.page") || container;
    return await fn(alvo);
  } finally {
    document.body.removeChild(container);
  }
}

// Gera e baixa um PDF a partir do HTML completo de um documento. Roda no
// contexto do app (html2pdf empacotado = permitido pela CSP 'self').
export async function gerarPDFDeHTML(html, filename) {
  await _comContainer(html, (alvo) => (
    html2pdf().set(_opcoesPDF(filename || "documento")).from(alvo).save()
  ));
}

// Mesma renderização, mas devolve o PDF em base64 puro (sem o prefixo
// "data:application/pdf;base64,"). É o formato que a Evolution API espera no
// campo `media` do sendMedia.
export async function htmlParaPDFBase64(html) {
  const dataUri = await _comContainer(html, (alvo) => (
    html2pdf().set(_opcoesPDF(null)).from(alvo).output("datauristring")
  ));
  return String(dataUri).split(",")[1] || "";
}

// Abre a janela vazia e escreve o HTML direto. Evita window.open(blobURL):
// ali o w.document inicial é o about:blank (readyState "complete"), e ligar
// os botões nesse momento erra o documento real que ainda vai carregar.
// Com document.write o DOM fica pronto de forma síncrona após o close().
export function openHTMLDoc(html) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Permita popups para gerar documentos.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();

  // Nome do arquivo PDF derivado do <title> do documento.
  const titulo = (html.match(/<title>([^<]*)<\/title>/i)?.[1] || "documento").trim();
  const filename = titulo.replace(/[^a-zA-Z0-9-_]+/g, "-") || "documento";

  // Liga os botões da barra de ações pelo contexto do app (a CSP impede
  // scripts dentro do próprio documento, que é uma janela isolada). Após o
  // document.close() os elementos já existem, então não há corrida.
  try {
    const doc = w.document;
    const btnPrint = doc.getElementById("btn-print");
    const btnClose = doc.getElementById("btn-close");
    const btnPdf = doc.getElementById("btn-pdf");
    if (btnPrint) btnPrint.addEventListener("click", () => w.print());
    if (btnClose) btnClose.addEventListener("click", () => w.close());
    if (btnPdf) btnPdf.addEventListener("click", async () => {
      const orig = btnPdf.textContent;
      btnPdf.disabled = true;
      btnPdf.textContent = "Gerando...";
      try {
        await gerarPDFDeHTML(html, filename);
      } catch (e) {
        console.error("[openHTMLDoc] PDF:", e);
        alert("Falha ao gerar o PDF. Use Imprimir como alternativa.");
      } finally {
        btnPdf.disabled = false;
        btnPdf.textContent = orig;
      }
    });
  } catch (e) {
    console.error("[openHTMLDoc] não foi possível ligar a barra de ações:", e);
  }
}
