const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');
const { requireAuth } = require('./auth');

const db = new Database(path.join(__dirname, '..', 'data', 'club.db'));
db.pragma('foreign_keys = ON');
const { log } = require('./logger');

router.use(requireAuth);

// Helper: get teams where user is a member
function getUserTeams(userId) {
  return db.prepare(`
    SELECT t.* FROM teams t
    JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = ? AND tm.status = 'accepted' AND t.status = 'active'
  `).all(userId);
}

// Helper: format date nicely
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  return `${days[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

// List challenges
router.get('/', (req, res) => {
  const userId = req.session.user.id;
  const myTeams = getUserTeams(userId);

  const challenges = db.prepare(`
    SELECT c.*,
      t1.name AS challenger_name, t2.name AS challenged_name,
      u1.full_name AS challenger_captain, u2.full_name AS challenged_captain
    FROM challenges c
    JOIN teams t1 ON t1.id = c.challenger_team_id
    JOIN teams t2 ON t2.id = c.challenged_team_id
    JOIN users u1 ON u1.id = t1.captain_id
    JOIN users u2 ON u2.id = t2.captain_id
    ORDER BY c.created_at DESC
  `).all();

  challenges.forEach(c => {
    c.match_date_fmt = formatDate(c.match_date);
    c.counter_date_fmt = formatDate(c.counter_date);
  });

  res.render('challenges/index', { challenges, myTeams });
});

// Helper: get all active teams with member names
function getAllTeamsWithMembers() {
  return db.prepare(`
    SELECT t.id, t.name, t.type, t.captain_id,
      GROUP_CONCAT(u.full_name, ', ') as member_names
    FROM teams t
    JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'accepted'
    JOIN users u ON u.id = tm.user_id
    WHERE t.status = 'active'
    GROUP BY t.id
    ORDER BY t.name
  `).all();
}

// Create challenge form
router.get('/create', (req, res) => {
  const teams = getAllTeamsWithMembers();
  res.render('challenges/create', { teams });
});

// Create challenge
router.post('/create', (req, res) => {
  const { challenger_team_id, challenged_team_id, match_date, match_time, reward, reward_detail } = req.body;

  if (!challenger_team_id || !challenged_team_id || !match_date || !match_time) {
    req.session.flash = { type: 'error', message: 'Vui lòng điền đầy đủ thông tin' };
    return res.redirect('/challenges/create');
  }

  if (challenger_team_id === challenged_team_id) {
    req.session.flash = { type: 'error', message: 'Không thể thách đấu chính đội mình' };
    return res.redirect('/challenges/create');
  }

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(challenger_team_id);
  const opponent = db.prepare('SELECT * FROM teams WHERE id = ?').get(challenged_team_id);
  if (!team || !opponent) {
    req.session.flash = { type: 'error', message: 'Đội không tồn tại' };
    return res.redirect('/challenges/create');
  }

  const result = db.prepare(`
    INSERT INTO challenges (challenger_team_id, challenged_team_id, match_date, match_time, reward, reward_detail, status)
    VALUES (?, ?, ?, ?, ?, ?, 'scheduled')
  `).run(challenger_team_id, challenged_team_id, match_date, match_time, reward || 'Một bữa sáng', reward_detail || null);

  // Notify both captains
  [team.captain_id, opponent.captain_id].forEach(captainId => {
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
      captainId, 'challenge',
      `Trận đấu "${team.name}" vs "${opponent.name}" đã lên lịch vào ${formatDate(match_date)} lúc ${match_time}`,
      `/challenges/${result.lastInsertRowid}`
    );
  });

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  log(req.session.user.id, 'create_challenge', `${team.name} vs ${opponent.name} · ${match_date} ${match_time} · ${reward || 'Một bữa sáng'}`, ip);
  req.session.flash = { type: 'success', message: 'Đã lên lịch trận đấu!' };
  res.redirect('/challenges');
});

// Respond to challenge
router.post('/:id/respond', (req, res) => {
  const challengeId = req.params.id;
  const { action, counter_date, counter_time, counter_note, decline_reason } = req.body;
  const userId = req.session.user.id;

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
  if (!challenge) {
    req.session.flash = { type: 'error', message: 'Thách đấu không tồn tại' };
    return res.redirect('/challenges');
  }

  // Verify user is captain of challenged team
  const challengedTeam = db.prepare('SELECT * FROM teams WHERE id = ? AND captain_id = ?').get(challenge.challenged_team_id, userId);
  if (!challengedTeam) {
    req.session.flash = { type: 'error', message: 'Bạn không có quyền phản hồi thách đấu này' };
    return res.redirect('/challenges');
  }

  const challengerTeam = db.prepare('SELECT * FROM teams WHERE id = ?').get(challenge.challenger_team_id);

  if (action === 'accept') {
    db.prepare('UPDATE challenges SET status = ? WHERE id = ?').run('accepted', challengeId);
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
      challengerTeam.captain_id, 'challenge_accepted',
      `Đội "${challengedTeam.name}" đã chấp nhận thách đấu!`,
      `/challenges/${challengeId}`
    );
    req.session.flash = { type: 'success', message: 'Đã chấp nhận thách đấu!' };
  } else if (action === 'decline') {
    db.prepare('UPDATE challenges SET status = ?, decline_reason = ? WHERE id = ?').run('declined', decline_reason || null, challengeId);
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
      challengerTeam.captain_id, 'challenge_declined',
      `Đội "${challengedTeam.name}" đã từ chối thách đấu`,
      `/challenges/${challengeId}`
    );
    req.session.flash = { type: 'info', message: 'Đã từ chối thách đấu' };
  } else if (action === 'counter') {
    db.prepare('UPDATE challenges SET status = ?, counter_date = ?, counter_time = ?, counter_note = ? WHERE id = ?')
      .run('counter', counter_date, counter_time, counter_note || null, challengeId);
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
      challengerTeam.captain_id, 'challenge_counter',
      `Đội "${challengedTeam.name}" đề xuất đổi lịch thách đấu`,
      `/challenges/${challengeId}`
    );
    req.session.flash = { type: 'info', message: 'Đã gửi đề xuất đổi lịch' };
  }

  res.redirect(`/challenges/${challengeId}`);
});

// Submit match result
router.post('/:id/result', (req, res) => {
  const challengeId = req.params.id;
  const { scores, winner_team_id } = req.body;
  const userId = req.session.user.id;

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
  if (!challenge || !['accepted', 'scheduled'].includes(challenge.status)) {
    req.session.flash = { type: 'error', message: 'Không thể gửi kết quả cho trận đấu này' };
    return res.redirect('/challenges');
  }

  // Find which team the user belongs to
  const userTeam = db.prepare(`
    SELECT tm.team_id as id FROM team_members tm
    WHERE tm.user_id = ? AND tm.status = 'accepted' AND tm.team_id IN (?, ?)
  `).get(userId, challenge.challenger_team_id, challenge.challenged_team_id);

  if (!userTeam) {
    req.session.flash = { type: 'error', message: 'Bạn không thuộc đội nào trong trận đấu này' };
    return res.redirect('/challenges');
  }

  // Check if this team already submitted
  const existing = db.prepare('SELECT * FROM match_results WHERE challenge_id = ? AND reporter_team_id = ?').get(challengeId, userTeam.id);
  if (existing) {
    req.session.flash = { type: 'error', message: 'Đội bạn đã gửi kết quả rồi' };
    return res.redirect(`/challenges/${challengeId}`);
  }

  db.prepare('INSERT INTO match_results (challenge_id, reporter_team_id, scores, winner_team_id) VALUES (?, ?, ?, ?)')
    .run(challengeId, userTeam.id, scores, winner_team_id);

  // Notify admins
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
  log(userId, 'submit_result', `Trận #${challengeId} · ${scores} · Đội thắng: ${winner_team_id}`, ip);
  req.session.flash = { type: 'success', message: 'Đã gửi kết quả. Chờ admin xác nhận.' };
  res.redirect(`/challenges/${challengeId}`);
});

