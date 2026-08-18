const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');
const { log } = require('./logger');

const db = new Database(path.join(__dirname, '..', 'data', 'club.db'));
db.pragma('foreign_keys = ON');

function requireAdminApi(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.session.user.is_admin) return res.status(403).json({ error: 'Forbidden' });
  next();
}

function requireAuthApi(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  return `${days[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

// Search users
router.get('/users/search', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  const q = req.query.q || '';
  if (q.length < 1) return res.json([]);

  const users = db.prepare(`
    SELECT id, username, full_name, avatar FROM users
    WHERE username LIKE ? OR full_name LIKE ?
    LIMIT 10
  `).all(`%${q}%`, `%${q}%`);

  res.json(users);
});

// Get unread notifications
router.get('/notifications', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  const notifications = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? AND is_read = 0
    ORDER BY created_at DESC
  `).all(req.session.user.id);

  res.json(notifications);
});

// Get fund stats — optional ?m=1-12 &y=YYYY to filter by month/year
router.get('/fund', (req, res) => {
  const mRaw = parseInt(req.query.m);
  const yRaw = parseInt(req.query.y);
  const m = (mRaw >= 1 && mRaw <= 12) ? mRaw : null;
  const y = (yRaw >= 2020 && yRaw <= 2099) ? yRaw : null;

  let dateFilter = '';
  if (m && y) dateFilter = `AND strftime('%Y-%m', c.match_date) = '${y}-${String(m).padStart(2,'0')}'`;
  else if (y)  dateFilter = `AND strftime('%Y', c.match_date) = '${y}'`;
  else if (m)  dateFilter = `AND strftime('%m', c.match_date) = '${String(m).padStart(2,'0')}'`;

  const row = db.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN mr.winner_team_id IS NOT NULL AND mr.winner_team_id != tm.team_id THEN 1 ELSE 0 END
    ), 0) AS totalFund,
    COUNT(DISTINCT c.id) AS completedMatches
    FROM team_members tm
    JOIN challenges c ON (c.challenger_team_id = tm.team_id OR c.challenged_team_id = tm.team_id)
      AND c.status = 'completed' ${dateFilter}
    JOIN match_results mr ON mr.challenge_id = c.id
    WHERE tm.status = 'accepted'
  `).get();

  const now = new Date();
  res.json({
    filter: { month: m || null, year: y || null },
    totalFund: row.totalFund,
    completedMatches: row.completedMatches
  });
});

// Get today's results
router.get('/results/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const results = db.prepare(`
    SELECT c.id, c.match_date, c.match_time, c.reward,
      t1.name AS challenger_name,
      t2.name AS challenged_name,
      tw.name AS winner_name,
      mr.scores
    FROM challenges c
    JOIN teams t1 ON c.challenger_team_id = t1.id
    JOIN teams t2 ON c.challenged_team_id = t2.id
    LEFT JOIN match_results mr ON mr.challenge_id = c.id
    LEFT JOIN teams tw ON tw.id = mr.winner_team_id
    WHERE c.status = 'completed' AND c.match_date = ?
    ORDER BY c.match_time
  `).all(today);

  const fund = db.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN mr.winner_team_id IS NOT NULL AND mr.winner_team_id != tm.team_id THEN 1 ELSE 0 END
    ), 0) AS totalFund
    FROM team_members tm
    JOIN challenges c ON (c.challenger_team_id = tm.team_id OR c.challenged_team_id = tm.team_id)
      AND c.status = 'completed'
    JOIN match_results mr ON mr.challenge_id = c.id
    WHERE tm.status = 'accepted'
  `).get();

  res.json({ date: today, totalFund: fund.totalFund, results });
});

