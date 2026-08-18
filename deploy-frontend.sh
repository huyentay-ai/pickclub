#!/bin/bash
# Deploy chỉ frontend (CSS + views) lên server mà không rebuild Docker image
# Yêu cầu: SSH access tới server, container đang chạy

SERVER="root@pickcatuan.top"
CONTAINER="pick-club-app"   # tên container (kiểm tra bằng: docker ps)
SSH_KEY=""                  # đường dẫn SSH key nếu cần, ví dụ: -i ~/.ssh/id_rsa

# Danh sách file cần cập nhật (thêm/bớt tùy nhu cầu)
FILES=(
  "public/css/style.css"
  "views/index.ejs"
  "views/leaderboard.ejs"
  "views/partials/header.ejs"
  "views/partials/footer.ejs"
)

SSH_OPTS="-o StrictHostKeyChecking=no"
[ -n "$SSH_KEY" ] && SSH_OPTS="$SSH_OPTS -i $SSH_KEY"

echo "==> Upload files lên server..."
for f in "${FILES[@]}"; do
  echo "    $f"
  scp $SSH_OPTS "$f" "$SERVER:/tmp/pick_ui_$(basename $f)"
done

echo "==> Copy vào container..."
ssh $SSH_OPTS "$SERVER" bash <<REMOTE
set -e
$(for f in "${FILES[@]}"; do
  echo "docker cp /tmp/pick_ui_$(basename $f) $CONTAINER:/app/$f"
  echo "rm /tmp/pick_ui_$(basename $f)"
done)
echo "    Done!"
REMOTE

echo "==> Xong! CSS và views đã cập nhật (không cần restart)."
echo "    Thử xóa cache trình duyệt nếu CSS chưa thấy thay đổi."
