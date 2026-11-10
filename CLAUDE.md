# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Website cho CLB Pickleball "Vui cả tuần" — quản lý thành viên, đội hình, hệ thống thách đấu bữa sáng, quỹ bữa sáng (bảng xếp hạng), và trang quản trị. Giao diện tiếng Việt, thiết kế theo style World Cup Breakfast (nền xanh mint, navbar đen, hero card bo tròn).

## Commands

- `npm start` — chạy server (port 3000 hoặc `PORT` env)
- `npm run dev` — chạy server với `--watch` (auto-restart khi file thay đổi)
- `docker compose up -d --build` — build và chạy bằng Docker (port 3001:3000)
- Xóa `data/` để reset toàn bộ database (sẽ tự tạo lại + seed khi khởi động)

## Deploy

Hai script deploy lên server `pickcatuan.top`:

| Script | Dùng khi | Cần restart? |
|--------|----------|--------------|
| `deploy.sh` | Thay đổi backend (JS routes, server.js...) | Rebuild Docker image |
| `deploy-frontend.sh` | Chỉ CSS hoặc EJS views | Không cần restart |

```bash
bash deploy.sh           # full rebuild
bash deploy-frontend.sh  # chỉ CSS + views
```

Backup / restore database (bind mount `./data`, không cần vào container):
```
# Dùng sqlite3 backup API qua container
  docker exec pick-club node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/club.db');
  db.backup('/app/data/club-backup.db').then(() => console.log('done'));
  "
```
```bash
cp data/club.db ./club-backup.db      # backup
cp ./club-backup.db data/club.db      # restore (nên dừng container trước khi ghi đè)
```


## Architecture

Node.js/Express + EJS server-rendered views + SQLite (better-sqlite3). Docker deployment với volume cho data persistence.

### Database

- File: `data/club.db` (tự tạo khi khởi động)
- Schema trong `database.js`: `users`, `teams`, `team_members`, `challenges`, `match_results`, `notifications`, `activity_logs`
- Seed data: 13 thành viên (mật khẩu `1234`) + 7 đội đôi, chạy tự động nếu bảng `users` trống
- `seedMembers()` gọi `seedTeams()` để tạo đội sẵn
- **Quan trọng**: `initDatabase()` phải chạy TRƯỚC khi require route files vì các route mở DB connection ở module scope

### Startup Order (server.js)

1. `fs.mkdirSync('data/')` — tạo thư mục cho DB + session store
2. `initDatabase()` + `seedMembers()` — tạo schema + seed members + seed teams
3. `require('./routes/...')` — route files mở DB connection ngay khi require

### Routes

| File | Mount | Chức năng |
|------|-------|-----------|
| `routes/auth.js` | `/` | Login/logout, đổi mật khẩu, export `requireAuth` middleware |
| `routes/teams.js` | `/teams` | Danh sách đội (với avatar thành viên), tạo đội redirect admin |
| `routes/challenges.js` | `/challenges` | Tạo thách đấu (status `scheduled` ngay), người chơi gửi kết quả |
| `routes/api.js` | `/api` | JSON API: tìm user, notifications, kết quả theo ngày, tạo thách đấu, gửi/admin nhập kết quả |
| `routes/admin.js` | `/admin` | Quản trị: chốt kết quả, tạo đội, quản lý thành viên, nhật ký |
| `routes/logger.js` | — | Module `log(userId, action, detail, ip)` ghi activity_logs |

Các route mở DB connection riêng tại module scope: `new Database(path.join(__dirname, '..', 'data', 'club.db'))`.

### Admin

