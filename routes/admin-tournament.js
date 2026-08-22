const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');
const ExcelJS = require('exceljs');
const { requireAuth } = require('./auth');
const { log } = require('./logger');
const {
  generateSeededGroups,
  swapParticipants,
  confirmAndGenerateSchedule,
  applyMatchResult,
  generateFinalMatches,
  finalizeTournament,
  listTournaments,
  getTournamentDetail,
} = require('../lib/tournament');

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

// Danh sach giai dau (admin)
router.get('/', (req, res) => {
  const tournaments = listTournaments(db);
  res.render('admin/tournament/index', { tournaments });
});

// Form tao giai dau moi
router.get('/create', (req, res) => {
  const users = db.prepare('SELECT id, username, full_name, avatar FROM users ORDER BY full_name').all();
  res.render('admin/tournament/create', { users });
});

// Tao giai dau moi: luu ten + danh sach nguoi tham gia
router.post('/create', (req, res) => {
  const { name, event_date } = req.body;
  let participantIds = req.body.participants || [];
  if (!Array.isArray(participantIds)) participantIds = [participantIds];
  participantIds = participantIds.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id));

  if (!name || !name.trim()) {
    req.session.flash = { type: 'error', message: 'Vui lòng nhập tên giải đấu' };
    return res.redirect('/admin/tournament/create');
  }
  if (participantIds.length === 0 || participantIds.length % 4 !== 0) {
    req.session.flash = { type: 'error', message: `Số người tham gia phải là bội số của 4 (hiện chọn ${participantIds.length} người)` };
    return res.redirect('/admin/tournament/create');
  }

  let tournamentId;
  const tx = db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO tournaments (name, event_date, created_by) VALUES (?, ?, ?)`
    ).run(name.trim(), event_date || null, req.session.user.id);
    tournamentId = result.lastInsertRowid;

    const insertParticipant = db.prepare(
      `INSERT INTO tournament_participants (tournament_id, user_id) VALUES (?, ?)`
    );
    for (const userId of participantIds) {
      insertParticipant.run(tournamentId, userId);
    }
  });
  tx();

  log(req.session.user.id, 'create_tournament', `${name} · ${participantIds.length} người`, getIp(req));
  req.session.flash = { type: 'success', message: 'Đã tạo giải đấu, tiến hành chia bảng...' };
  res.redirect(`/admin/tournament/${tournamentId}/seed`);
});

// Xem/chia bang (auto-seed lan dau, sau do cho phep sua tay)
router.get('/:id/seed', (req, res) => {
  const tournamentId = req.params.id;
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) {
    req.session.flash = { type: 'error', message: 'Giải đấu không tồn tại' };
    return res.redirect('/admin/tournament');
  }

  if (tournament.status === 'draft') {
    try {
      generateSeededGroups(db, tournamentId);
    } catch (err) {
      req.session.flash = { type: 'error', message: `Không thể chia bảng: ${err.message}` };
      return res.redirect('/admin/tournament');
    }
  }

  const detail = getTournamentDetail(db, tournamentId);
  res.render('admin/tournament/seed', detail);
});

// Hoan doi cho cua 2 nguoi choi giua 2 bang
router.post('/:id/seed/swap', (req, res) => {
  const tournamentId = req.params.id;
  const { participant_id, swap_with_id } = req.body;

  try {
    swapParticipants(db, participant_id, swap_with_id);
    req.session.flash = { type: 'success', message: 'Đã đổi chỗ' };
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
  }
  res.redirect(`/admin/tournament/${tournamentId}/seed`);
});

// Chot bang, sinh lich vong bang
router.post('/:id/confirm', (req, res) => {
  const tournamentId = req.params.id;
  try {
    confirmAndGenerateSchedule(db, tournamentId);
    log(req.session.user.id, 'confirm_tournament_schedule', `tournament #${tournamentId}`, getIp(req));
    req.session.flash = { type: 'success', message: 'Đã chốt bảng đấu và sinh lịch thi đấu!' };
    return res.redirect(`/admin/tournament/${tournamentId}/matches`);
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
    return res.redirect(`/admin/tournament/${tournamentId}/seed`);
  }
});

// Danh sach tran vong bang + nhap diem
router.get('/:id/matches', (req, res) => {
  const detail = getTournamentDetail(db, req.params.id);
  if (!detail) {
    req.session.flash = { type: 'error', message: 'Giải đấu không tồn tại' };
    return res.redirect('/admin/tournament');
  }
  res.render('admin/tournament/matches', detail);
});

