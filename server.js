const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
const { initDatabase, seedMembers } = require('./database');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/avatars', express.static(path.join(__dirname, 'athletes')));

// Session
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Initialize DB before loading routes (they open DB at require-time)
const db = initDatabase();
seedMembers(db);
db.close();

// Make user available to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// Routes
const authRoutes = require('./routes/auth');
app.use('/', authRoutes);
app.use('/teams', require('./routes/teams'));
app.use('/challenges', require('./routes/challenges'));
app.use('/tournament/events', require('./routes/tournament-events'));
app.use('/tournament', require('./routes/tournament'));
app.use('/api', require('./routes/api'));
app.use('/admin', require('./routes/admin'));
app.use('/admin/tournament', require('./routes/admin-tournament'));
app.use('/admin/tournament-events', require('./routes/admin-tournament-events'));

// Home page
app.get('/', (req, res) => {
  const Database = require('better-sqlite3');
  const dbConn = new Database(path.join(__dirname, 'data', 'club.db'));
  const members = dbConn.prepare('SELECT username, full_name, avatar FROM users ORDER BY RANDOM()').all();
  const memberCount = members.length;
  const recentChallenges = dbConn.prepare(`
    SELECT c.*, t1.name as challenger_name, t2.name as challenged_name,
      tw.name as winner_name, mr.scores
    FROM challenges c
    JOIN teams t1 ON c.challenger_team_id = t1.id
    JOIN teams t2 ON c.challenged_team_id = t2.id
    LEFT JOIN match_results mr ON mr.challenge_id = c.id
    LEFT JOIN teams tw ON tw.id = mr.winner_team_id
    ORDER BY CASE c.status WHEN 'scheduled' THEN 0 ELSE 1 END, c.match_date DESC, c.created_at DESC LIMIT 5
  `).all();
  const teamMembersMap = {};
  const allMembers = dbConn.prepare(`
    SELECT tm.team_id, u.full_name, u.avatar
    FROM team_members tm JOIN users u ON u.id = tm.user_id
    WHERE tm.status = 'accepted'
  `).all();
  allMembers.forEach(m => {
    if (!teamMembersMap[m.team_id]) teamMembersMap[m.team_id] = [];
    teamMembersMap[m.team_id].push(m);
  });
  recentChallenges.forEach(c => {
    c.challenger_members = teamMembersMap[c.challenger_team_id] || [];
    c.challenged_members = teamMembersMap[c.challenged_team_id] || [];
  });
  const scheduledMatches = dbConn.prepare(`
    SELECT c.match_date, c.match_time, c.reward, c.status,
      t1.name as challenger_name, t2.name as challenged_name,
      tw.name as winner_name
    FROM challenges c
    JOIN teams t1 ON c.challenger_team_id = t1.id
    JOIN teams t2 ON c.challenged_team_id = t2.id
    LEFT JOIN match_results mr ON mr.challenge_id = c.id
    LEFT JOIN teams tw ON tw.id = mr.winner_team_id
    ORDER BY c.created_at DESC LIMIT 20
  `).all();
  const playerPoints = getLeaderboard(dbConn);
  const totalFund = playerPoints.reduce((sum, p) => sum + Math.max(0, p.points), 0);
  const stats = {
    totalMatches: dbConn.prepare("SELECT COUNT(*) as c FROM challenges WHERE status = 'completed'").get().c,
    totalTeams: dbConn.prepare("SELECT COUNT(*) as c FROM teams WHERE status = 'active' AND is_singles = 0").get().c,
    breakfastsWon: totalFund,
    activeChallenges: dbConn.prepare("SELECT COUNT(*) as c FROM challenges WHERE status = 'scheduled'").get().c,
  };
  dbConn.close();
  res.render('index', { title: 'Trang chủ', memberCount, recentChallenges, members, scheduledMatches, totalFund, stats });
});

// Members page
app.get('/members', (req, res) => {
  const Database = require('better-sqlite3');
  const dbConn = new Database(path.join(__dirname, 'data', 'club.db'));
  const members = dbConn.prepare('SELECT * FROM users ORDER BY full_name').all();
  dbConn.close();
  res.render('members', { title: 'Thành viên', members });
});