- Mặc định admin: `hung`, `dung`
- `requireAdmin` middleware kiểm tra `req.session.user.is_admin`
- **Tạo đội**: chỉ admin, chọn 2 thành viên → tên đội ghép tên cuối 2 người, **sắp xếp alpha** (VD: "Anh & Kiên" dù chọn Kiên trước). Dùng `localeCompare('vi')`. Không cho trùng tên.
- **Sửa tên đội**: `/admin/teams/:id/edit` — modal sửa tên (giống pattern sửa thành viên), validate không trùng tên đội khác, ghi log `admin_edit_team`.
- **Chốt kết quả**: admin xác nhận kết quả cuối cùng từ `/admin/challenges/:id/finalize`. Không thể chuyển sang `completed` qua dropdown — bắt buộc dùng form finalize để lưu winner_team_id.
- **Tạo thách đấu nhanh & cập nhật kết quả nhanh**: trang `/admin/challenges` có nút "+ Tạo thách đấu nhanh" (modal chọn 2 đội + ngày giờ + kèo, POST `/admin/challenges/create`) và nút "⚡ Cập nhật KQ" trên mỗi dòng (modal nhập tỉ số + đội thắng, dùng chung route finalize) — cho phép thao tác ngay tại danh sách, không cần vào trang chi tiết từng trận.
- **Xóa thách đấu**: `/admin/challenges/:id/delete` — chỉ xóa được thách đấu có status khác `completed` (chưa hoàn thành), xóa kèm `match_results` liên quan. Trận đã `completed` không xóa được vì đã tính vào quỹ/leaderboard. Ghi log `admin_delete_challenge`. Nút xóa hiện ở cả `/admin/challenges` (danh sách) và trang chi tiết trận.
- **Send thông báo Zalo**: nút "📤 Send" ở `/admin/challenges` gọi `POST /admin/challenges/send`, route này gọi server-side sang API trigger của project `bot-notification` (`BOT_NOTIFY_URL`, mặc định `http://bot-notification:3000/trigger?token=...`) để bắn tin kết quả hôm nay vào nhóm Zalo ngay lập tức thay vì đợi cron 8h sáng. Ghi log `admin_send_notification` (kèm response JSON từ bot). **Yêu cầu hạ tầng**: 2 container `pick-club` và `bot-notification` phải cùng nằm trên Docker network `pickclub-shared` (external network, tạo 1 lần bằng `docker network create pickclub-shared` trên server trước khi `docker compose up`) thì hostname `bot-notification` mới resolve được — xem README của `bot-notification`.
- **Xuất Excel**: nút "📊 Xuất Excel" ở `/admin` (dashboard) gọi `GET /admin/export`, sinh 1 file `.xlsx` (dùng `exceljs`) gồm 3 sheet: "Vận động viên" (danh sách `users`), "Đội" (danh sách `teams` kèm đội trưởng + thành viên), "Kết quả trận đấu" (toàn bộ `challenges`, sắp xếp ngày mới nhất trước, kèm tỉ số/đội thắng/trả thưởng lấy từ `match_results` nếu có — trận chưa hoàn thành thì các cột này để trống). Trả về trực tiếp qua `Content-Disposition: attachment`, không lưu file trên server. Ghi log `admin_export_excel`.
- **Quản lý thành viên**: thêm mới, sửa thông tin, upload avatar, cấp/gỡ admin, reset mật khẩu
- **Avatar mặc định**: nếu không upload, chọn ngẫu nhiên `default_1.svg` → `default_6.svg` trong `athletes/`
- **Nhật ký hoạt động**: `/admin/logs` — xem log login, thách đấu, kết quả, admin actions. Filter theo action, phân trang

### Challenge Workflow

Tạo thách đấu → `scheduled` (ngay lập tức, không cần accept) → người chơi gửi kết quả → admin nhận notification → admin chốt kết quả → `completed`

### Scoring (Quỹ bữa sáng)

- Mỗi trận hoàn thành: đội thắng mỗi người +1 điểm, đội thua mỗi người -1 điểm
- Tổng quỹ = tổng tất cả điểm dương
- `getLeaderboard(dbConn)` trong server.js query điểm per-person
- Bảng xếp hạng: `/leaderboard` — xếp hạng cá nhân, avatar, số trận, điểm +/-

### Activity Logging

