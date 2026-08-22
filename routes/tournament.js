const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');
const { requireAuth } = require('./auth');
const { listTournaments, getTournamentDetail } = require('../lib/tournament');

const db = new Database(path.join(__dirname, '..', 'data', 'club.db'));
db.pragma('foreign_keys = ON');

router.use(requireAuth);

// Danh sach giai dau
router.get('/', (req, res) => {
  const tournaments = listTournaments(db);
  res.render('tournament/index', { tournaments });
});

// Chi tiet 1 giai dau (chi xem)
router.get('/:id', (req, res) => {
  const detail = getTournamentDetail(db, req.params.id);
  if (!detail) {
    req.session.flash = { type: 'error', message: 'Giải đấu không tồn tại' };
    return res.redirect('/tournament');
  }
  res.render('tournament/detail', detail);
});

module.exports = router;
