#!/usr/bin/env bash
# deploy/setup-ec2.sh — One-shot bootstrap for an Amazon Linux 2023 EC2 instance.
#
# Run once after launching the instance (SSH key = notefusion.pem):
#   scp -i notefusion.pem deploy/setup-ec2.sh ec2-user@YOUR_EC2_IP:~/setup-ec2.sh
#   ssh -i notefusion.pem ec2-user@YOUR_EC2_IP "bash ~/setup-ec2.sh"

set -euo pipefail

APP_DIR="/opt/notefusion"

echo "==> [1/5] Install Docker (Amazon Linux 2023)"
sudo dnf update -y -q
sudo dnf install -y docker

echo "==> [2/5] Enable and start Docker"
sudo systemctl enable --now docker

# Add ec2-user to the docker group so SSH commands from CI don't need sudo.
sudo usermod -aG docker ec2-user

echo "==> [3/5] Install Docker Compose plugin"
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fsSL \
  "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

echo "==> [4/5] Create application directory"
sudo mkdir -p "$APP_DIR"
sudo chown ec2-user:ec2-user "$APP_DIR"

echo "==> [5/5] Create .env placeholder (CI will overwrite this on first deploy)"
cat > "$APP_DIR/.env" <<'EOF'
# Written by GitHub Actions deploy job on first push.
EOF

echo ""
echo "✅  EC2 setup complete. Log out and back in for docker group to take effect."
docker --version
docker compose version
