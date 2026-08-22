const { getEloRanking, START_RATING } = require('./elo');

/**
 * Chia N nguoi (da sort giam dan theo elo) thanh N/groupSize bang theo kieu snake:
 * tier 1 (top) di thuan, tier 2 di nguoc, tier 3 thuan, tier 4 nguoc... moi bang co
 * dung 1 nguoi moi tier -> khong bang nao toan manh hoac toan yeu.
 * @param {Array<T>} rankedPlayers - do dai N, da sort tot->kem
 * @param {number} groupSize
 * @returns {Array<Array<T>>} - do dai N/groupSize, moi phan tu dai groupSize, thu tu = group_seed 1..groupSize
 */
function snakeSeed(rankedPlayers, groupSize = 4) {
  const numGroups = rankedPlayers.length / groupSize;
  const groups = Array.from({ length: numGroups }, () => []);

  for (let tier = 0; tier < groupSize; tier++) {
    const tierPlayers = rankedPlayers.slice(tier * numGroups, (tier + 1) * numGroups);
    const forward = tier % 2 === 0;
    tierPlayers.forEach((p, idx) => {
      const groupIdx = forward ? idx : numGroups - 1 - idx;
      groups[groupIdx].push(p);
    });
  }

  return groups;
}

const GROUP_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Buoc 1: tinh Elo, ghi seed_elo/seed_rank, chia bang snake, insert tournament_groups +
 * tournament_group_members. Set status='seeded'.
 * @param {import('better-sqlite3').Database} db
 * @param {number} tournamentId
 */
function generateSeededGroups(db, tournamentId) {
  const participants = db.prepare(
    `SELECT id, user_id FROM tournament_participants WHERE tournament_id = ?`
  ).all(tournamentId);

  if (participants.length === 0 || participants.length % 4 !== 0) {
    throw new Error('So nguoi tham gia phai la boi so cua 4');
  }

  const eloRanking = getEloRanking(db);
  const eloByUserId = new Map(eloRanking.map((r) => [r.user_id, r.rating]));

  const seeded = participants
    .map((p) => ({ id: p.id, user_id: p.user_id, elo: eloByUserId.get(p.user_id) ?? START_RATING }))
    .sort((a, b) => b.elo - a.elo || a.user_id - b.user_id);

  seeded.forEach((p, idx) => { p.seed_rank = idx + 1; });

  const updateParticipant = db.prepare(
    `UPDATE tournament_participants SET seed_elo = ?, seed_rank = ? WHERE id = ?`
  );
  const insertGroup = db.prepare(
    `INSERT INTO tournament_groups (tournament_id, group_label, group_order) VALUES (?, ?, ?)`
  );
  const insertMember = db.prepare(
    `INSERT INTO tournament_group_members (group_id, participant_id, group_seed) VALUES (?, ?, ?)`
  );

  const groups = snakeSeed(seeded, 4);

  const tx = db.transaction(() => {
    for (const p of seeded) updateParticipant.run(p.elo, p.seed_rank, p.id);

    groups.forEach((groupPlayers, gIdx) => {
      const result = insertGroup.run(tournamentId, GROUP_LABELS[gIdx] || `G${gIdx + 1}`, gIdx + 1);
      const groupId = result.lastInsertRowid;
      groupPlayers.forEach((p, seedIdx) => {
        insertMember.run(groupId, p.id, seedIdx + 1);
      });
    });

    db.prepare(`UPDATE tournaments SET status = 'seeded' WHERE id = ?`).run(tournamentId);
  });
  tx();
}

/**
 * Hoan doi cho (bang) cua 2 nguoi choi (dung khi admin sua tay o buoc preview seed).
 * Ngay sau auto-seed, MOI bang deu da du 4/4 nguoi nen "chuyen 1 nguoi sang bang khac"
 * la khong the (khong bang nao con cho trong) - vi vay thao tac hop le duy nhat la
 * hoan doi participant_id giua 2 hang tournament_group_members (giu nguyen group_id/
 * group_seed cua tung hang), luon hop le bat ke bang co day hay khong.
 * @param {import('better-sqlite3').Database} db
 * @param {number} participantIdA
 * @param {number} participantIdB
 */
