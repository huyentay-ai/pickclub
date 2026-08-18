// Preview data + renderers for the dark athletic theme preview pages.
// Mirrors the EJS loops with the seeded club data.
(function () {
  var AV = '../../../assets/athletes/';
  var M = {
    hung: { username: 'hung', full_name: 'Lý Ngọc Hưng', avatar: AV + 'hung.png', is_admin: true },
    nam: { username: 'nam', full_name: 'Nam Nguyễn', avatar: AV + 'nam.png' },
    kien: { username: 'kien', full_name: 'Nguyễn Trọng Kiên', avatar: AV + 'kien.png' },
    binh: { username: 'binh', full_name: 'Trần Văn Bình', avatar: AV + 'binh.png' },
    tu: { username: 'tu', full_name: 'Lê Bá Tứ', avatar: AV + 'tu.png' },
    anh_dao: { username: 'anh_dao', full_name: 'Anh Đạo', avatar: AV + 'anh_dao.png' },
    dung: { username: 'dung', full_name: 'Trịnh Dũng', avatar: AV + 'dung.png', is_admin: true },
    tung: { username: 'tung', full_name: 'Tùng Nguyễn', avatar: AV + 'tung.jpg' },
    thinh: { username: 'thinh', full_name: 'Đào Tùng Thịnh', avatar: AV + 'thinh.png' },
    ngocanh: { username: 'ngocanh', full_name: 'Ngọc Anh', avatar: AV + 'ngocanh.png' },
    viet: { username: 'viet', full_name: 'Nguyễn Văn Việt', avatar: AV + 'viet.png' },
    thang: { username: 'thang', full_name: 'Nguyễn Văn Thắng', avatar: AV + 'thang.png' },
    thi_dao: { username: 'thi_dao', full_name: 'Thị Đào', avatar: AV + 'thi_dao.png' },
  };
  var MEMBERS = Object.keys(M).map(function (k) { return M[k]; });

  var TEAMS = [
    { id: 1, name: 'Hưng & Kiên', type: 'male', status: 'active', members: [M.hung, M.kien] },
    { id: 2, name: 'Nam & Tứ', type: 'male', status: 'active', members: [M.nam, M.tu] },
    { id: 3, name: 'Anh Đạo & Thị Đào', type: 'female', status: 'active', members: [M.anh_dao, M.thi_dao] },
    { id: 4, name: 'Dũng & Tùng', type: 'male', status: 'active', members: [M.dung, M.tung] },
    { id: 5, name: 'Thịnh & Ngọc Anh', type: 'mixed', status: 'active', members: [M.thinh, M.ngocanh] },
    { id: 6, name: 'Việt & Thắng', type: 'male', status: 'pending', members: [M.viet, M.thang] },
    { id: 7, name: 'Bình & Hưng', type: 'male', status: 'active', members: [M.binh, M.hung] },
  ];

  var MATCHES = [
    { id: 1, challenger: TEAMS[0], challenged: TEAMS[1], scores: '11-7, 11-9', reward: 'Phở bò', date: '08/07', time: '6:00', winner: 'Hưng & Kiên', status: 'completed' },
    { id: 2, challenger: TEAMS[2], challenged: TEAMS[4], scores: null, reward: 'Bánh mì chảo', date: '15/07', time: '6:00', winner: null, status: 'scheduled' },
    { id: 3, challenger: TEAMS[3], challenged: TEAMS[5], scores: '9-11, 11-6, 11-8', reward: 'Bún chả', date: '05/07', time: '6:30', winner: 'Dũng & Tùng', status: 'completed' },
    { id: 4, challenger: TEAMS[6], challenged: TEAMS[2], scores: null, reward: 'Cơm rang', date: '18/07', time: '5:45', winner: null, status: 'scheduled' },
  ];

  var LEADERBOARD = [
    { m: M.hung, matches: 14, points: 6 },
    { m: M.dung, matches: 12, points: 4 },
    { m: M.kien, matches: 14, points: 6 },
    { m: M.tung, matches: 12, points: 4 },
    { m: M.nam, matches: 9, points: -2 },
    { m: M.tu, matches: 9, points: -2 },
    { m: M.anh_dao, matches: 6, points: 1 },
    { m: M.thi_dao, matches: 6, points: 1 },
    { m: M.viet, matches: 5, points: -3 },
    { m: M.thang, matches: 5, points: -3 },
  ];

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content;
  }

  function avatarImgs(members, cls) {
    return members.map(function (m) {
      return '<img src="' + m.avatar + '" alt="' + m.full_name + '" title="' + m.full_name + '" class="' + cls + '">';
    }).join('');
  }

  function matchRowHTML(c, withAvatars) {
    var av1 = withAvatars ? '<div class="match-team-avatars">' + avatarImgs(c.challenger.members, 'match-avatar') + '</div>' : '';
    var av2 = withAvatars ? '<div class="match-team-avatars">' + avatarImgs(c.challenged.members, 'match-avatar') + '</div>' : '';
    var center = c.scores
      ? '<span class="match-score">' + c.scores + '</span><span class="badge badge-completed">Hoàn thành</span>'
      : '<span class="badge badge-scheduled">Đã lên lịch</span>';
    return '<div class="match-row">' +
      '<div class="match-team-side ' + (c.winner === c.challenger.name ? 'match-team-winner' : '') + '">' +
        av1 + '<span class="match-team-name">' + c.challenger.name + '</span>' +
      '</div>' +
      '<div class="match-center">' + center +
        '<span class="match-date">' + c.date + '</span>' +
        '<span class="match-reward"><span class="licon" data-lucide="soup"></span> ' + c.reward + '</span>' +
      '</div>' +
      '<div class="match-team-side match-team-right ' + (c.winner === c.challenged.name ? 'match-team-winner' : '') + '">' +
        av2 + '<span class="match-team-name">' + c.challenged.name + '</span>' +
      '</div>' +
    '</div>';
  }

  window.PreviewData = { MEMBERS: MEMBERS, TEAMS: TEAMS, MATCHES: MATCHES, LEADERBOARD: LEADERBOARD };

  window.PreviewRender = {
    heroAvatars: function (container) {
      container.innerHTML = MEMBERS.map(function (m, i) {
        return '<div class="hero-avatar-bubble" style="--i:' + i + '; --total:' + MEMBERS.length + '">' +
          '<img src="' + m.avatar + '" alt="' + m.full_name + '" title="' + m.full_name + '"></div>';
      }).join('');
    },
    ticker: function (container) {
      var items = '';
      for (var rep = 0; rep < 2; rep++) {
        MATCHES.forEach(function (m) {
          var txt = m.status === 'completed'
            ? '<strong>' + m.winner + '</strong> thắng — ' + m.challenger.name + ' vs ' + m.challenged.name + ' · ' + m.reward
            : '<strong>' + m.challenger.name + '</strong> vs <strong>' + m.challenged.name + '</strong> · ' + m.date + ' ' + m.time + ' · ' + m.reward;
          items += '<span class="ticker-item">' + txt + '</span><span class="ticker-sep">◆</span>';
        });
      }
      container.innerHTML = items;
    },
    recentMatches: function (container) {
      container.innerHTML = MATCHES.map(function (c) {
        return '<a href="#" class="challenge-card-mini" onclick="return false">' + matchRowHTML(c, true) + '</a>';
      }).join('');
    },
    leaderboardRows: function (tbody) {
      tbody.innerHTML = LEADERBOARD.map(function (e, i) {
        var rank = String(i + 1).padStart(2, '0');
        var rankHtml = i < 3 ? '<span class="rank-medal">' + rank + '</span>' : '<span class="rank-number">' + rank + '</span>';
        var pts = e.points > 0 ? '+' + e.points : String(e.points);
        var ptsCls = e.points > 0 ? 'points-negative' : 'points-positive';
        return '<tr class="' + (i < 3 ? 'top-' + (i + 1) : '') + '">' +
          '<td class="col-rank">' + rankHtml + '</td>' +
          '<td><img src="' + e.m.avatar + '" class="admin-table-avatar" alt=""></td>' +
          '<td><strong>' + e.m.full_name + '</strong> <span class="text-muted text-sm">@' + e.m.username + '</span></td>' +
          '<td class="col-stat">' + e.matches + '</td>' +
          '<td class="col-stat"><span class="stat-points ' + ptsCls + '">' + pts + '</span></td>' +
        '</tr>';
      }).join('');
    },
    results: function (container) {
      var html = '';
      var cur = '';
      MATCHES.filter(function (m) { return m.status === 'completed'; }).forEach(function (m) {
        if (m.date !== cur) { cur = m.date; html += '<div class="results-date-header">' + m.date + '</div>'; }
        html += '<div class="result-match-card">' + matchRowHTML(m, false) + '</div>';
      });
      container.innerHTML = html;
    },
    memberCards: function (container) {
      container.innerHTML = MEMBERS.map(function (m) {
        return '<a href="#" class="member-card" onclick="return false">' +
          '<img src="' + m.avatar + '" alt="' + m.full_name + '" class="member-avatar">' +
          '<h3 class="member-name">' + m.full_name + '</h3>' +
          '<p class="member-username">@' + m.username + '</p>' +
        '</a>';
      }).join('');
    },
    teamCards: function (container) {
      var typeLabel = { male: 'Nam', female: 'Nữ', mixed: 'Hỗn hợp' };
      var statusLabel = { active: 'Hoạt động', pending: 'Chờ duyệt' };
      container.innerHTML = TEAMS.map(function (t) {
        var chips = t.members.map(function (m) {
          return '<div class="team-member-chip">' +
            '<img src="' + m.avatar + '" alt="' + m.full_name + '" class="team-member-avatar">' +
            '<span class="team-member-name">' + m.full_name + '</span></div>';
        }).join('');
        return '<a href="#" class="team-card" onclick="return false">' +
          '<div class="team-card-header"><h3 class="team-name">' + t.name + '</h3>' +
          '<span class="badge badge-type-' + t.type + '">' + typeLabel[t.type] + '</span></div>' +
          '<div class="team-card-body"><div class="team-members-avatars">' + chips + '</div></div>' +
          '<div class="team-card-footer"><span class="badge badge-' + t.status + '">' + statusLabel[t.status] + '</span></div>' +
        '</a>';
      }).join('');
    },
    initIcons: function () {
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    },
  };
})();
