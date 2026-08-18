#!/bin/bash
# Deploy toàn bộ app lên server pickcatuan.top
# Dùng khi có thay đổi backend (JS routes, server.js, database.js...)
# Yêu cầu: SSH access, git repo đã push code mới lên remote

SERVER="root@pickcatuan.top"
SSH_KEY=""   # đường dẫn SSH key nếu cần, ví dụ: ~/.ssh/id_rsa
APP_DIR="/root/pick-club"   # thư mục project trên server

SSH_OPTS="-o StrictHostKeyChecking=no"
[ -n "$SSH_KEY" ] && SSH_OPTS="$SSH_OPTS -i $SSH_KEY"

echo "==> Deploy pick-club lên $SERVER"
echo ""

ssh $SSH_OPTS "$SERVER" bash <<REMOTE
set -e
cd $APP_DIR

echo "[1/4] Pull code mới..."
git pull

echo "[2/4] Build Docker image..."
docker compose build

echo "[3/4] Khởi động lại container..."
docker compose up -d

echo "[4/4] Kiểm tra container..."
sleep 3
docker compose ps

echo ""
echo "==> Deploy xong! Site: https://pickcatuan.top"
REMOTE
