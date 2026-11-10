const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { requireAuth } = require('./auth');

const db = new Database(path.join(__dirname, '..', 'data', 'club.db'));
db.pragma('foreign_keys = ON');
const { log } = require('./logger');

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'athletes');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const base = (req.body.username || Date.now().toString()).replace(/[^a-z0-9_]/gi, '');
    cb(null, base + ext);
  }
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file ảnh'));
  }
});

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.xlsx')) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file .xlsx'));
  }
});

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.is_admin) {
    req.session.flash = { type: 'error', message: 'Bạn không có quyền truy cập trang này' };
    return res.redirect('/');
  }
  next();
}

router.use(requireAuth);
router.use(requireAdmin);

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  return `${days[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function getOrCreateSinglesTeam(userId) {
  const existing = db.prepare(`
    SELECT t.id FROM teams t
    JOIN team_members tm ON tm.team_id = t.id
    WHERE t.is_singles = 1 AND tm.user_id = ? AND t.status = 'active'
    LIMIT 1
  `).get(userId);
  if (existing) return existing.id;

  const user = db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  const result = db.prepare(
    "INSERT INTO teams (name, type, captain_id, status, is_singles) VALUES (?, 'male', ?, 'active', 1)"
  ).run(user.full_name, userId);
  const teamId = result.lastInsertRowid;
  db.prepare("INSERT INTO team_members (team_id, user_id, status) VALUES (?, ?, 'accepted')").run(teamId, userId);
  return teamId;
}

// Dashboard
router.get('/', (req, res) => {
  const stats = {
    members: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    teams: db.prepare("SELECT COUNT(*) as c FROM teams WHERE status = 'active' AND is_singles = 0").get().c,
    totalChallenges: db.prepare('SELECT COUNT(*) as c FROM challenges').get().c,
    pending: db.prepare("SELECT COUNT(*) as c FROM challenges WHERE status = 'pending'").get().c,
    accepted: db.prepare("SELECT COUNT(*) as c FROM challenges WHERE status = 'accepted'").get().c,
    completed: db.prepare("SELECT COUNT(*) as c FROM challenges WHERE status = 'completed'").get().c,
    disputed: db.prepare("SELECT COUNT(*) as c FROM challenges WHERE status = 'disputed'").get().c,
  };

  const recentChallenges = db.prepare(`
    SELECT c.*, t1.name AS challenger_name, t2.name AS challenged_name
    FROM challenges c
    JOIN teams t1 ON t1.id = c.challenger_team_id
    JOIN teams t2 ON t2.id = c.challenged_team_id
    ORDER BY c.created_at DESC LIMIT 10
  `).all();
  recentChallenges.forEach(c => c.match_date_fmt = formatDate(c.match_date));

  res.render('admin/index', { stats, recentChallenges });
});

// Export members, teams and match results to a single Excel workbook
const TYPE_LABEL = { male: 'Nam', female: 'Nữ', mixed: 'Hỗn hợp' };
const STATUS_LABEL = {
  pending: 'Chờ duyệt', accepted: 'Đã nhận', declined: 'Từ chối',
  counter: 'Đề nghị đổi', scheduled: 'Đã lên lịch', completed: 'Hoàn thành', disputed: 'Tranh chấp'
};

router.get('/export', async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pick Club Admin';
  workbook.created = new Date();

  // Sheet 1: Vận động viên
  const membersSheet = workbook.addWorksheet('Vận động viên');
  membersSheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Họ và tên', key: 'full_name', width: 28 },
    { header: 'Username', key: 'username', width: 18 },
    { header: 'Quyền', key: 'role', width: 14 },
    { header: 'Ngày tham gia', key: 'created_at', width: 20 },
  ];
  membersSheet.getRow(1).font = { bold: true };
  db.prepare('SELECT id, full_name, username, is_admin, created_at FROM users ORDER BY full_name').all()
    .forEach(m => membersSheet.addRow({
      id: m.id, full_name: m.full_name, username: m.username,
      role: m.is_admin ? 'Admin' : 'Thành viên', created_at: m.created_at
    }));

  // Sheet 2: Đội
  const teamsSheet = workbook.addWorksheet('Đội');
  teamsSheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Tên đội', key: 'name', width: 24 },
    { header: 'Loại', key: 'type', width: 12 },
    { header: 'Đội trưởng', key: 'captain_name', width: 22 },
    { header: 'Thành viên', key: 'member_names', width: 34 },
    { header: 'Trạng thái', key: 'status', width: 14 },
    { header: 'Ngày tạo', key: 'created_at', width: 20 },
  ];
  teamsSheet.getRow(1).font = { bold: true };
  db.prepare(`
    SELECT t.*, u.full_name AS captain_name,
      GROUP_CONCAT(u2.full_name, ', ') AS member_names
    FROM teams t
    JOIN users u ON u.id = t.captain_id
    LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'accepted'
    LEFT JOIN users u2 ON u2.id = tm.user_id
    WHERE t.is_singles = 0
    GROUP BY t.id
    ORDER BY t.name
  `).all().forEach(t => teamsSheet.addRow({
    id: t.id, name: t.name, type: TYPE_LABEL[t.type] || t.type,
    captain_name: t.captain_name, member_names: t.member_names,
    status: t.status, created_at: t.created_at
  }));

  // Sheet 3: Kết quả trận đấu
  const challengesSheet = workbook.addWorksheet('Kết quả trận đấu');
  challengesSheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Đội thách đấu', key: 'challenger_name', width: 22 },
    { header: 'Đội bị thách đấu', key: 'challenged_name', width: 22 },
    { header: 'Ngày', key: 'match_date', width: 14 },
    { header: 'Giờ', key: 'match_time', width: 10 },
    { header: 'Kèo', key: 'reward', width: 20 },
    { header: 'Trạng thái', key: 'status', width: 14 },
    { header: 'Tỉ số', key: 'scores', width: 20 },
    { header: 'Đội thắng', key: 'winner_name', width: 22 },
    { header: 'Đã trả thưởng', key: 'reward_paid', width: 14 },
  ];
  challengesSheet.getRow(1).font = { bold: true };
  const challenges = db.prepare(`
    SELECT c.*, t1.name AS challenger_name, t2.name AS challenged_name
    FROM challenges c
    JOIN teams t1 ON t1.id = c.challenger_team_id
    JOIN teams t2 ON t2.id = c.challenged_team_id
    ORDER BY c.match_date DESC, c.match_time DESC
  `).all();
  for (const c of challenges) {
    const result = db.prepare('SELECT scores, winner_team_id, reward_paid FROM match_results WHERE challenge_id = ? LIMIT 1').get(c.id);
    const winnerName = result
      ? (result.winner_team_id
          ? (result.winner_team_id === c.challenger_team_id ? c.challenger_name : c.challenged_name)
          : 'Hòa')
      : '';
    challengesSheet.addRow({
      id: c.id, challenger_name: c.challenger_name, challenged_name: c.challenged_name,
      match_date: c.match_date, match_time: c.match_time, reward: c.reward,
      status: STATUS_LABEL[c.status] || c.status,
      scores: result ? result.scores : '',
      winner_name: winnerName,
      reward_paid: result ? (result.reward_paid ? 'Có' : 'Chưa') : ''
    });
  }

  log(req.session.user.id, 'admin_export_excel', `${membersSheet.rowCount - 1} thành viên, ${teamsSheet.rowCount - 1} đội, ${challengesSheet.rowCount - 1} trận`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);

  const filename = `pickclub-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});