// Nhap diem 1 tran vong bang
router.post('/:id/matches/:matchId/score', (req, res) => {
  const tournamentId = req.params.id;
  const scoreA = parseInt(req.body.score_a, 10);
  const scoreB = parseInt(req.body.score_b, 10);

  if (Number.isNaN(scoreA) || Number.isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
    req.session.flash = { type: 'error', message: 'Điểm số không hợp lệ' };
    return res.redirect(`/admin/tournament/${tournamentId}/matches`);
  }

  try {
    applyMatchResult(db, req.params.matchId, scoreA, scoreB);
    log(req.session.user.id, 'enter_tournament_score', `match #${req.params.matchId}: ${scoreA}-${scoreB}`, getIp(req));
    req.session.flash = { type: 'success', message: 'Đã lưu kết quả trận đấu' };
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
  }
  res.redirect(`/admin/tournament/${tournamentId}/matches`);
});

// Chot vong bang, tao tran chung ket (+ tranh hang 5 neu du nguoi)
router.post('/:id/finalize-groups', (req, res) => {
  const tournamentId = req.params.id;
  try {
    generateFinalMatches(db, tournamentId);
    log(req.session.user.id, 'generate_tournament_final', `tournament #${tournamentId}`, getIp(req));
    req.session.flash = { type: 'success', message: 'Đã tạo trận chung kết!' };
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
  }
  res.redirect(`/admin/tournament/${tournamentId}/final`);
});

// Xem/nhap diem chung ket + tranh hang 5
router.get('/:id/final', (req, res) => {
  const detail = getTournamentDetail(db, req.params.id);
  if (!detail) {
    req.session.flash = { type: 'error', message: 'Giải đấu không tồn tại' };
    return res.redirect('/admin/tournament');
  }
  res.render('admin/tournament/final', detail);
});

// Nhap diem tran chung ket / tranh hang 5
router.post('/:id/final/:matchId/score', (req, res) => {
  const tournamentId = req.params.id;
  const scoreA = parseInt(req.body.score_a, 10);
  const scoreB = parseInt(req.body.score_b, 10);

  if (Number.isNaN(scoreA) || Number.isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
    req.session.flash = { type: 'error', message: 'Điểm số không hợp lệ' };
    return res.redirect(`/admin/tournament/${tournamentId}/final`);
  }

  try {
    applyMatchResult(db, req.params.matchId, scoreA, scoreB);
    log(req.session.user.id, 'enter_tournament_final_score', `match #${req.params.matchId}: ${scoreA}-${scoreB}`, getIp(req));

    const finalMatch = db.prepare(
      `SELECT * FROM tournament_matches WHERE tournament_id = ? AND round_type = 'final'`
    ).get(tournamentId);
    const consolationMatch = db.prepare(
      `SELECT * FROM tournament_matches WHERE tournament_id = ? AND round_type = 'consolation'`
    ).get(tournamentId);

    const allDone = finalMatch?.status === 'completed' && (!consolationMatch || consolationMatch.status === 'completed');
    if (allDone) {
      finalizeTournament(db, tournamentId);
      log(req.session.user.id, 'complete_tournament', `tournament #${tournamentId}`, getIp(req));
      req.session.flash = { type: 'success', message: 'Giải đấu đã hoàn tất! Xếp hạng chung cuộc đã được chốt.' };
    } else {
      req.session.flash = { type: 'success', message: 'Đã lưu kết quả' };
    }
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
  }
  res.redirect(`/admin/tournament/${tournamentId}/final`);
});

const ROUND_TYPE_LABEL = { group: 'Vòng bảng', final: 'Chung kết', consolation: 'Tranh hạng 5' };

