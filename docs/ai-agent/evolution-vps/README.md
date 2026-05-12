# Evolution API na Hetzner Cloud — Guia rápido

Tempo total: ~20 minutos. Custo: **€3,79/mês** (CX22) ou €4,51/mês (CPX11 com mais CPU).

## O que vai rodar nesse servidor

- **Evolution API** — bridge WhatsApp ↔ HTTP (porta 8080 interna)
- **Postgres 16** — banco da Evolution (sessões/instâncias) — separado do Supabase
- **Caddy** — reverse proxy com HTTPS automático (Let's Encrypt)

---

## Passo 1 — Criar conta Hetzner Cloud

1. https://accounts.hetzner.com/signUp
2. Confirme email, adicione cartão de crédito (ou Pix via boleto SEPA)
3. Crie um Projeto: `frostapp-evolution`

## Passo 2 — Apontar DNS

Você precisa de um subdomínio HTTPS — ex: `evolution.seudominio.com.br`.

Se você ainda **não tem domínio**, compre um em registro.br (~R$40/ano) ou Namecheap. Use o registrador de sua preferência.

No painel DNS do seu domínio, crie um registro:

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| A | `evolution` | (vamos preencher após criar VPS) | 300 |

> **Sem domínio próprio?** Avise — alternativa é usar DuckDNS (subdomínio grátis) ou expor sem domínio (perdemos HTTPS automático).

## Passo 3 — Criar Cloud Server

No painel Hetzner: **Servers → Add Server**

| Campo | Valor |
|---|---|
| Location | **Helsinki** (FSN1) ou **Nuremberg** (NBG1) — Brasil tem latência ~200ms |
| Image | **Ubuntu 24.04** |
| Type | **CX22** (€3,79/mês, 2 vCPU ARM, 4GB RAM) — sobra recurso |
| Network | IPv4 + IPv6 |
| SSH Key | Adicione sua chave pública (`~/.ssh/id_ed25519.pub`) — sem senha, mais seguro |
| Name | `frost-evolution` |

Clique **Create & Buy**. Em ~30s o servidor está pronto. Anote o **IPv4** que ele te dá.

## Passo 4 — Atualizar DNS

Volte no painel DNS do seu domínio e cole o IPv4 do servidor no registro A criado no passo 2. Aguarde 1-2 minutos (DNS propaga rápido pra TTL 300).

Teste:
```bash
dig +short evolution.seudominio.com.br
# deve retornar o IP do seu servidor
```

## Passo 5 — Subir a stack

### Pelo seu PC (PowerShell ou terminal):

```powershell
# Copiar arquivos pro servidor
scp -r "C:\Users\Sala AEE\Downloads\Frostapp-main (1)\Frostapp-main\docs\ai-agent\evolution-vps\*" root@SEU_IP:/opt/evolution/

# SSH
ssh root@SEU_IP
```

### Já no servidor:

```bash
cd /opt/evolution
cp .env.example .env

# Gerar chaves aleatórias seguras
echo "EVOLUTION_API_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"

# Edita .env e cola as chaves geradas + o domínio
nano .env

# Roda instalador
chmod +x install.sh
./install.sh
```

Em ~1min a stack sobe. Caddy emite o certificado HTTPS automaticamente.

### Validar:
```bash
curl https://evolution.seudominio.com.br
# Deve retornar: {"status":200,"message":"Welcome to the Evolution API..."}
```

---

## Passo 6 — Criar instância WhatsApp

Substitua `SUA_API_KEY` pela que está no `.env`:

```bash
curl -X POST 'https://evolution.seudominio.com.br/instance/create' \
  -H 'apikey: SUA_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "instanceName": "frost-minas",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'
```

A resposta traz um QR code em base64 (campo `qrcode.base64`). Vai ter algo tipo:
```json
{"qrcode":{"base64":"data:image/png;base64,iVBOR..."}}
```

Cole esse `data:image/png;base64,...` na barra de endereço do navegador → vai aparecer o QR. Abra **WhatsApp → ⋯ → Aparelhos conectados → Conectar aparelho** e escaneie.

### Conectado!

Verifique status:
```bash
curl 'https://evolution.seudominio.com.br/instance/connectionState/frost-minas' \
  -H 'apikey: SUA_API_KEY'
# {"instance":{"state":"open"}} = conectado
```

---

## Passo 7 — Teste de envio

```bash
curl -X POST 'https://evolution.seudominio.com.br/message/sendText/frost-minas' \
  -H 'apikey: SUA_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "number": "5531999998888",
    "text": "Teste do FrostERP! 🚀"
  }'
```

(Troque o número pelo seu, formato E.164 sem `+`.)

Se chegou no seu WhatsApp, **Evolution API está OK**. Próximo passo: subir N8N e apontar o webhook.

---

## Manutenção

```bash
# Ver logs
docker compose logs -f evolution

# Reiniciar
docker compose restart evolution

# Atualizar versão
docker compose pull && docker compose up -d

# Backup do banco (sessões WhatsApp)
docker compose exec evolution-db pg_dump -U evolution evolution > backup-$(date +%F).sql
```

## Troubleshooting

| Sintoma | Fix |
|---|---|
| `curl https://...` retorna timeout | DNS ainda não propagou, ou firewall bloqueando 443 |
| Caddy não emite cert | DNS ainda apontando pra outro IP. `docker compose logs caddy` mostra detalhes |
| QR code expira | Recrie a instância (DELETE + POST) |
| WhatsApp pede QR de novo | Sessão caiu — volume `evolution_instances` está intacto? |
| Webhook não dispara | `WEBHOOK_GLOBAL_URL` errado. Edite `.env` e `docker compose up -d` |
