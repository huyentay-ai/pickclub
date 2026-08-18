const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');
const { requireAuth } = require('./auth');

const db = new Database(path.join(__dirname, '..', 'data', 'club.db'));
db.pragma('foreign_keys = ON');

router.use(requireAuth);

// List all active teams
router.get('/', (req, res) => {
  const teams = db.prepare(`
    SELECT t.*, u.full_name AS captain_name, u.avatar AS captain_avatar
    FROM teams t
    JOIN users u ON u.id = t.captain_id
    ORDER BY t.name
  `).all();

  const membersByTeam = db.prepare(`
    SELECT tm.team_id, u.full_name, u.username, u.avatar
    FROM team_members tm JOIN users u ON u.id = tm.user_id
    WHERE tm.status = 'accepted'
    ORDER BY u.full_name
  `).all();

  teams.forEach(t => {
    t.members = membersByTeam.filter(m => m.team_id === t.id);
  });

  // Pending invites for current user
  const pendingInvites = db.prepare(`
    SELECT tm.id, tm.team_id, t.name AS team_name, u.full_name AS captain_name
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    JOIN users u ON u.id = t.captain_id
    WHERE tm.user_id = ? AND tm.status = 'pending'
  `).all(req.session.user.id);

  res.render('teams/index', { teams, pendingInvites });
});

// Create team — redirect to admin
router.get('/create', (req, res) => {
  if (!req.session.user.is_admin) {
    req.session.flash = { type: 'error', message: 'Chỉ admin mới có quyền tạo đội' };
    return res.redirect('/teams');
  }
  res.redirect('/admin/teams/create');
});

// Team detail
router.get('/:id', (req, res) => {
  const team = db.prepare(`
    SELECT t.*, u.full_name AS captain_name, u.avatar AS captain_avatar
    FROM teams t JOIN users u ON u.id = t.captain_id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!team) {
    req.session.flash = { type: 'error', message: 'Đội không tồn tại' };
    return res.redirect('/teams');
  }

  const members = db.prepare(`
    SELECT tm.*, u.full_name, u.username, u.avatar
    FROM team_members tm JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ?
  `).all(req.params.id);

  const isCaptain = team.captain_id === req.session.user.id;

  res.render('teams/detail', { team, members, isCaptain });
});

module.exports = router;