// Xuat file Excel: danh sach bang dau + danh sach tran dau cua giai dau
router.get('/:id/export', async (req, res) => {
  const detail = getTournamentDetail(db, req.params.id);
  if (!detail) {
    req.session.flash = { type: 'error', message: 'Giải đấu không tồn tại' };
    return res.redirect('/admin/tournament');
  }
  const { tournament, groups, finalMatch, consolationMatch } = detail;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pick Club Admin';
  workbook.created = new Date();

  // Sheet 1: Bang dau (danh sach bang + thanh vien, sap theo hat giong trong bang)
  const groupsSheet = workbook.addWorksheet('Bảng đấu');
  groupsSheet.columns = [
    { header: 'Bảng', key: 'group_label', width: 10 },
    { header: 'Hạt giống', key: 'group_seed', width: 12 },
    { header: 'Họ và tên', key: 'full_name', width: 26 },
    { header: 'Elo hạt giống', key: 'seed_elo', width: 14 },
    { header: 'Điểm tích lũy', key: 'total_points', width: 14 },
    { header: 'Hiệu số', key: 'points_diff', width: 12 },
    { header: 'Hạng chung cuộc', key: 'final_rank', width: 16 },
  ];
  groupsSheet.getRow(1).font = { bold: true };
  groups.forEach((g) => {
    g.members.forEach((m) => groupsSheet.addRow({
      group_label: g.group_label,
      group_seed: m.group_seed,
      full_name: m.full_name,
      seed_elo: Math.round(m.seed_elo),
      total_points: m.total_points,
      points_diff: m.points_diff,
      final_rank: m.final_rank ?? '',
    }));
  });

  // Sheet 2: Lich thi dau (vong bang + chung ket + tranh hang 5)
  const matchesSheet = workbook.addWorksheet('Lịch thi đấu');
  matchesSheet.columns = [
    { header: 'Trận', key: 'match_no', width: 8 },
    { header: 'Vòng', key: 'round_label', width: 14 },
    { header: 'Bảng', key: 'group_label', width: 10 },
    { header: 'Đội 1', key: 'team_a', width: 30 },
    { header: 'Đội 2', key: 'team_b', width: 30 },
    { header: 'Tỉ số', key: 'score', width: 12 },
    { header: 'Trạng thái', key: 'status', width: 14 },
  ];
  matchesSheet.getRow(1).font = { bold: true };
  let rowNo = 1;
  groups.forEach((g) => {
    g.matches.forEach((m) => {
      matchesSheet.addRow({
        match_no: rowNo++,
        round_label: ROUND_TYPE_LABEL[m.round_type] || m.round_type,
        group_label: g.group_label,
        team_a: `${m.a1_name} & ${m.a2_name}`,
        team_b: `${m.b1_name} & ${m.b2_name}`,
        score: m.status === 'completed' ? `${m.score_a}-${m.score_b}` : '',
        status: m.status === 'completed' ? 'Đã đấu' : 'Chưa đấu',
      });
    });
  });
  [finalMatch, consolationMatch].forEach((m) => {
    if (!m) return;
    matchesSheet.addRow({
      match_no: rowNo++,
      round_label: ROUND_TYPE_LABEL[m.round_type] || m.round_type,
      group_label: '-',
      team_a: `${m.a1_name} & ${m.a2_name}`,
      team_b: `${m.b1_name} & ${m.b2_name}`,
      score: m.status === 'completed' ? `${m.score_a}-${m.score_b}` : '',
      status: m.status === 'completed' ? 'Đã đấu' : 'Chưa đấu',
    });
  });

  log(req.session.user.id, 'export_tournament_excel', `${tournament.name} · ${groupsSheet.rowCount - 1} người, ${matchesSheet.rowCount - 1} trận`, getIp(req));

  const filename = `giai-dau-${tournament.id}-${tournament.name.replace(/[^a-zA-Z0-9]+/g, '-')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});

// Xoa giai dau (chi khi chua active/completed)
router.post('/:id/delete', (req, res) => {
  const tournamentId = req.params.id;
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) {
    req.session.flash = { type: 'error', message: 'Giải đấu không tồn tại' };
    return res.redirect('/admin/tournament');
  }
  if (!['draft', 'seeded'].includes(tournament.status)) {
    req.session.flash = { type: 'error', message: 'Không thể xóa giải đấu đã bắt đầu thi đấu' };
    return res.redirect('/admin/tournament');
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tournament_matches WHERE tournament_id = ?').run(tournamentId);
    db.prepare(`DELETE FROM tournament_group_members WHERE group_id IN (SELECT id FROM tournament_groups WHERE tournament_id = ?)`).run(tournamentId);
    db.prepare('DELETE FROM tournament_groups WHERE tournament_id = ?').run(tournamentId);
    db.prepare('DELETE FROM tournament_participants WHERE tournament_id = ?').run(tournamentId);
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(tournamentId);
  });
  tx();

  log(req.session.user.id, 'delete_tournament', `${tournament.name} (#${tournamentId})`, getIp(req));
  req.session.flash = { type: 'success', message: 'Đã xóa giải đấu' };
  res.redirect('/admin/tournament');
});

module.exports = router;