// Leaderboard page
app.get('/leaderboard', (req, res) => {
  const Database = require('better-sqlite3');
  const dbConn = new Database(path.join(__dirname, 'data', 'club.db'));

  const mRaw = parseInt(req.query.m);
  const yRaw = parseInt(req.query.y);
  const selMonth = (mRaw >= 1 && mRaw <= 12) ? mRaw : null;
  const selYear  = (yRaw >= 2026 && yRaw <= 2030) ? yRaw : null;
  const period = (selMonth || selYear) ? 'filtered' : 'all';

  let dateFilter = '';
  if (selMonth && selYear) {
    const ym = `${selYear}-${String(selMonth).padStart(2, '0')}`;
    dateFilter = `AND strftime('%Y-%m', c.match_date) = '${ym}'`;
  } else if (selYear) {
    dateFilter = `AND strftime('%Y', c.match_date) = '${selYear}'`;
  } else if (selMonth) {
    dateFilter = `AND strftime('%m', c.match_date) = '${String(selMonth).padStart(2, '0')}'`;
  }

  const leaderboard = getLeaderboard(dbConn, dateFilter);
  const totalFund = leaderboard.reduce((sum, p) => sum + p.points, 0);

  const completedMatches = dbConn.prepare(`
    SELECT c.id, c.match_date, c.match_time, c.reward, c.challenge_type,
      c.challenger_team_id, c.challenged_team_id,
      t1.name as challenger_name, t2.name as challenged_name,
      tw.name as winner_name, mr.scores
    FROM challenges c
    JOIN teams t1 ON t1.id = c.challenger_team_id
    JOIN teams t2 ON t2.id = c.challenged_team_id
    LEFT JOIN match_results mr ON mr.challenge_id = c.id
    LEFT JOIN teams tw ON tw.id = mr.winner_team_id
    WHERE c.status = 'completed' ${dateFilter}
    ORDER BY c.match_date DESC, c.match_time DESC
  `).all();

  const teamMembersMap = {};
  const teamIds = [...new Set(completedMatches.flatMap(m => [m.challenger_team_id, m.challenged_team_id]))];
  if (teamIds.length > 0) {
    const placeholders = teamIds.map(() => '?').join(',');
    dbConn.prepare(`
      SELECT tm.team_id, u.avatar
      FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.status = 'accepted' AND tm.team_id IN (${placeholders})
    `).all(...teamIds).forEach(row => {
      if (!teamMembersMap[row.team_id]) teamMembersMap[row.team_id] = [];
      teamMembersMap[row.team_id].push(row.avatar);
    });
  }
  completedMatches.forEach(m => {
    m.challenger_avatars = teamMembersMap[m.challenger_team_id] || [];
    m.challenged_avatars = teamMembersMap[m.challenged_team_id] || [];
  });

  dbConn.close();
  res.render('leaderboard', {
    title: 'Quỹ bữa sáng', leaderboard, totalFund, completedMatches,
    period, selMonth, selYear
  });
});

function getLeaderboard(dbConn, dateFilter = '') {
  return dbConn.prepare(`
    SELECT u.id, u.full_name, u.username, u.avatar,
      COUNT(DISTINCT c.id) as matches,
      COALESCE(SUM(
        CASE
          WHEN mr.winner_team_id IS NOT NULL AND mr.winner_team_id != tm.team_id THEN 1
          ELSE 0
        END
      ), 0) as points
    FROM users u
    LEFT JOIN team_members tm ON tm.user_id = u.id AND tm.status = 'accepted'
    LEFT JOIN challenges c ON (c.challenger_team_id = tm.team_id OR c.challenged_team_id = tm.team_id)
      AND c.status = 'completed' ${dateFilter}
    LEFT JOIN match_results mr ON mr.challenge_id = c.id
    GROUP BY u.id
    ORDER BY matches DESC, points DESC, u.full_name ASC
  `).all();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Pickleball Club running at http://localhost:${PORT}`);
});
