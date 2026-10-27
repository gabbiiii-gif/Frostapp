// Backup dos ARQUIVOS do Supabase Storage (fotos de OS, assinaturas, mídias do
// WhatsApp, ofícios, ponto). O `supabase db dump` copia só o banco: os arquivos
// ficam de fora e precisam deste script. Baixa todos os buckets, mantendo as
// pastas, para uma pasta local.
//
// Uso (PowerShell, na raiz do projeto):
//   $env:SUPABASE_URL = "https://rbwzhglsztmjvwrcydcy.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service_role — Settings → API Keys>"
//   node scripts/backup-storage.mjs C:\backups\frosterp\2026-10-27\storage
//
// A chave service_role ignora toda a segurança do banco: nunca commite, nunca
// mande por chat. Feche o terminal (ou limpe as variáveis) ao terminar.

import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const POR_PAGINA = 1000; // limite do list() do Storage
const EM_PARALELO = 5;

// Lista todos os arquivos de um bucket, entrando nas pastas e paginando.
// No list() do Storage, pasta é o item sem `id`.
export async function listarArquivos(storage, bucket, pasta = '') {
  const arquivos = [];
  for (let offset = 0; ; offset += POR_PAGINA) {
    const { data, error } = await storage.from(bucket).list(pasta, { limit: POR_PAGINA, offset });
    if (error) throw new Error(`listar ${bucket}/${pasta}: ${error.message}`);
    for (const item of data || []) {
      const caminho = pasta ? `${pasta}/${item.name}` : item.name;
      if (item.id) arquivos.push({ caminho, tamanho: item.metadata?.size || 0 });
      else arquivos.push(...await listarArquivos(storage, bucket, caminho));
    }
    if (!data || data.length < POR_PAGINA) return arquivos;
  }
}

// Baixa todos os buckets para `destino/<bucket>/<caminho>`. Devolve o resumo;
// falha de um arquivo não interrompe os outros (vai para `falhas`).
export async function backupStorage(supabase, destino, log = console.log) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`listar buckets: ${error.message}`);
  const resumo = { buckets: 0, arquivos: 0, bytes: 0, falhas: [] };
  for (const bucket of buckets || []) {
    const arquivos = await listarArquivos(supabase.storage, bucket.name);
    log(`${bucket.name}: ${arquivos.length} arquivo(s)`);
    resumo.buckets++;
    for (let i = 0; i < arquivos.length; i += EM_PARALELO) {
      await Promise.all(arquivos.slice(i, i + EM_PARALELO).map(async ({ caminho }) => {
        try {
          const { data, error: erroDown } = await supabase.storage.from(bucket.name).download(caminho);
          if (erroDown) throw new Error(erroDown.message);
          const conteudo = Buffer.from(await data.arrayBuffer());
          const arquivo = join(destino, bucket.name, ...caminho.split('/'));
          await mkdir(dirname(arquivo), { recursive: true });
          await writeFile(arquivo, conteudo);
          resumo.arquivos++;
          resumo.bytes += conteudo.length;
        } catch (e) {
          resumo.falhas.push(`${bucket.name}/${caminho}: ${e.message}`);
        }
      }));
    }
  }
  return resumo;
}

async function main() {
  const destino = process.argv[2];
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!destino || !url || !chave) {
    console.error('Uso: node scripts/backup-storage.mjs <pasta-destino>  (com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente)');
    process.exit(2);
  }
  const supabase = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await backupStorage(supabase, destino);
  console.log(`\nBackup: ${r.arquivos} arquivo(s), ${(r.bytes / 1048576).toFixed(1)} MB, ${r.buckets} bucket(s) → ${destino}`);
  if (r.falhas.length) {
    console.error(`\n${r.falhas.length} falha(s):\n  ${r.falhas.join('\n  ')}`);
    process.exit(1);
  }
}

// Só roda quando chamado direto (o teste importa as funções sem disparar o backup).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
