#!/usr/bin/env bash
# install.sh — instala Docker + Compose e sobe a stack Evolution + Caddy.
# Rodar como root no servidor Ubuntu 24.04 recém-criado.
#
# Uso:
#   1. scp -r evolution-vps/ root@SEU_IP:/opt/evolution
#   2. ssh root@SEU_IP
#   3. cd /opt/evolution && cp .env.example .env && nano .env
#   4. chmod +x install.sh && ./install.sh

set -euo pipefail

echo ">> Atualizando sistema..."
apt-get update -y
apt-get upgrade -y

echo ">> Instalando dependências..."
apt-get install -y curl ca-certificates ufw

if ! command -v docker &>/dev/null; then
  echo ">> Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  echo ">> Docker já instalado."
fi

echo ">> Configurando firewall (UFW)..."
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP (Caddy redireciona pra 443)
ufw allow 443/tcp    # HTTPS
ufw --force enable

if [ ! -f .env ]; then
  echo "!! Arquivo .env não encontrado. Copie de .env.example e preencha:"
  echo "   cp .env.example .env && nano .env"
  exit 1
fi

echo ">> Subindo containers..."
docker compose pull
docker compose up -d

echo ">> Aguardando containers ficarem saudáveis (30s)..."
sleep 30

docker compose ps

echo ""
echo "========================================"
echo "  Evolution API instalada ✅"
echo "========================================"
echo ""
echo "Próximos passos:"
echo "  1. Confira: docker compose logs -f evolution"
echo "  2. Teste o domínio: curl https://\$EVOLUTION_DOMAIN"
echo "  3. Crie uma instância: veja README.md, seção 'Criar instância WhatsApp'"