- `routes/logger.js` export `log(userId, action, detail, ip)`
- Ghi vào bảng `activity_logs`: login, login_failed, logout, change_password, create_challenge, admin_create_challenge, submit_result, admin_finalize, admin_create_team, admin_edit_team, admin_delete_challenge, admin_send_notification, admin_export_excel, admin_toggle_admin, admin_reset_password
- Admin xem tại `/admin/logs` với filter và phân trang

### API Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | `/api/users/search?q=` | required | Tìm user theo tên/username |
| GET | `/api/notifications` | required | Thông báo chưa đọc của user hiện tại |
| POST | `/api/notifications/:id/read` | required | Đánh dấu đã đọc |
| GET | `/api/fund` | public | Tổng quỹ bữa sáng, tùy chọn lọc `?m=1-12&y=YYYY` |
| GET | `/api/results/today` | public | Các trận `completed` có `match_date = hôm nay` |
| GET | `/api/results?date=YYYY-MM-DD` | public | Tra cứu kết quả theo ngày (mặc định = hôm nay nếu không truyền `date`) |
| POST | `/api/challenges` | required | Tạo thách đấu mới (JSON: `challenger_team_id`, `challenged_team_id`, `match_date`, `match_time`, `reward`, `reward_detail`) — status `scheduled` ngay |
| POST | `/api/challenges/:id/result` | required | Người chơi gửi kết quả trận đấu (JSON: `scores`, `winner_team_id`) — chỉ ghi nhận, không chuyển `completed`, admin chốt sau |
| POST | `/api/admin/challenges/:id/result` | admin | Nhập/sửa kết quả trận đấu trực tiếp (JSON: `scores`, `winner_team_id`, `reward_paid`) — không cần đội chơi gửi trước, chốt thẳng `completed` |

**Auth cho API `required`/`admin`**: dùng session cookie (`connect.sid`) — đăng nhập qua `POST /login` (form `username`, `password`) trước, curl cần `-c cookies.txt` để lưu và `-b cookies.txt` để gửi lại cookie ở các request sau. Không có API token riêng.

**Tạo thách đấu — `POST /api/challenges`**
```bash
curl -c cookies.txt -X POST http://localhost:3000/login -d "username=hung&password=1234"

curl -b cookies.txt -X POST http://localhost:3000/api/challenges \
  -H "Content-Type: application/json" \
  -d '{"challenger_team_id":1,"challenged_team_id":2,"match_date":"2026-08-01","match_time":"06:00","reward":"Một bữa sáng"}'
# -> 201 { ok: true, challenge: { id, ..., status: "scheduled" } }
```
Lỗi: 400 thiếu trường / tự thách đấu chính đội mình, 404 đội không tồn tại, 401 chưa đăng nhập. `reward`, `reward_detail` tùy chọn (mặc định `"Một bữa sáng"`).

**Admin nhập kết quả trực tiếp — `POST /api/admin/challenges/:id/result`**
```bash
curl -b cookies.txt -X POST http://localhost:3000/api/admin/challenges/4/result \
  -H "Content-Type: application/json" \
  -d '{"scores":"11-7, 9-11, 11-8","winner_team_id":10,"reward_paid":false}'
# -> 200 { ok: true, challenge: { id, status: "completed", scores, winner_team_id } }
```
Lỗi: 400 thiếu `scores` / `winner_team_id` không thuộc trận đấu, 404 challenge không tồn tại, 401/403 nếu chưa đăng nhập hoặc không phải admin. `winner_team_id` bỏ trống = hòa. Ghi đè toàn bộ `match_results` cũ của trận, không cần đội chơi gửi kết quả trước.

**Lưu ý encoding trên Windows/Git Bash**: truyền chuỗi tiếng Việt qua `curl -d '...'` trong Git Bash có thể bị hỏng encoding tùy codepage terminal — nếu gặp dữ liệu tiếng Việt bị lỗi sau khi lưu, kiểm tra bằng cách gửi request qua Node `http` (UTF-8 mặc định) thay vì curl để loại trừ nguyên nhân do shell.

