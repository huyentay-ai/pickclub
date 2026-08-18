const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'club.db'));

function log(userId, action, detail, ip) {
  db.prepare('INSERT INTO activity_logs (user_id, action, detail, ip) VALUES (?, ?, ?, ?)').run(userId, action, detail || null, ip || null);
}

function logMiddleware(action, detailFn) {
  return (req, res, next) => {
    const origRedirect = res.redirect.bind(res);
    res.redirect = function(url) {
      const userId = req.session.user ? req.session.user.id : null;
      const detail = detailFn ? detailFn(req) : null;
      const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      log(userId, action, detail, ip);
      origRedirect(url);
    };
    next();
  };
}

module.exports = { log, logMiddleware };
