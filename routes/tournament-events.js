const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'club.db'));
db.pragma('foreign_keys = ON');

const statusLabels = { upcoming: 'Sắp diễn ra', ongoing: 'Đang diễn ra', completed: 'Đã kết thúc' };

router.get('/', (req, res) => {
  const events = db.prepare(`
    SELECT te.*,
      (SELECT COUNT(*) FROM tournament_event_teams WHERE event_id = te.id) as team_count
    FROM tournament_events te
    ORDER BY
      CASE te.status WHEN 'ongoing' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,
      te.event_date DESC,
      te.created_at DESC
  `).all();
  res.render('tournament/events', { events, statusLabels });
});

router.get('/:id', (req, res) => {
  const event = db.prepare(`
    SELECT te.*,
      tc.name as champion_name,
      tr.name as runner_up_name,
      tt.name as third_place_name
    FROM tournament_events te
    LEFT JOIN teams tc ON tc.id = te.champion_team_id
    LEFT JOIN teams tr ON tr.id = te.runner_up_team_id
    LEFT JOIN teams tt ON tt.id = te.third_place_team_id
    WHERE te.id = ?
  `).get(req.params.id);

  if (!event) {
    req.session.flash = { type: 'error', message: 'Giải đấu không tồn tại' };
    return res.redirect('/tournament/events');
  }

  const teams = db.prepare(`
    SELECT t.id, t.name,
      GROUP_CONCAT(u.full_name, ', ') as member_names
    FROM tournament_event_teams tet
    JOIN teams t ON t.id = tet.team_id
    LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'accepted'
    LEFT JOIN users u ON u.id = tm.user_id
    WHERE tet.event_id = ?
    GROUP BY t.id
    ORDER BY t.name
  `).all(event.id);

  res.render('tournament/event-detail', { event, teams, statusLabels });
});

module.exports = router;
