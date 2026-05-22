# Design — Transcrição de áudio no agente WhatsApp

- **Data:** 2026-05-22
- **Escopo:** `supabase/functions/whatsapp-webhook/index.ts` (arquivo único)
- **Relacionado:** `docs/wiki/flows/whatsapp-ia-os.md`, `docs/wiki/modules/ia-atendimento.md`

## Problema

Hoje o webhook descarta qualquer mensagem que não seja texto ou imagem
(`index.ts:88` — `if (!text && !hasImage) return ok(); // áudio/outros — fase 2`).
Quando o cliente manda um áudio (nota de voz no WhatsApp), o agente simplesmente
não responde.

## Objetivo

Cliente manda áudio → o agente **transcreve** o áudio → trata a transcrição como
se fosse uma mensagem de texto → responde **por texto** normalmente.

Sem TTS: o agente nunca gera áudio. A resposta é sempre texto, igual ao fluxo
atual de mensagens escritas.

## Decisões

| Decisão | Escolha |
| --- | --- |
| Resposta do agente | Sempre texto (sem voz / sem TTS) |
| Serviço de transcrição (STT) | Groq Whisper — modelo `whisper-large-v3` |
| Guardar o áudio original | Sim — upload no bucket `ai-media`, espelhando o fluxo de imagem |
| Arquivos novos / tabelas novas | Nenhum |

## Fluxo

1. **Detectar áudio.** No parsing do evento `messages.upsert`, detectar
   `msg.audioMessage` (cobre notas de voz `ptt` e áudios anexados) → flag
   `hasAudio`. A guarda da linha 88 passa a aceitar áudio:
   `if (!text && !hasImage && !hasAudio) return ok();`. O job (`Job`) ganha o
   campo `hasAudio`.

2. **Baixar o áudio.** No background (`handleMessage`), quando `hasAudio` e
   houver `apikey` + `evolution_url`: POST para
   `${evoBase}/chat/getBase64FromMediaMessage/${instance}` com
   `{ message: { key: { id: messageId } }, convertToMp4: false }` → base64 do
   arquivo OGG/opus. Mesmo endpoint já usado para imagem.

3. **Guardar o áudio no bucket.** Upload do binário em
   `ai-media/${company_id}/${conv.id}/${uuid}.ogg`, `contentType: "audio/ogg"`,
   `upsert: false`. `getPublicUrl` → `mediaUrl`. Espelha exatamente o bloco de
   imagem (`index.ts:157-166`).

4. **Transcrever.** POST multipart `multipart/form-data` para
   `https://api.groq.com/openai/v1/audio/transcriptions`:
   - header `Authorization: Bearer ${GROQ_API_KEY}`
   - campo `file` = o blob OGG
   - campo `model` = `whisper-large-v3`
   - campo `language` = `pt`
   - campo `response_format` = `json`
   Retorna `{ text }`. A transcrição vira o `text` efetivo do job.

5. **Tratar como texto.** A partir daqui o fluxo **não muda**:
   - `ai_messages` (role `customer`): `content` = transcrição com prefixo
     `[áudio] ` (atendente identifica a origem no painel); `media_url` = URL do
     áudio guardado.
   - Gates (conversa não-`active`, fora de horário), histórico, loop do agente
     Claude, tools (`propose_os` etc.), gravação e envio da resposta via
     `/message/sendText` — tudo idêntico ao caminho de texto.

## Tratamento de falhas

- **Groq fora do ar, erro HTTP ou transcrição vazia:** grava em `ai_messages`
  (role `customer`, `content` = `[áudio não compreendido]`, `media_url`
  preenchida se o upload tiver ocorrido) e envia ao cliente uma frase fixa
  pedindo para escrever ou reenviar o áudio. **Não** chama o Claude nesse caso
  (não gasta token com input vazio). A frase também é gravada como `ai_messages`
  role `agent`.
- **Sem `apikey` / `evolution_url`:** não é possível baixar o áudio — mesma
  degradação acima (`[áudio não compreendido]` + frase fixa).
- O retorno `200` imediato e o processamento em background (`waitUntil`) não
  mudam.

## Configuração nova

- Secret `GROQ_API_KEY` na Edge Function `whatsapp-webhook` (Supabase). Único
  item novo de configuração. Sem `GROQ_API_KEY` definido, o caminho de áudio cai
  na degradação de falha (cliente é orientado a escrever).

## Fora de escopo

- TTS / resposta em áudio (o agente nunca gera voz).
- Outros tipos de mídia (vídeo, documento, sticker) — continuam descartados.
- Painel do app (`IAAtendimentoModule`) — já renderiza `media_url`; tocar áudio
  no painel pode exigir um `<audio>` em vez de `<img>`, a verificar na
  implementação, mas não é requisito desta spec.