// Import match results from Excel
router.get('/import', (req, res) => {
  res.render('admin/import');
});

router.post('/import', uploadExcel.single('file'), async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  if (!req.file) {
    req.session.flash = { type: 'error', message: 'Vui lòng chọn file .xlsx' };
    return res.redirect('/admin/import');
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const sheet = workbook.getWorksheet('Kết quả trận đấu');
    if (!sheet) {
      req.session.flash = { type: 'error', message: 'Không tìm thấy sheet "Kết quả trận đấu" trong file' };
      return res.redirect('/admin/import');
    }

    let updated = 0, skipped = 0;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const id = row.getCell(1).value;
      const scores = row.getCell(8).value;
      const winnerName = row.getCell(9).value;
      const rewardPaid = row.getCell(10).value;

      if (!id || !scores || !String(scores).trim()) {
        skipped++;
        return;
      }

      const challenge = db.prepare(`
        SELECT c.*, t1.name AS challenger_name, t2.name AS challenged_name
        FROM challenges c
        JOIN teams t1 ON t1.id = c.challenger_team_id
        JOIN teams t2 ON t2.id = c.challenged_team_id
        WHERE c.id = ?
      `).get(id);

      if (!challenge) {
        skipped++;
        return;
      }

      let winnerId = null;
      if (winnerName && String(winnerName).trim()) {
        const wn = String(winnerName).trim();
        if (wn === challenge.challenger_name) winnerId = challenge.challenger_team_id;
        else if (wn === challenge.challenged_name) winnerId = challenge.challenged_team_id;
      }

      const rewardPaidVal = (rewardPaid === 'Có' || rewardPaid === 1) ? 1 : 0;

      db.prepare('DELETE FROM match_results WHERE challenge_id = ?').run(id);
      db.prepare(`
        INSERT INTO match_results (challenge_id, reporter_team_id, scores, winner_team_id, reward_paid)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, challenge.challenger_team_id, String(scores).trim(), winnerId, rewardPaidVal);
      db.prepare("UPDATE challenges SET status = 'completed' WHERE id = ?").run(id);

      updated++;
    });

    log(req.session.user.id, 'admin_import_excel', `Cập nhật ${updated} trận, bỏ qua ${skipped} dòng`, ip);
    req.session.flash = { type: 'success', message: `Import thành công: ${updated} trận cập nhật, ${skipped} dòng bỏ qua` };
  } catch (err) {
    req.session.flash = { type: 'error', message: `Lỗi đọc file Excel: ${err.message}` };
  }

  res.redirect('/admin');
});

// Trigger the daily Zalo notification bot
const BOT_NOTIFY_URL = process.env.BOT_NOTIFY_URL;

router.post('/challenges/send', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  if (!BOT_NOTIFY_URL) {
    req.session.flash = { type: 'error', message: 'Chưa cấu hình BOT_NOTIFY_URL trên server' };
    return res.redirect('/admin/challenges');
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(BOT_NOTIFY_URL, { method: 'POST', signal: controller.signal });
    clearTimeout(timeout);
    const result = await response.json().catch(() => ({}));

    if (response.ok && result.sent) {
      req.session.flash = { type: 'success', message: 'Đã gửi thông báo vào nhóm Zalo!' };
    } else if (response.ok) {
      req.session.flash = { type: 'error', message: `Không gửi: ${result.reason || 'không rõ lý do'}` };
    } else {
      req.session.flash = { type: 'error', message: `Gửi thất bại (HTTP ${response.status})` };
    }
    log(req.session.user.id, 'admin_send_notification', JSON.stringify(result), ip);
  } catch (err) {
    req.session.flash = { type: 'error', message: `Lỗi gọi bot-notification: ${err.message}` };
    log(req.session.user.id, 'admin_send_notification', `error: ${err.message}`, ip);
  }
  res.redirect('/admin/challenges');
});

// All challenges management
router.get('/challenges', (req, res) => {
  const filter = req.query.status || 'all';
  let whereClause = '';
  if (filter !== 'all') whereClause = `WHERE c.status = '${filter}'`;

  const challenges = db.prepare(`
    SELECT c.*,
      t1.name AS challenger_name, t2.name AS challenged_name,
      GROUP_CONCAT(DISTINCT u1.full_name) AS challenger_members,
      GROUP_CONCAT(DISTINCT u2.full_name) AS challenged_members
    FROM challenges c
    JOIN teams t1 ON t1.id = c.challenger_team_id
    JOIN teams t2 ON t2.id = c.challenged_team_id
    LEFT JOIN team_members tm1 ON tm1.team_id = t1.id AND tm1.status = 'accepted'
    LEFT JOIN users u1 ON u1.id = tm1.user_id
    LEFT JOIN team_members tm2 ON tm2.team_id = t2.id AND tm2.status = 'accepted'
    LEFT JOIN users u2 ON u2.id = tm2.user_id
    ${whereClause}
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();

  challenges.forEach(c => c.match_date_fmt = formatDate(c.match_date));

  const results = {};
  for (const c of challenges) {
    results[c.id] = db.prepare(`
      SELECT mr.*, t.name AS team_name
      FROM match_results mr JOIN teams t ON t.id = mr.reporter_team_id
      WHERE mr.challenge_id = ?
    `).all(c.id);
  }

  const teams = db.prepare(`
    SELECT t.id, t.name,
      GROUP_CONCAT(u.full_name, ', ') as member_names
    FROM teams t
    JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'accepted'
    JOIN users u ON u.id = tm.user_id
    WHERE t.status = 'active' AND t.is_singles = 0
    GROUP BY t.id
    ORDER BY t.name
  `).all();

  const users = db.prepare('SELECT id, full_name, avatar FROM users ORDER BY full_name').all();

  res.render('admin/challenges', { challenges, results, filter, teams, users });
});

// Quick-create challenge from admin challenges list
router.post('/challenges/create', (req, res) => {
  const { challenger_team_id, challenged_team_id, match_date, match_time, reward, reward_detail, challenge_type, challenger_user_id, challenged_user_id } = req.body;

  if (!match_date || !match_time) {
    req.session.flash = { type: 'error', message: 'Vui lòng điền đầy đủ thông tin' };
    return res.redirect('/admin/challenges');
  }

  let challengerTeamId, challengedTeamId;

  if (challenge_type === 'singles') {
    if (!challenger_user_id || !challenged_user_id) {
      req.session.flash = { type: 'error', message: 'Vui lòng chọn 2 người chơi' };
      return res.redirect('/admin/challenges');
    }
    if (challenger_user_id === challenged_user_id) {
      req.session.flash = { type: 'error', message: 'Không thể thách đấu chính mình' };
      return res.redirect('/admin/challenges');
    }
    challengerTeamId = getOrCreateSinglesTeam(Number(challenger_user_id));
    challengedTeamId = getOrCreateSinglesTeam(Number(challenged_user_id));
    if (!challengerTeamId || !challengedTeamId) {
      req.session.flash = { type: 'error', message: 'Người chơi không tồn tại' };
      return res.redirect('/admin/challenges');
    }
  } else {
    if (!challenger_team_id || !challenged_team_id) {
      req.session.flash = { type: 'error', message: 'Vui lòng điền đầy đủ thông tin' };
      return res.redirect('/admin/challenges');
    }
    if (challenger_team_id === challenged_team_id) {
      req.session.flash = { type: 'error', message: 'Không thể thách đấu chính đội mình' };
      return res.redirect('/admin/challenges');
    }
    challengerTeamId = challenger_team_id;
    challengedTeamId = challenged_team_id;
  }

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(challengerTeamId);
  const opponent = db.prepare('SELECT * FROM teams WHERE id = ?').get(challengedTeamId);
  if (!team || !opponent) {
    req.session.flash = { type: 'error', message: challenge_type === 'singles' ? 'Người chơi không tồn tại' : 'Đội không tồn tại' };
    return res.redirect('/admin/challenges');
  }

  const result = db.prepare(`
    INSERT INTO challenges (challenger_team_id, challenged_team_id, match_date, match_time, reward, reward_detail, status, challenge_type)
    VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)
  `).run(challengerTeamId, challengedTeamId, match_date, match_time, reward || 'Bữa sáng', reward_detail || null, challenge_type || 'doubles');

  [team.captain_id, opponent.captain_id].forEach(captainId => {
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
      captainId, 'challenge',
      `Trận đấu "${team.name}" vs "${opponent.name}" đã lên lịch vào ${formatDate(match_date)} lúc ${match_time}`,
      `/challenges/${result.lastInsertRowid}`
    );
  });

  log(req.session.user.id, 'admin_create_challenge', `${team.name} vs ${opponent.name} · ${match_date} ${match_time} · ${reward || 'Bữa sáng'} · ${challenge_type || 'doubles'}`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  req.session.flash = { type: 'success', message: 'Đã tạo thách đấu!' };
  res.redirect('/admin/challenges');
});

// Challenge detail for admin
router.get('/challenges/:id', (req, res) => {
  const challenge = db.prepare(`
    SELECT c.*,
      t1.name AS challenger_name, t1.id AS challenger_tid,
      t2.name AS challenged_name, t2.id AS challenged_tid
    FROM challenges c
    JOIN teams t1 ON t1.id = c.challenger_team_id
    JOIN teams t2 ON t2.id = c.challenged_team_id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!challenge) {
    req.session.flash = { type: 'error', message: 'Thách đấu không tồn tại' };
    return res.redirect('/admin/challenges');
  }

  challenge.match_date_fmt = formatDate(challenge.match_date);

  const results = db.prepare(`
    SELECT mr.*, t.name AS team_name
    FROM match_results mr JOIN teams t ON t.id = mr.reporter_team_id
    WHERE mr.challenge_id = ?
  `).all(challenge.id);

  const challengerMembers = db.prepare(`
    SELECT u.full_name, u.avatar FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ? AND tm.status = 'accepted'
  `).all(challenge.challenger_team_id);

  const challengedMembers = db.prepare(`
    SELECT u.full_name, u.avatar FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ? AND tm.status = 'accepted'
  `).all(challenge.challenged_team_id);

  res.render('admin/challenge-detail', {
    challenge, results, challengerMembers, challengedMembers
  });
});

// Admin finalize result
router.post('/challenges/:id/finalize', (req, res) => {
  const { scores, winner_team_id, reward_paid } = req.body;
  const challengeId = req.params.id;

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
  if (!challenge) {
    req.session.flash = { type: 'error', message: 'Thách đấu không tồn tại' };
    return res.redirect('/admin/challenges');
  }

  db.prepare('UPDATE challenges SET status = ? WHERE id = ?').run('completed', challengeId);

  db.prepare('DELETE FROM match_results WHERE challenge_id = ?').run(challengeId);
  db.prepare(`
    INSERT INTO match_results (challenge_id, reporter_team_id, scores, winner_team_id, reward_paid)
    VALUES (?, ?, ?, ?, ?)
  `).run(challengeId, challenge.challenger_team_id, scores, winner_team_id || null, reward_paid ? 1 : 0);

  const t1 = db.prepare('SELECT captain_id, name FROM teams WHERE id = ?').get(challenge.challenger_team_id);
  const t2 = db.prepare('SELECT captain_id, name FROM teams WHERE id = ?').get(challenge.challenged_team_id);
  const winnerName = winner_team_id
    ? db.prepare('SELECT name FROM teams WHERE id = ?').get(winner_team_id)?.name
    : 'Hòa';

  [t1.captain_id, t2.captain_id].forEach(captainId => {
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
      captainId, 'result_finalized',
      `Admin đã chốt kết quả: ${t1.name} vs ${t2.name}. Kết quả: ${scores}. ${winner_team_id ? 'Đội thắng: ' + winnerName : 'Hòa'}`,
      `/challenges/${challengeId}`
    );
  });

  log(req.session.user.id, 'admin_finalize', `Trận #${challengeId} · ${scores} · Thắng: ${winnerName}`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  req.session.flash = { type: 'success', message: 'Đã chốt kết quả trận đấu!' };
  res.redirect('/admin/challenges');
});

// Update challenge status
// Reschedule match
router.post('/challenges/:id/reschedule', (req, res) => {
  const { match_date, match_time } = req.body;
  if (!match_date || !match_time) {
    req.session.flash = { type: 'error', message: 'Vui lòng nhập đầy đủ ngày và giờ' };
    return res.redirect(`/admin/challenges/${req.params.id}`);
  }
  db.prepare('UPDATE challenges SET match_date = ?, match_time = ? WHERE id = ?').run(match_date, match_time, req.params.id);
  log(req.session.user.id, 'admin_reschedule', `Trận #${req.params.id} → ${match_date} ${match_time}`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  req.session.flash = { type: 'success', message: 'Đã cập nhật thời gian trận đấu!' };
  res.redirect(`/admin/challenges/${req.params.id}`);
});

router.post('/challenges/:id/status', (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'accepted', 'declined', 'scheduled', 'completed', 'disputed'];
  if (!allowed.includes(status)) {
    req.session.flash = { type: 'error', message: 'Trạng thái không hợp lệ' };
    return res.redirect('/admin/challenges');
  }
  db.prepare('UPDATE challenges SET status = ? WHERE id = ?').run(status, req.params.id);
  req.session.flash = { type: 'success', message: 'Đã cập nhật trạng thái!' };
  res.redirect(`/admin/challenges/${req.params.id}`);
});

// Delete a scheduled challenge that hasn't been completed yet
router.post('/challenges/:id/delete', (req, res) => {
  const challengeId = req.params.id;
  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
  if (!challenge) {
    req.session.flash = { type: 'error', message: 'Thách đấu không tồn tại' };
    return res.redirect('/admin/challenges');
  }
  if (challenge.status === 'completed') {
    req.session.flash = { type: 'error', message: 'Không thể xóa thách đấu đã hoàn thành' };
    return res.redirect('/admin/challenges');
  }

  db.prepare('DELETE FROM match_results WHERE challenge_id = ?').run(challengeId);
  db.prepare('DELETE FROM challenges WHERE id = ?').run(challengeId);

  log(req.session.user.id, 'admin_delete_challenge', `Trận #${challengeId} · ${challenge.status}`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  req.session.flash = { type: 'success', message: 'Đã xóa thách đấu' };
  res.redirect('/admin/challenges');
});

// Members management
router.get('/members', (req, res) => {
  const members = db.prepare('SELECT * FROM users ORDER BY full_name').all();
  res.render('admin/members', { members });
});

function randomDefaultAvatar() {
  return `default_${Math.floor(Math.random() * 6) + 1}.svg`;
}

// Add member
router.post('/members/create', uploadAvatar.single('avatar'), (req, res) => {
  const { username, full_name, password, is_admin } = req.body;
  if (!username || !full_name) {
    req.session.flash = { type: 'error', message: 'Vui lòng nhập tên và username' };
    return res.redirect('/admin/members');
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) {
    req.session.flash = { type: 'error', message: `Username "${username}" đã tồn tại` };
    return res.redirect('/admin/members');
  }
  const avatarName = req.file ? req.file.filename : randomDefaultAvatar();
  db.prepare('INSERT INTO users (username, password, full_name, avatar, is_admin) VALUES (?, ?, ?, ?, ?)')
    .run(username.trim(), password || '1234', full_name.trim(), avatarName, is_admin ? 1 : 0);
  log(req.session.user.id, 'admin_create_member', `${username} - ${full_name}`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  req.session.flash = { type: 'success', message: `Đã thêm thành viên "${full_name}"` };
  res.redirect('/admin/members');
});

// Edit member
router.post('/members/:id/edit', uploadAvatar.single('avatar'), (req, res) => {
  const { full_name, username, password, is_admin } = req.body;
  const userId = req.params.id;
  if (!full_name || !username) {
    req.session.flash = { type: 'error', message: 'Vui lòng nhập tên và username' };
    return res.redirect('/admin/members');
  }
  const conflict = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), userId);
  if (conflict) {
    req.session.flash = { type: 'error', message: `Username "${username}" đã được dùng bởi người khác` };
    return res.redirect('/admin/members');
  }
  const updates = { full_name: full_name.trim(), username: username.trim(), is_admin: is_admin ? 1 : 0 };
  if (req.file) updates.avatar = req.file.filename;
  if (password && password.trim()) updates.password = password.trim();

  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${fields} WHERE id = ?`).run(...Object.values(updates), userId);
  log(req.session.user.id, 'admin_edit_member', `user_id=${userId} → ${username}`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  req.session.flash = { type: 'success', message: `Đã cập nhật thông tin "${full_name}"` };
  res.redirect('/admin/members');
});

// Upload/update avatar for existing member
router.post('/members/:id/avatar', uploadAvatar.single('avatar'), (req, res) => {
  if (!req.file) {
    req.session.flash = { type: 'error', message: 'Vui lòng chọn file ảnh' };
    return res.redirect('/admin/members');
  }
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(req.file.filename, req.params.id);
  log(req.session.user.id, 'admin_update_avatar', `user_id=${req.params.id} → ${req.file.filename}`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  req.session.flash = { type: 'success', message: 'Đã cập nhật ảnh đại diện' };
  res.redirect('/admin/members');
});

// Toggle admin
router.post('/members/:id/toggle-admin', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (user) {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(user.is_admin ? 0 : 1, user.id);
    log(req.session.user.id, 'admin_toggle_admin', `${user.username} → ${user.is_admin ? 'gỡ' : 'cấp'} admin`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  }
  res.redirect('/admin/members');
});

// Reset password
router.post('/members/:id/reset-password', (req, res) => {
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run('1234', req.params.id);
  log(req.session.user.id, 'admin_reset_password', target ? target.username : req.params.id, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  req.session.flash = { type: 'success', message: 'Đã reset mật khẩu về 1234' };
  res.redirect('/admin/members');
});

// Teams management
router.get('/teams', (req, res) => {
  const teams = db.prepare(`
    SELECT t.*, u.full_name AS captain_name,
      GROUP_CONCAT(u2.full_name, ', ') AS member_names
    FROM teams t
    JOIN users u ON u.id = t.captain_id
    LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'accepted'
    LEFT JOIN users u2 ON u2.id = tm.user_id
    WHERE t.is_singles = 0
    GROUP BY t.id
    ORDER BY t.name
  `).all();
  res.render('admin/teams', { teams });
});

// Create team form
router.get('/teams/create', (req, res) => {
  const members = db.prepare('SELECT id, username, full_name, avatar FROM users ORDER BY full_name').all();
  res.render('admin/teams-create', { members });
});

// Create team
router.post('/teams/create', (req, res) => {
  const { member1, member2, type } = req.body;

  if (!member1 || !member2 || !type) {
    req.session.flash = { type: 'error', message: 'Vui lòng chọn đầy đủ 2 thành viên và loại đội' };
    return res.redirect('/admin/teams/create');
  }

  if (member1 === member2) {
    req.session.flash = { type: 'error', message: 'Không thể chọn 2 thành viên giống nhau' };
    return res.redirect('/admin/teams/create');
  }

  const u1 = db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(member1);
  const u2 = db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(member2);
  if (!u1 || !u2) {
    req.session.flash = { type: 'error', message: 'Thành viên không tồn tại' };
    return res.redirect('/admin/teams/create');
  }

  const firstName = n => n.split(' ').pop();
  const teamName = [firstName(u1.full_name), firstName(u2.full_name)].sort((a, b) => a.localeCompare(b, 'vi')).join(' & ');

  const existing = db.prepare('SELECT id FROM teams WHERE name = ?').get(teamName);
  if (existing) {
    req.session.flash = { type: 'error', message: `Đội "${teamName}" đã tồn tại` };
    return res.redirect('/admin/teams/create');
  }

  const result = db.prepare('INSERT INTO teams (name, type, captain_id, status) VALUES (?, ?, ?, ?)').run(teamName, type, u1.id, 'active');
  const teamId = result.lastInsertRowid;
  db.prepare('INSERT INTO team_members (team_id, user_id, status) VALUES (?, ?, ?)').run(teamId, u1.id, 'accepted');
  db.prepare('INSERT INTO team_members (team_id, user_id, status) VALUES (?, ?, ?)').run(teamId, u2.id, 'accepted');

  log(req.session.user.id, 'admin_create_team', `${teamName} (${type})`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  req.session.flash = { type: 'success', message: `Đã tạo đội "${teamName}"` };
  res.redirect('/admin/teams');
});

// Edit team name
router.post('/teams/:id/edit', (req, res) => {
  const { name } = req.body;
  const teamId = req.params.id;

  if (!name || !name.trim()) {
    req.session.flash = { type: 'error', message: 'Vui lòng nhập tên đội' };
    return res.redirect('/admin/teams');
  }

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    req.session.flash = { type: 'error', message: 'Đội không tồn tại' };
    return res.redirect('/admin/teams');
  }

  const newName = name.trim();
  const existing = db.prepare('SELECT id FROM teams WHERE name = ? AND id != ?').get(newName, teamId);
  if (existing) {
    req.session.flash = { type: 'error', message: `Đội "${newName}" đã tồn tại` };
    return res.redirect('/admin/teams');
  }

  db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(newName, teamId);
  log(req.session.user.id, 'admin_edit_team', `${team.name} → ${newName}`, req.headers['x-forwarded-for'] || req.connection.remoteAddress);
  req.session.flash = { type: 'success', message: `Đã đổi tên đội thành "${newName}"` };
  res.redirect('/admin/teams');
});

// Delete team
router.post('/teams/:id/delete', (req, res) => {
  const teamId = req.params.id;
  db.prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  req.session.flash = { type: 'success', message: 'Đã xóa đội' };
  res.redirect('/admin/teams');
});

// Activity logs
router.get('/logs', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const filter = req.query.action || '';

  let whereClause = '';
  const params = [];
  if (filter) {
    whereClause = 'WHERE l.action = ?';
    params.push(filter);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM activity_logs l ${whereClause}`).get(...params).c;
  const logs = db.prepare(`
    SELECT l.*, COALESCE(u.full_name, 'Khách') as user_name, u.username, u.avatar
    FROM activity_logs l
    LEFT JOIN users u ON u.id = l.user_id
    ${whereClause}
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const actions = db.prepare('SELECT DISTINCT action FROM activity_logs ORDER BY action').all().map(r => r.action);
  const totalPages = Math.ceil(total / limit);

  res.render('admin/logs', { logs, actions, filter, page, totalPages, total });
});

module.exports = router;
