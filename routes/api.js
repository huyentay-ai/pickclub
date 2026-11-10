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

// Search teams
router.get('/teams/search', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  const q = req.query.q || '';
  if (q.length < 1) return res.json([]);

  const teams = db.prepare(`
    SELECT t.id, t.name,
      GROUP_CONCAT(u.full_name, ', ') as member_names
    FROM teams t
    JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'accepted'
    JOIN users u ON u.id = tm.user_id
    WHERE t.status = 'active' AND t.is_singles = 0
      AND (t.name LIKE ? OR u.full_name LIKE ?)
    GROUP BY t.id
    ORDER BY t.name
    LIMIT 10
  `).all(`%${q}%`, `%${q}%`);

  res.json(teams);
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

// Get results by date — default today
router.get('/results', (req, res) => {
  const dateParam = req.query.date || new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return res.status(400).json({ error: 'Ngày không hợp lệ. Dùng định dạng YYYY-MM-DD' });
  }

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
  `).all(dateParam);

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

  res.json({ date: dateParam, totalFund: fund.totalFund, results });
});

// Team member submits match result
router.post('/challenges/:id/result', requireAuthApi, (req, res) => {
  const challengeId = req.params.id;
  const { scores, winner_team_id } = req.body;
  const userId = req.session.user.id;

  if (!scores || !String(scores).trim()) {
    return res.status(400).json({ error: 'Thiếu tỉ số trận đấu' });
  }

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
  if (!challenge) {
    return res.status(404).json({ error: 'Thách đấu không tồn tại' });
  }
  if (!['accepted', 'scheduled'].includes(challenge.status)) {
    return res.status(400).json({ error: 'Không thể gửi kết quả cho trận đấu này' });
  }

  const userTeam = db.prepare(`
    SELECT tm.team_id AS id FROM team_members tm
    WHERE tm.user_id = ? AND tm.status = 'accepted' AND tm.team_id IN (?, ?)
  `).get(userId, challenge.challenger_team_id, challenge.challenged_team_id);

  if (!userTeam) {
    return res.status(403).json({ error: 'Bạn không thuộc đội nào trong trận đấu này' });
  }

  let winnerId = null;
  if (winner_team_id !== undefined && winner_team_id !== null && winner_team_id !== '') {
    winnerId = Number(winner_team_id);
    if (![challenge.challenger_team_id, challenge.challenged_team_id].includes(winnerId)) {
      return res.status(400).json({ error: 'Đội thắng không thuộc trận đấu này' });
    }
  }

  const existing = db.prepare(
    'SELECT id FROM match_results WHERE challenge_id = ? AND reporter_team_id = ?'
  ).get(challengeId, userTeam.id);
  if (existing) {
    return res.status(409).json({ error: 'Đội bạn đã gửi kết quả rồi' });
  }

  db.prepare(
    'INSERT INTO match_results (challenge_id, reporter_team_id, scores, winner_team_id) VALUES (?, ?, ?, ?)'
  ).run(challengeId, userTeam.id, scores, winnerId);

  const admins = db.prepare('SELECT id FROM users WHERE is_admin = 1').all();
  const t1 = db.prepare('SELECT name FROM teams WHERE id = ?').get(challenge.challenger_team_id);
  const t2 = db.prepare('SELECT name FROM teams WHERE id = ?').get(challenge.challenged_team_id);
  const reporterTeam = db.prepare('SELECT name FROM teams WHERE id = ?').get(userTeam.id);
  admins.forEach(a => {
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
      a.id, 'result_submitted',
      `Đội "${reporterTeam.name}" đã gửi kết quả trận ${t1.name} vs ${t2.name}. Chờ admin xác nhận.`,
      `/admin/challenges/${challengeId}`
    );
  });

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  log(userId, 'submit_result', `Trận #${challengeId} · ${scores} · Đội thắng: ${winnerId || 'Hòa'}`, ip);

  res.status(201).json({
    ok: true,
    result: {
      challenge_id: Number(challengeId),
      reporter_team_id: userTeam.id,
      scores,
      winner_team_id: winnerId
    }
  });
});

// Tạo thách đấu mới
router.post('/challenges', requireAuthApi, (req, res) => {
  const { challenger_team_id, challenged_team_id, match_date, match_time, reward, reward_detail, challenge_type, challenger_user_id, challenged_user_id } = req.body;

  if (!match_date || !match_time) {
    return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
  }

  let challengerTeamId, challengedTeamId;

  if (challenge_type === 'singles') {
    if (!challenger_user_id || !challenged_user_id) {
      return res.status(400).json({ error: 'Vui lòng chọn 2 người chơi' });
    }
    if (String(challenger_user_id) === String(challenged_user_id)) {
      return res.status(400).json({ error: 'Không thể thách đấu chính mình' });
    }
    challengerTeamId = getOrCreateSinglesTeam(Number(challenger_user_id));
    challengedTeamId = getOrCreateSinglesTeam(Number(challenged_user_id));
    if (!challengerTeamId || !challengedTeamId) {
      return res.status(404).json({ error: 'Người chơi không tồn tại' });
    }
  } else {
    if (!challenger_team_id || !challenged_team_id) {
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
    }
    if (String(challenger_team_id) === String(challenged_team_id)) {
      return res.status(400).json({ error: 'Không thể thách đấu chính đội mình' });
    }
    challengerTeamId = challenger_team_id;
    challengedTeamId = challenged_team_id;
  }

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(challengerTeamId);
  const opponent = db.prepare('SELECT * FROM teams WHERE id = ?').get(challengedTeamId);
  if (!team || !opponent) {
    return res.status(404).json({ error: challenge_type === 'singles' ? 'Người chơi không tồn tại' : 'Đội không tồn tại' });
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

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  log(req.session.user.id, 'create_challenge', `${team.name} vs ${opponent.name} · ${match_date} ${match_time} · ${reward || 'Bữa sáng'} · ${challenge_type || 'doubles'}`, ip);

  res.status(201).json({
    ok: true,
    challenge: {
      id: result.lastInsertRowid,
      challenger_team_id: Number(challengerTeamId),
      challenged_team_id: Number(challengedTeamId),
      match_date, match_time,
      reward: reward || 'Một bữa sáng',
      reward_detail: reward_detail || null,
      challenge_type: challenge_type || 'doubles',
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