function swapParticipants(db, participantIdA, participantIdB) {
  if (String(participantIdA) === String(participantIdB)) {
    throw new Error('Vui lòng chọn 2 người khác nhau để đổi chỗ');
  }

  const rowA = db.prepare(`SELECT id, group_id FROM tournament_group_members WHERE participant_id = ?`).get(participantIdA);
  const rowB = db.prepare(`SELECT id, group_id FROM tournament_group_members WHERE participant_id = ?`).get(participantIdB);
  if (!rowA || !rowB) throw new Error('Không tìm thấy người chơi trong bảng đấu');
  if (rowA.group_id === rowB.group_id) {
    throw new Error('Hai người này đang ở cùng 1 bảng');
  }

  const updateOwner = db.prepare(`UPDATE tournament_group_members SET participant_id = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    updateOwner.run(participantIdB, rowA.id);
    updateOwner.run(participantIdA, rowB.id);
  });
  tx();
}

/**
 * Buoc 2: voi moi bang, sinh dung 3 tran theo mau co dinh Mexicano cho pod 4 nguoi
 * (group_seed 1-4 TRONG BANG, khong phai seed toan giai):
 *   Tran 1: seed1+seed4 vs seed2+seed3
 *   Tran 2: seed1+seed3 vs seed2+seed4
 *   Tran 3: seed1+seed2 vs seed3+seed4
 * Set status='active'. Tu choi neu da co lich (chong chay 2 lan).
 * @param {import('better-sqlite3').Database} db
 * @param {number} tournamentId
 */
function confirmAndGenerateSchedule(db, tournamentId) {
  const existing = db.prepare(
    `SELECT COUNT(*) as c FROM tournament_matches WHERE tournament_id = ?`
  ).get(tournamentId).c;
  if (existing > 0) {
    throw new Error('Lich thi dau da duoc tao truoc do');
  }

  const groups = db.prepare(
    `SELECT id, group_label FROM tournament_groups WHERE tournament_id = ? ORDER BY group_order`
  ).all(tournamentId);

  const getMemberByGroupSeed = db.prepare(
    `SELECT participant_id FROM tournament_group_members WHERE group_id = ? AND group_seed = ?`
  );
  const insertMatch = db.prepare(`
    INSERT INTO tournament_matches
      (tournament_id, round_type, group_id, match_no, team_a_player1, team_a_player2, team_b_player1, team_b_player2, status)
    VALUES (?, 'group', ?, ?, ?, ?, ?, ?, 'pending')
  `);

  const tx = db.transaction(() => {
    for (const group of groups) {
      const seeds = [1, 2, 3, 4].map((seed) => {
        const row = getMemberByGroupSeed.get(group.id, seed);
        if (!row) throw new Error(`Bang ${group.group_label} chua du 4 nguoi (thieu vi tri ${seed})`);
        return row.participant_id;
      });
      const [s1, s2, s3, s4] = seeds;
      insertMatch.run(tournamentId, group.id, 1, s1, s4, s2, s3);
      insertMatch.run(tournamentId, group.id, 2, s1, s3, s2, s4);
      insertMatch.run(tournamentId, group.id, 3, s1, s2, s3, s4);
    }
    db.prepare(`UPDATE tournaments SET status = 'active' WHERE id = ?`).run(tournamentId);
  });
  tx();
}

/**
 * Luu ket qua 1 tran. Voi tran vong bang ('group'), cong diem doi minh vao total_points/points_diff
 * cua ca 4 nguoi trong tran (khong tinh lai toan giai). Voi final/consolation chi luu diem, khong
 * cong vao total_points (total_points da "chot" de chon nguoi vao chung ket truoc do).
 * @param {import('better-sqlite3').Database} db
 * @param {number} matchId
 * @param {number} scoreA
 * @param {number} scoreB
 */
function applyMatchResult(db, matchId, scoreA, scoreB) {
  const match = db.prepare(`SELECT * FROM tournament_matches WHERE id = ?`).get(matchId);
  if (!match) throw new Error('Khong tim thay tran dau');
  if (match.status === 'completed') throw new Error('Tran dau da co ket qua, khong the nhap lai');

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tournament_matches SET score_a = ?, score_b = ?, status = 'completed' WHERE id = ?`
    ).run(scoreA, scoreB, matchId);

    if (match.round_type === 'group') {
      const addPoints = db.prepare(
        `UPDATE tournament_participants SET total_points = total_points + ?, points_diff = points_diff + ? WHERE id = ?`
      );
      addPoints.run(scoreA, scoreA - scoreB, match.team_a_player1);
      addPoints.run(scoreA, scoreA - scoreB, match.team_a_player2);
      addPoints.run(scoreB, scoreB - scoreA, match.team_b_player1);
      addPoints.run(scoreB, scoreB - scoreA, match.team_b_player2);
    }
  });
  tx();
}

