const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');
const { requireAuth } = require('./auth');
const { log } = require('./logger');

const db = new Database(path.join(__dirname, '..', 'data', 'club.db'));
db.pragma('foreign_keys = ON');

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.is_admin) {
    req.session.flash = { type: 'error', message: 'Bạn không có quyền truy cập trang này' };
    return res.redirect('/');
  }
  next();
}

router.use(requireAuth);
router.use(requireAdmin);

function getIp(req) {
  return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

const statusLabels = { upcoming: 'Sắp diễn ra', ongoing: 'Đang diễn ra', completed: 'Đã kết thúc' };

router.get('/', (req, res) => {
  const events = db.prepare(`
    SELECT te.*,
      tc.name as champion_name,
      tr.name as runner_up_name,
      tt.name as third_place_name,
      (SELECT COUNT(*) FROM tournament_event_teams WHERE event_id = te.id) as team_count
    FROM tournament_events te
    LEFT JOIN teams tc ON tc.id = te.champion_team_id
    LEFT JOIN teams tr ON tr.id = te.runner_up_team_id
    LEFT JOIN teams tt ON tt.id = te.third_place_team_id
    ORDER BY te.created_at DESC
  `).all();
  res.render('admin/tournament-events/index', { events, statusLabels });
});

router.get('/create', (req, res) => {
  const teams = db.prepare(`
    SELECT t.id, t.name,
      GROUP_CONCAT(u.full_name, ', ') as member_names
    FROM teams t
    LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'accepted'
    LEFT JOIN users u ON u.id = tm.user_id
    WHERE t.status = 'active' AND t.is_singles = 0
    GROUP BY t.id
    ORDER BY t.name
  `).all();
  res.render('admin/tournament-events/create', { teams });
});

router.post('/create', (req, res) => {
  const { name, event_date, event_time, location, rules, prizes } = req.body;
  let teamIds = req.body.teams || [];
  if (!Array.isArray(teamIds)) teamIds = [teamIds];
  teamIds = teamIds.map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id));

  if (!name || !name.trim()) {
    req.session.flash = { type: 'error', message: 'Vui lòng nhập tên giải đấu' };
    return res.redirect('/admin/tournament-events/create');
  }

  const insert = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO tournament_events (name, event_date, event_time, location, rules, prizes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name.trim(), event_date || null, event_time || null, location || null, rules || null, prizes || null, req.session.user.id);

    const eventId = result.lastInsertRowid;
    const insertTeam = db.prepare('INSERT INTO tournament_event_teams (event_id, team_id) VALUES (?, ?)');
    for (const teamId of teamIds) {
      insertTeam.run(eventId, teamId);
    }
    return eventId;
  });

  const eventId = insert();
  log(req.session.user.id, 'admin_create_tournament_event', `Tạo giải "${name.trim()}", ${teamIds.length} đội`, getIp(req));
  req.session.flash = { type: 'success', message: 'Đã tạo giải đấu!' };
  res.redirect('/admin/tournament-events');
});

router.get('/:id/edit', (req, res) => {
  const event = db.prepare('SELECT * FROM tournament_events WHERE id = ?').get(req.params.id);
  if (!event) {
    req.session.flash = { type: 'error', message: 'Giải đấu không tồn tại' };
    return res.redirect('/admin/tournament-events');
  }

  const selectedTeamIds = db.prepare('SELECT team_id FROM tournament_event_teams WHERE event_id = ?')
    .all(event.id).map(r => r.team_id);

  const teams = db.prepare(`
    SELECT t.id, t.name,
      GROUP_CONCAT(u.full_name, ', ') as member_names
    FROM teams t
    LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'accepted'
    LEFT JOIN users u ON u.id = tm.user_id
    WHERE t.status = 'active' AND t.is_singles = 0
    GROUP BY t.id
    ORDER BY t.name
  `).all();

  const eventTeams = teams.filter(t => selectedTeamIds.includes(t.id));

  res.render('admin/tournament-events/edit', { event, teams, selectedTeamIds, eventTeams, statusLabels });
});

router.post('/:id/edit', (req, res) => {
  const event = db.prepare('SELECT * FROM tournament_events WHERE id = ?').get(req.params.id);
  if (!event) {
    req.session.flash = { type: 'error', message: 'Giải đấu không tồn tại' };
    return res.redirect('/admin/tournament-events');
  }

  const { name, event_date, event_time, location, rules, prizes, status, champion_team_id, runner_up_team_id, third_place_team_id } = req.body;
  let teamIds = req.body.teams || [];
  if (!Array.isArray(teamIds)) teamIds = [teamIds];
  teamIds = teamIds.map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id));

  if (!name || !name.trim()) {
    req.session.flash = { type: 'error', message: 'Vui lòng nhập tên giải đấu' };
    return res.redirect(`/admin/tournament-events/${event.id}/edit`);
  }

  const validStatuses = ['upcoming', 'ongoing', 'completed'];
  const finalStatus = validStatuses.includes(status) ? status : event.status;

  const update = db.transaction(() => {
    db.prepare(`
      UPDATE tournament_events
      SET name = ?, event_date = ?, event_time = ?, location = ?, rules = ?, prizes = ?,
          status = ?, champion_team_id = ?, runner_up_team_id = ?, third_place_team_id = ?
      WHERE id = ?
    `).run(
      name.trim(),
      event_date || null,
      event_time || null,
      location || null,
      rules || null,
      prizes || null,
      finalStatus,
      champion_team_id ? parseInt(champion_team_id, 10) : null,
      runner_up_team_id ? parseInt(runner_up_team_id, 10) : null,
      third_place_team_id ? parseInt(third_place_team_id, 10) : null,
      event.id
    );

    db.prepare('DELETE FROM tournament_event_teams WHERE event_id = ?').run(event.id);
    const insertTeam = db.prepare('INSERT INTO tournament_event_teams (event_id, team_id) VALUES (?, ?)');
    for (const teamId of teamIds) {
      insertTeam.run(event.id, teamId);
    }
  });

  update();
  log(req.session.user.id, 'admin_edit_tournament_event', `Sửa giải "${name.trim()}" (#${event.id})`, getIp(req));
  req.session.flash = { type: 'success', message: 'Đã cập nhật giải đấu!' };
  res.redirect('/admin/tournament-events');
});

router.post('/:id/delete', (req, res) => {
  const event = db.prepare('SELECT * FROM tournament_events WHERE id = ?').get(req.params.id);
  if (!event) {
    req.session.flash = { type: 'error', message: 'Giải đấu không tồn tại' };
    return res.redirect('/admin/tournament-events');
  }

  db.prepare('DELETE FROM tournament_events WHERE id = ?').run(event.id);
  log(req.session.user.id, 'admin_delete_tournament_event', `Xóa giải "${event.name}" (#${event.id})`, getIp(req));
  req.session.flash = { type: 'success', message: 'Đã xóa giải đấu!' };
  res.redirect('/admin/tournament-events');
});

module.exports = router;
