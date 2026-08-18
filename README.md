# pick-club — Dark Athletic Theme (Handoff)

Bản áp dụng redesign "dark athletic" vào code hiện tại của `pick-club`. Copy đè các file sau vào repo:

```
public/css/style.css          → thay toàn bộ (giữ nguyên mọi tên class)
public/js/app.js              → thay toàn bộ (giữ nguyên logic cũ + thêm 2 khối đầu file: Lucide init, count-up)
views/partials/header.ejs     → đổi font (Anton + Barlow Condensed + Barlow), thêm script Lucide, icon shield cho Admin
views/partials/footer.ejs     → bỏ emoji, dùng icon Lucide
views/index.ejs               → bỏ emoji, thêm data-countup cho số liệu, gọn hero
views/leaderboard.ejs         → huy chương 🥇🥈🥉 → số hạng 01/02/03, điểm +/-, data-countup
```

Các view khác (members, teams, challenges, admin, login…) **không cần sửa** — CSS mới tự áp qua tên class cũ.

## Điểm chính của theme
- Nền tối `#0b0f0d`, surface `#121a16`, kẻ line `#24312a` — góc vuông, viền thay bóng đổ
- Accent vàng volt `#d4f018` (CTA, hạng nhất, marquee), cam `#e67e22` (kèo ăn), xanh `#4ade80` (điểm dương)
- Font: Anton (số & display), Barlow Condensed (nhãn uppercase), Barlow (body) — Google Fonts
- Icon: Lucide qua CDN (`unpkg.com/lucide@0.462.0`), attribute `data-lucide="..."`, init trong app.js
- Count-up: thêm `data-countup="N"` vào phần tử số là tự chạy (IntersectionObserver, tôn trọng prefers-reduced-motion)
- Ảnh avatar grayscale mặc định, hover trả màu + viền accent

## Preview
Mở `preview/*.html` (home / leaderboard / members / teams) — trang tĩnh dùng đúng CSS + JS của gói này với dữ liệu mẫu, không cần chạy server.
"# pickclub" 