// Tạo thách đấu mới
router.post('/challenges', requireAuthApi, (req, res) => {
  const { challenger_team_id, challenged_team_id, match_date, match_time, reward, reward_detail } = req.body;

  if (!challenger_team_id || !challenged_team_id || !match_date || !match_time) {
    return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
  }

  if (String(challenger_team_id) === String(challenged_team_id)) {
    return res.status(400).json({ error: 'Không thể thách đấu chính đội mình' });
  }

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(challenger_team_id);
  const opponent = db.prepare('SELECT * FROM teams WHERE id = ?').get(challenged_team_id);
  if (!team || !opponent) {
    return res.status(404).json({ error: 'Đội không tồn tại' });
  }

  const result = db.prepare(`
    INSERT INTO challenges (challenger_team_id, challenged_team_id, match_date, match_time, reward, reward_detail, status)
    VALUES (?, ?, ?, ?, ?, ?, 'scheduled')
  `).run(challenger_team_id, challenged_team_id, match_date, match_time, reward || 'Một bữa sáng', reward_detail || null);

  [team.captain_id, opponent.captain_id].forEach(captainId => {
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
      captainId, 'challenge',
      `Trận đấu "${team.name}" vs "${opponent.name}" đã lên lịch vào ${formatDate(match_date)} lúc ${match_time}`,
      `/challenges/${result.lastInsertRowid}`
    );
  });

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  log(req.session.user.id, 'create_challenge', `${team.name} vs ${opponent.name} · ${match_date} ${match_time} · ${reward || 'Một bữa sáng'}`, ip);

  res.status(201).json({
    ok: true,
    challenge: {
      id: result.lastInsertRowid,
      challenger_team_id: Number(challenger_team_id),
      challenged_team_id: Number(challenged_team_id),
      match_date, match_time,
      reward: reward || 'Một bữa sáng',
      reward_detail: reward_detail || null,
      status: 'scheduled'
    }
  });
});

// Admin: nhập/sửa kết quả trận đấu trực tiếp (không cần đội chơi gửi trước)
router.post('/admin/challenges/:id/result', requireAdminApi, (req, res) => {
  const challengeId = req.params.id;
  const { scores, winner_team_id, reward_paid } = req.body;

  if (!scores || !String(scores).trim()) {
    return res.status(400).json({ error: 'Thiếu tỉ số trận đấu' });
  }

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
  if (!challenge) {
    return res.status(404).json({ error: 'Thách đấu không tồn tại' });
  }

  let winnerId = null;
  if (winner_team_id !== undefined && winner_team_id !== null && winner_team_id !== '') {
    winnerId = Number(winner_team_id);
    if (![challenge.challenger_team_id, challenge.challenged_team_id].includes(winnerId)) {
      return res.status(400).json({ error: 'Đội thắng không thuộc trận đấu này' });
    }
  }

  db.prepare('UPDATE challenges SET status = ? WHERE id = ?').run('completed', challengeId);

  db.prepare('DELETE FROM match_results WHERE challenge_id = ?').run(challengeId);
  db.prepare(`
    INSERT INTO match_results (challenge_id, reporter_team_id, scores, winner_team_id, reward_paid)
    VALUES (?, ?, ?, ?, ?)
  `).run(challengeId, challenge.challenger_team_id, scores, winnerId, reward_paid ? 1 : 0);

  const t1 = db.prepare('SELECT captain_id, name FROM teams WHERE id = ?').get(challenge.challenger_team_id);
  const t2 = db.prepare('SELECT captain_id, name FROM teams WHERE id = ?').get(challenge.challenged_team_id);
  const winnerName = winnerId
    ? db.prepare('SELECT name FROM teams WHERE id = ?').get(winnerId)?.name
    : 'Hòa';

  [t1.captain_id, t2.captain_id].forEach(captainId => {
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
      captainId, 'result_finalized',
      `Admin đã chốt kết quả: ${t1.name} vs ${t2.name}. Kết quả: ${scores}. ${winnerId ? 'Đội thắng: ' + winnerName : 'Hòa'}`,
      `/challenges/${challengeId}`
    );
  });

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  log(req.session.user.id, 'admin_finalize', `Trận #${challengeId} · ${scores} · Thắng: ${winnerName}`, ip);

  res.json({
    ok: true,
    challenge: { id: Number(challengeId), status: 'completed', scores, winner_team_id: winnerId }
  });
});

// Mark notification as read
router.post('/notifications/:id/read', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.user.id);

  res.json({ ok: true });
});

module.exports = router;