/**
 * Khi moi tran vong bang da 'completed': xep hang toan giai theo
 * (total_points DESC, points_diff DESC, seed_elo DESC), chon top 4 vao chung ket
 * (hang1+hang4 vs hang2+hang3), hang 5-8 vao tranh hang 5 (neu du nguoi).
 * @param {import('better-sqlite3').Database} db
 * @param {number} tournamentId
 * @returns {{ finalists: Array, consolation: Array|null }}
 */
function generateFinalMatches(db, tournamentId) {
  const existingFinal = db.prepare(
    `SELECT COUNT(*) as c FROM tournament_matches WHERE tournament_id = ? AND round_type IN ('final','consolation')`
  ).get(tournamentId).c;
  if (existingFinal > 0) throw new Error('Da tao tran chung ket truoc do');

  const pendingGroup = db.prepare(
    `SELECT COUNT(*) as c FROM tournament_matches WHERE tournament_id = ? AND round_type = 'group' AND status != 'completed'`
  ).get(tournamentId).c;
  if (pendingGroup > 0) throw new Error('Con tran vong bang chua nhap ket qua');

  const standings = db.prepare(`
    SELECT id, total_points, points_diff, seed_elo
    FROM tournament_participants
    WHERE tournament_id = ?
    ORDER BY total_points DESC, points_diff DESC, seed_elo DESC, id ASC
  `).all(tournamentId);

  const insertMatch = db.prepare(`
    INSERT INTO tournament_matches
      (tournament_id, round_type, group_id, match_no, team_a_player1, team_a_player2, team_b_player1, team_b_player2, status)
    VALUES (?, ?, NULL, 1, ?, ?, ?, ?, 'pending')
  `);

  const finalists = standings.slice(0, 4);
  const consolation = standings.length >= 8 ? standings.slice(4, 8) : null;

  const tx = db.transaction(() => {
    if (finalists.length === 4) {
      insertMatch.run(tournamentId, 'final', finalists[0].id, finalists[3].id, finalists[1].id, finalists[2].id);
    }
    if (consolation) {
      insertMatch.run(tournamentId, 'consolation', consolation[0].id, consolation[3].id, consolation[1].id, consolation[2].id);
    }
  });
  tx();

  return { finalists, consolation };
}

/**
 * Sau khi chung ket (+ tranh hang 5, neu co) hoan tat: gan final_rank ca nhan cho moi
 * nguoi (hang 1-2 = doi thang chung ket, hang 3-4 = doi thua chung ket, hang 5-6 = doi
 * thang tranh hang 5, hang 7-8 = doi thua tranh hang 5, hang 9 tro xuong lay theo
 * total_points vong bang). Trong 1 doi 2 nguoi cung ket qua, thu tu 1-2 (hoac 3-4, 5-6,
 * 7-8) giua 2 dong doi duoc phan biet bang total_points/points_diff/seed_elo vong bang.
 * Set status='completed'.
 * @param {import('better-sqlite3').Database} db
 * @param {number} tournamentId
 */