// Challenge detail
router.get('/:id', (req, res) => {
  const challengeId = req.params.id;
  const userId = req.session.user.id;

  const challenge = db.prepare(`
    SELECT c.*,
      t1.name AS challenger_name, t1.captain_id AS challenger_captain_id,
      t2.name AS challenged_name, t2.captain_id AS challenged_captain_id,
      u1.full_name AS challenger_captain_name, u2.full_name AS challenged_captain_name
    FROM challenges c
    JOIN teams t1 ON t1.id = c.challenger_team_id
    JOIN teams t2 ON t2.id = c.challenged_team_id
    JOIN users u1 ON u1.id = t1.captain_id
    JOIN users u2 ON u2.id = t2.captain_id
    WHERE c.id = ?
  `).get(challengeId);

  if (!challenge) {
    req.session.flash = { type: 'error', message: 'Thách đấu không tồn tại' };
    return res.redirect('/challenges');
  }

  challenge.match_date_fmt = formatDate(challenge.match_date);
  challenge.counter_date_fmt = formatDate(challenge.counter_date);

  const results = db.prepare(`
    SELECT mr.*, COALESCE(t.name, 'Admin') AS team_name
    FROM match_results mr LEFT JOIN teams t ON t.id = mr.reporter_team_id
    WHERE mr.challenge_id = ?
  `).all(challengeId);

  // Check if current user belongs to either team
  const userTeam = db.prepare(`
    SELECT tm.team_id as id FROM team_members tm
    WHERE tm.user_id = ? AND tm.status = 'accepted' AND tm.team_id IN (?, ?)
  `).get(userId, challenge.challenger_team_id, challenge.challenged_team_id);

  const hasSubmitted = userTeam
    ? db.prepare('SELECT 1 FROM match_results WHERE challenge_id = ? AND reporter_team_id = ?').get(challengeId, userTeam.id)
    : null;

  res.render('challenges/detail', {
    challenge, results, userTeam,
    hasSubmitted: !!hasSubmitted,
    isChallengedCaptain: challenge.challenged_captain_id === userId,
    isChallengerCaptain: challenge.challenger_captain_id === userId
  });
});

module.exports = router;
