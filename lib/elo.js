const K = 24;
const START_RATING = 1500;

function getAcceptedTeamMembers(db, teamId) {
  return db.prepare(
    `SELECT user_id FROM team_members WHERE team_id = ? AND status = 'accepted'`
  ).all(teamId).map((r) => r.user_id);
}

/**
 * Replays every completed challenge (chronological) and computes a per-user Elo rating.
 * 2v2 "team average" Elo: both members of a team share the same rating delta.
 * @param {import('better-sqlite3').Database} db
 * @returns {Map<number, number>} userId -> rating
 */
function computeEloRatings(db) {
  const ratings = new Map();
  for (const row of db.prepare('SELECT id FROM users').all()) {
    ratings.set(row.id, START_RATING);
  }

  const matches = db.prepare(`
    SELECT c.id, c.match_date, c.match_time, c.challenger_team_id, c.challenged_team_id, mr.winner_team_id
    FROM challenges c
    JOIN match_results mr ON mr.challenge_id = c.id
    WHERE c.status = 'completed'
    ORDER BY c.match_date ASC, c.match_time ASC, c.id ASC
  `).all();

  for (const m of matches) {
    if (!m.winner_team_id) continue; // hoa, khong doi Elo

    const teamAIds = getAcceptedTeamMembers(db, m.challenger_team_id);
    const teamBIds = getAcceptedTeamMembers(db, m.challenged_team_id);
    if (teamAIds.length === 0 || teamBIds.length === 0) continue;

    const avgA = teamAIds.reduce((s, id) => s + ratings.get(id), 0) / teamAIds.length;
    const avgB = teamBIds.reduce((s, id) => s + ratings.get(id), 0) / teamBIds.length;

    const expectedA = 1 / (1 + Math.pow(10, (avgB - avgA) / 400));
    const actualA = m.winner_team_id === m.challenger_team_id ? 1 : 0;
    const delta = K * (actualA - expectedA);

    for (const id of teamAIds) ratings.set(id, ratings.get(id) + delta);
    for (const id of teamBIds) ratings.set(id, ratings.get(id) - delta);
  }

  return ratings;
}

/**
 * computeEloRatings() + join user info + sort desc + attach rank.
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{ user_id: number, full_name: string, username: string, avatar: string, rating: number, rank: number }>}
 */
function getEloRanking(db) {
  const ratings = computeEloRatings(db);
  const users = db.prepare('SELECT id, username, full_name, avatar FROM users').all();

  const ranking = users
    .map((u) => ({
      user_id: u.id,
      username: u.username,
      full_name: u.full_name,
      avatar: u.avatar,
      rating: ratings.get(u.id) ?? START_RATING,
    }))
    .sort((a, b) => b.rating - a.rating || a.full_name.localeCompare(b.full_name));

  ranking.forEach((r, i) => { r.rank = i + 1; });
  return ranking;
}

module.exports = { computeEloRatings, getEloRanking, K, START_RATING };