function finalizeTournament(db, tournamentId) {
  const finalMatch = db.prepare(
    `SELECT * FROM tournament_matches WHERE tournament_id = ? AND round_type = 'final'`
  ).get(tournamentId);
  if (!finalMatch || finalMatch.status !== 'completed') {
    throw new Error('Chua co ket qua tran chung ket');
  }
  const consolationMatch = db.prepare(
    `SELECT * FROM tournament_matches WHERE tournament_id = ? AND round_type = 'consolation'`
  ).get(tournamentId);
  if (consolationMatch && consolationMatch.status !== 'completed') {
    throw new Error('Chua co ket qua tran tranh hang 5');
  }

  const setRank = db.prepare(`UPDATE tournament_participants SET final_rank = ? WHERE id = ?`);
  const getStanding = db.prepare(
    `SELECT id, total_points, points_diff, seed_elo FROM tournament_participants WHERE id = ?`
  );

  // 2 nguoi cung 1 doi trong 1 tran co ket qua giong het nhau nen khong the phan biet
  // bang tran dau do - dung total_points/points_diff/seed_elo tu vong bang de xep hang
  // giua 2 dong doi, dam bao ra dung 1 thu tu ca nhan 1..N, khop voi PDF ("hang 5-8" la
  // rieng cua tranh hang 5, khong trung voi hang 3-4 cua chung ket).
  function orderPairByStanding(idA, idB) {
    const a = getStanding.get(idA);
    const b = getStanding.get(idB);
    if (a.total_points !== b.total_points) return a.total_points > b.total_points ? [idA, idB] : [idB, idA];
    if (a.points_diff !== b.points_diff) return a.points_diff > b.points_diff ? [idA, idB] : [idB, idA];
    return a.seed_elo >= b.seed_elo ? [idA, idB] : [idB, idA];
  }

  const tx = db.transaction(() => {
    const finalAWon = finalMatch.score_a >= finalMatch.score_b;
    const winnerPair = finalAWon
      ? [finalMatch.team_a_player1, finalMatch.team_a_player2]
      : [finalMatch.team_b_player1, finalMatch.team_b_player2];
    const loserPair = finalAWon
      ? [finalMatch.team_b_player1, finalMatch.team_b_player2]
      : [finalMatch.team_a_player1, finalMatch.team_a_player2];

    const [w1, w2] = orderPairByStanding(winnerPair[0], winnerPair[1]);
    setRank.run(1, w1);
    setRank.run(2, w2);
    const [l1, l2] = orderPairByStanding(loserPair[0], loserPair[1]);
    setRank.run(3, l1);
    setRank.run(4, l2);

    let nextRank = 5;
    if (consolationMatch) {
      const consAWon = consolationMatch.score_a >= consolationMatch.score_b;
      const cWinnerPair = consAWon
        ? [consolationMatch.team_a_player1, consolationMatch.team_a_player2]
        : [consolationMatch.team_b_player1, consolationMatch.team_b_player2];
      const cLoserPair = consAWon
        ? [consolationMatch.team_b_player1, consolationMatch.team_b_player2]
        : [consolationMatch.team_a_player1, consolationMatch.team_a_player2];

      const [cw1, cw2] = orderPairByStanding(cWinnerPair[0], cWinnerPair[1]);
      setRank.run(5, cw1);
      setRank.run(6, cw2);
      const [cl1, cl2] = orderPairByStanding(cLoserPair[0], cLoserPair[1]);
      setRank.run(7, cl1);
      setRank.run(8, cl2);
      nextRank = 9;
    }

    const alreadyRanked = db.prepare(
      `SELECT id FROM tournament_participants WHERE tournament_id = ? AND final_rank IS NOT NULL`
    ).all(tournamentId).map((r) => r.id);

    const placeholders = alreadyRanked.length > 0 ? alreadyRanked.map(() => '?').join(',') : 'NULL';
    const rest = db.prepare(`
      SELECT id FROM tournament_participants
      WHERE tournament_id = ? AND id NOT IN (${placeholders})
      ORDER BY total_points DESC, points_diff DESC, seed_elo DESC, id ASC
    `).all(tournamentId, ...alreadyRanked);

    for (const r of rest) {
      setRank.run(nextRank, r.id);
      nextRank++;
    }

    db.prepare(`UPDATE tournaments SET status = 'completed' WHERE id = ?`).run(tournamentId);
  });
  tx();
}

