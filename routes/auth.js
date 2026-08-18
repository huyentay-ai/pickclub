const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'club.db'));
db.pragma('foreign_keys = ON');
const { log } = require('./logger');

// Login page
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/teams');
  res.render('login', { error: null });
});

// Login submit
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  if (!user || user.password !== password) {
    log(null, 'login_failed', `username: ${username}`, ip);
    return res.render('login', { error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
  }

  log(user.id, 'login', null, ip);
  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    avatar: user.avatar,
    is_admin: user.is_admin
  };
  res.redirect('/teams');
});

// Logout
router.get('/logout', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  if (req.session.user) log(req.session.user.id, 'logout', null, ip);
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Change password page
router.get('/change-password', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('change-password', { error: null, success: null });
});

// Change password submit
router.post('/change-password', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { current_password, new_password, confirm_password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (user.password !== current_password) {
    return res.render('change-password', { error: 'Mật khẩu hiện tại không đúng', success: null });
  }
  if (!new_password || new_password.length < 4) {
    return res.render('change-password', { error: 'Mật khẩu mới phải có ít nhất 4 ký tự', success: null });
  }
  if (new_password !== confirm_password) {
    return res.render('change-password', { error: 'Mật khẩu xác nhận không khớp', success: null });
  }

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(new_password, user.id);
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  log(user.id, 'change_password', null, ip);
  res.render('change-password', { error: null, success: 'Đổi mật khẩu thành công!' });
});

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
