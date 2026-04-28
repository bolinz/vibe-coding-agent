#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Vibe Coding Agent Deployment ===${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Please run as root${NC}"
   exit 1
fi

# Variables
APP_DIR="/opt/vibe-coding-agent"
APP_USER="aiuser"
APP_GROUP="aiuser"

echo -e "${YELLOW}1. Installing dependencies...${NC}"
apt update && apt upgrade -y
apt install -y curl git tmux nginx fail2ban redis-server

echo -e "${YELLOW}2. Creating user...${NC}"
if ! id "$APP_USER" &>/dev/null; then
    useradd -m -s /bin/bash -G docker $APP_USER
    echo "$APP_USER:$APP_USER" | chpasswd
fi

echo -e "${YELLOW}3. Installing Bun...${NC}"
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

echo -e "${YELLOW}4. Creating app directory...${NC}"
mkdir -p $APP_DIR
cp -r . $APP_DIR
chown -R $APP_USER:$APP_GROUP $APP_DIR

echo -e "${YELLOW}5. Installing dependencies...${NC}"
cd $APP_DIR
su - $APP_USER -c "bun install"

echo -e "${YELLOW}6. Creating sandbox directory...${NC}"
mkdir -p /projects/sandbox
chown $APP_USER:$APP_GROUP /projects/sandbox
chmod 770 /projects/sandbox

echo -e "${YELLOW}7. Configuring systemd...${NC}"
cp config/systemd.conf /etc/systemd/system/vibe-agent.service
systemctl daemon-reload
systemctl enable vibe-agent

echo -e "${YELLOW}8. Configuring nginx...${NC}"
cp config/nginx.conf /etc/nginx/sites-available/vibe-agent
ln -sf /etc/nginx/sites-available/vibe-agent /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo -e "${YELLOW}9. Configuring firewall...${NC}"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo -e "${YELLOW}10. Starting services...${NC}"
systemctl start redis-server
systemctl start vibe-agent
systemctl status vibe-agent --no-pager

echo -e "${GREEN}=== Deployment Complete! ===${NC}"
echo "App directory: $APP_DIR"
echo "Sandbox: /projects/sandbox"
echo "Logs: journalctl -u vibe-agent -f"