/**
 * Danh sach tat ca giai dau, moi giai kem so nguoi tham gia.
 * @param {import('better-sqlite3').Database} db
 */
function listTournaments(db) {
  return db.prepare(`
    SELECT t.*, COUNT(tp.id) as participant_count
    FROM tournaments t
    LEFT JOIN tournament_participants tp ON tp.tournament_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `).all();
}

/**
 * Chi tiet 1 giai dau: thong tin giai, cac bang (kem thanh vien + tran vong bang),
 * bang xep hang toan giai (song song dung cho standings truc tiep va ket qua chung cuoc),
 * va tran chung ket/tranh hang 5 (neu da tao).
 * @param {import('better-sqlite3').Database} db
 * @param {number} tournamentId
 */
function getTournamentDetail(db, tournamentId) {
  const tournament = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(tournamentId);
  if (!tournament) return null;

  const groups = db.prepare(`
    SELECT id, group_label, group_order FROM tournament_groups WHERE tournament_id = ? ORDER BY group_order
  `).all(tournamentId);

  const memberRows = db.prepare(`
    SELECT gm.group_id, gm.group_seed, tp.id as participant_id, tp.seed_elo, tp.seed_rank,
           tp.total_points, tp.points_diff, tp.final_rank, u.full_name, u.avatar, u.username
    FROM tournament_group_members gm
    JOIN tournament_participants tp ON tp.id = gm.participant_id
    JOIN users u ON u.id = tp.user_id
    WHERE tp.tournament_id = ?
    ORDER BY gm.group_id, gm.group_seed
  `).all(tournamentId);

  const matchRows = db.prepare(`
    SELECT m.*,
      ua1.full_name as a1_name, ua2.full_name as a2_name,
      ub1.full_name as b1_name, ub2.full_name as b2_name
    FROM tournament_matches m
    JOIN tournament_participants pa1 ON pa1.id = m.team_a_player1
    JOIN users ua1 ON ua1.id = pa1.user_id
    JOIN tournament_participants pa2 ON pa2.id = m.team_a_player2
    JOIN users ua2 ON ua2.id = pa2.user_id
    JOIN tournament_participants pb1 ON pb1.id = m.team_b_player1
    JOIN users ub1 ON ub1.id = pb1.user_id
    JOIN tournament_participants pb2 ON pb2.id = m.team_b_player2
    JOIN users ub2 ON ub2.id = pb2.user_id
    WHERE m.tournament_id = ?
    ORDER BY m.group_id, m.match_no
  `).all(tournamentId);

  const groupsWithMembers = groups.map((g) => ({
    ...g,
    members: memberRows.filter((m) => m.group_id === g.id),
    matches: matchRows.filter((m) => m.round_type === 'group' && m.group_id === g.id),
  }));

  const standings = db.prepare(`
    SELECT tp.id, tp.seed_elo, tp.seed_rank, tp.total_points, tp.points_diff, tp.final_rank,
           u.full_name, u.avatar, u.username
    FROM tournament_participants tp
    JOIN users u ON u.id = tp.user_id
    WHERE tp.tournament_id = ?
    ORDER BY (tp.final_rank IS NULL), tp.final_rank ASC, tp.total_points DESC, tp.points_diff DESC, tp.seed_elo DESC
  `).all(tournamentId);

  const finalMatch = matchRows.find((m) => m.round_type === 'final') || null;
  const consolationMatch = matchRows.find((m) => m.round_type === 'consolation') || null;

  return { tournament, groups: groupsWithMembers, standings, finalMatch, consolationMatch };
}

module.exports = {
  snakeSeed,
  generateSeededGroups,
  swapParticipants,
  confirmAndGenerateSchedule,
  applyMatchResult,
  generateFinalMatches,
  finalizeTournament,
  listTournaments,
  getTournamentDetail,
};