**Tra cứu kết quả theo ngày — `GET /api/results`**
```bash
curl http://localhost:3000/api/results?date=2026-08-01
# -> 200 { date: "2026-08-01", totalFund: 42, results: [...] }

curl http://localhost:3000/api/results
# -> 200 (mặc định = hôm nay)
```
Lỗi: 400 nếu `date` sai định dạng (phải `YYYY-MM-DD`). Không cần đăng nhập.

**Người chơi gửi kết quả — `POST /api/challenges/:id/result`**
```bash
curl -b cookies.txt -X POST http://localhost:3000/api/challenges/4/result \
  -H "Content-Type: application/json" \
  -d '{"scores":"11-7, 9-11, 11-8","winner_team_id":1}'
# -> 201 { ok: true, result: { challenge_id, reporter_team_id, scores, winner_team_id } }
```
Lỗi: 400 thiếu `scores` / `winner_team_id` không thuộc trận / trận không ở status `accepted`/`scheduled`, 403 user không thuộc đội nào trong trận, 404 challenge không tồn tại, 409 đội đã gửi kết quả rồi, 401 chưa đăng nhập. `winner_team_id` bỏ trống = hòa. Chỉ ghi nhận kết quả từ đội — admin chốt sau qua `/api/admin/challenges/:id/result`.

### Static Files

- `/avatars/*` → serve từ `athletes/` (ảnh thành viên + `default_1.svg` → `default_6.svg`)
- `/css/*`, `/js/*` → serve từ `public/`
- Session store: `data/sessions.db` (connect-sqlite3)

### Views

EJS templates, mỗi page include `partials/header.ejs` và `partials/footer.ejs`. Locals chuẩn: `title`, `user`, `flash`.

- Homepage: hero card (left-aligned, striped green), ticker chạy chữ "DIỄN BIẾN", info cards (4 cột), trận đấu gần đây (với đội thắng), thống kê nhanh
- Admin views trong `views/admin/`: `index`, `challenges`, `challenge-detail`, `members`, `teams`, `teams-create`, `logs`

### Flash Messages

Set qua `req.session.flash = { type, message }`, tự xóa sau khi render (middleware trong server.js).

### Docker

- `Dockerfile`: Node 20 Alpine, cài build tools cho better-sqlite3 native addon
- `docker-compose.yml`: port 3001:3000, bind mount `./data:/app/data` — data nằm ngay trong thư mục project trên host (`data/club.db`, `data/sessions.db`), không phải named volume
- `.dockerignore`: loại `node_modules`, `data`, `.claude`, `.git`
- Bind mount **không bị xóa** khi rebuild image — data an toàn khi deploy; backup/restore chỉ cần copy trực tiếp file `data/club.db` trên host, không cần `docker cp`

### Theme & CSS

- Light theme với CSS variables trong `public/css/style.css`: `--bg: #e8f5ee`, `--surface: #f6fdf9`, `--primary: #16a34a`
- Navbar: nền `#0f2318` (đen xanh), hero: gradient đen xanh
- Ticker "Diễn biến": tốc độ điều chỉnh qua `animation: tickerScroll Xs` tại dòng `.ticker-content` (tăng X = chậm hơn)
- Score trận đấu: format `winner_score-loser_score` (số đầu = đội thắng). Logic parse tại `views/index.ejs` và `views/leaderboard.ejs`
- Mobile responsive: `@media (max-width: 480px)` ẩn `.match-team-avatars`, thu nhỏ font tên đội để tên hiển thị đầy đủ

## Claude Code Tooling

- `.claude/agents/secure-reviewer.md` — read-only security review subagent (auth, `requireAdmin`, SQL injection, upload validation). Invoke for security-sensitive changes.
- `.claude/agents/test-engineer.md` — writes tests using Node's built-in `node:test` (no test framework installed yet).
- `.claude/skills/code-review-specialist/` — auto-invoked skill for general code review (security + performance + quality).
- `.claude/commands/optimize.md` — `/optimize` slash command for performance review.
- `.claude/hooks/format-code.sh` — PostToolUse hook, auto-formats written/edited files with `prettier`/`black`/etc. if installed on PATH (no-ops otherwise; project has no formatter configured yet).
