const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'club.db');

function initDatabase() {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      avatar TEXT,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('male','female','mixed')) NOT NULL,
      captain_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','active','disbanded')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenger_team_id INTEGER NOT NULL REFERENCES teams(id),
      challenged_team_id INTEGER NOT NULL REFERENCES teams(id),
      match_date TEXT NOT NULL,
      match_time TEXT NOT NULL,
      reward TEXT DEFAULT 'Một bữa sáng',
      reward_detail TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','counter','scheduled','completed','disputed')),
      counter_date TEXT,
      counter_time TEXT,
      counter_note TEXT,
      decline_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS match_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id),
      reporter_team_id INTEGER NOT NULL REFERENCES teams(id),
      scores TEXT NOT NULL,
      winner_team_id INTEGER REFERENCES teams(id),
      reward_paid INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(challenge_id, reporter_team_id)
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      detail TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      event_date TEXT,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','seeded','active','completed')),
      group_size INTEGER DEFAULT 4,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournament_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      seed_elo REAL,
      seed_rank INTEGER,
      total_points INTEGER DEFAULT 0,
      points_diff INTEGER DEFAULT 0,
      final_rank INTEGER,
      UNIQUE(tournament_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tournament_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
      group_label TEXT NOT NULL,
      group_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tournament_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES tournament_groups(id),
      participant_id INTEGER NOT NULL REFERENCES tournament_participants(id),
      group_seed INTEGER NOT NULL CHECK(group_seed IN (1,2,3,4)),
      UNIQUE(group_id, participant_id),
      UNIQUE(group_id, group_seed)
    );

    CREATE TABLE IF NOT EXISTS tournament_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
      round_type TEXT NOT NULL CHECK(round_type IN ('group','final','consolation')),
      group_id INTEGER REFERENCES tournament_groups(id),
      match_no INTEGER NOT NULL,
      team_a_player1 INTEGER NOT NULL REFERENCES tournament_participants(id),
      team_a_player2 INTEGER NOT NULL REFERENCES tournament_participants(id),
      team_b_player1 INTEGER NOT NULL REFERENCES tournament_participants(id),
      team_b_player2 INTEGER NOT NULL REFERENCES tournament_participants(id),
      score_a INTEGER,
      score_b INTEGER,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournament_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      event_date TEXT,
      event_time TEXT,
      location TEXT,
      rules TEXT,
      prizes TEXT,
      champion_team_id INTEGER REFERENCES teams(id),
      runner_up_team_id INTEGER REFERENCES teams(id),
      third_place_team_id INTEGER REFERENCES teams(id),
      status TEXT DEFAULT 'upcoming' CHECK(status IN ('upcoming','ongoing','completed')),
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournament_event_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES tournament_events(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      UNIQUE(event_id, team_id)
    );
  `);

  // Migration: singles challenge support
  const teamCols = db.prepare("PRAGMA table_info(teams)").all().map(c => c.name);
  if (!teamCols.includes('is_singles')) {
    db.exec("ALTER TABLE teams ADD COLUMN is_singles INTEGER DEFAULT 0");
  }

  const challengeCols = db.prepare("PRAGMA table_info(challenges)").all().map(c => c.name);
  if (!challengeCols.includes('challenge_type')) {
    db.exec("ALTER TABLE challenges ADD COLUMN challenge_type TEXT DEFAULT 'doubles'");
  }

  return db;
}

function seedMembers(db) {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count > 0) return;

  const members = [
    { username: 'hung', full_name: 'Lý Ngọc Hưng', avatar: 'hung.png', is_admin: 1 },
    { username: 'nam', full_name: 'Nam Nguyễn', avatar: 'nam.png' },
    { username: 'kien', full_name: 'Nguyễn Trọng Kiên', avatar: 'kien.png' },
    { username: 'binh', full_name: 'Trần Văn Bình', avatar: 'binh.png' },
    { username: 'tu', full_name: 'Lê Bá Tứ', avatar: 'tu.png' },
    { username: 'anh_dao', full_name: 'Anh Đạo', avatar: 'anh_dao.png' },
    { username: 'dung', full_name: 'Trịnh Dũng', avatar: 'dung.png', is_admin: 1 },
    { username: 'tung', full_name: 'Tùng Nguyễn', avatar: 'tung.jpg' },
    { username: 'thinh', full_name: 'Đào Tùng Thịnh', avatar: 'thinh.png' },
    { username: 'ngocanh', full_name: 'Ngọc Anh', avatar: 'ngocanh.png' },
    { username: 'viet', full_name: 'Nguyễn Văn Việt', avatar: 'viet.png' },
    { username: 'thang', full_name: 'Nguyễn Văn Thắng', avatar: 'thang.png' },
    { username: 'thi_dao', full_name: 'Thị Đào', avatar: 'thi_dao.png' },
  ];

  const insert = db.prepare('INSERT INTO users (username, password, full_name, avatar, is_admin) VALUES (?, ?, ?, ?, ?)');
  for (const m of members) {
    insert.run(m.username, '1234', m.full_name, m.avatar, m.is_admin || 0);
  }

  seedTeams(db);
}

function seedTeams(db) {
  const u = {};
  for (const row of db.prepare('SELECT id, username FROM users').all()) {
    u[row.username] = row.id;
  }

  const teams = [
    { name: 'Hưng & Kiên',    type: 'male', captain: 'hung',    member: 'kien' },
    { name: 'Nam & Bình',     type: 'male', captain: 'nam',     member: 'binh' },
    { name: 'Tứ & Dũng',     type: 'male', captain: 'tu',      member: 'dung' },
    { name: 'Tùng & Thịnh',   type: 'male', captain: 'tung',    member: 'thinh' },
    { name: 'Việt & Thắng',   type: 'male', captain: 'viet',    member: 'thang' },
    { name: 'Đạo & Đào',     type: 'mixed', captain: 'anh_dao', member: 'thi_dao' },
    { name: 'Hưng & Ngọc Anh', type: 'mixed', captain: 'hung',  member: 'ngocanh' },
  ];

  const insertTeam = db.prepare('INSERT INTO teams (name, type, captain_id, status) VALUES (?, ?, ?, ?)');
  const insertMember = db.prepare('INSERT INTO team_members (team_id, user_id, status) VALUES (?, ?, ?)');

  for (const t of teams) {
    const captainId = u[t.captain];
    const memberId = u[t.member];
    const result = insertTeam.run(t.name, t.type, captainId, 'active');
    const teamId = result.lastInsertRowid;
    insertMember.run(teamId, captainId, 'accepted');
    insertMember.run(teamId, memberId, 'accepted');
  }
}

module.exports = { initDatabase, seedMembers };
