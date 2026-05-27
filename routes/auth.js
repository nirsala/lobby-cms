/**
 * routes/auth.js — User authentication (username + password)
 */
const express = require('express');
const crypto  = require('crypto');
const { db, seedUserDefaults } = require('../db');

const router  = express.Router();

const sessions    = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (now > v.expiresAt) sessions.delete(k);
  }
}, 10 * 60 * 1000);

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// POST /api/auth/login  { username, password }
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'הזן שם משתמש וסיסמא' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'שם משתמש או סיסמא שגויים' });

  const hash = hashPassword(password, user.salt);
  if (hash !== user.password) return res.status(401).json({ error: 'שם משתמש או סיסמא שגויים' });

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, username: user.username, expiresAt: Date.now() + SESSION_TTL });

  res.json({ token, username: user.username });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  sessions.delete(token);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ ok: true, username: session.username, userId: session.userId });
});

// POST /api/auth/create-user  { username, password }
router.post('/create-user', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'שם משתמש וסיסמא נדרשים' });
  if (password.length < 4) return res.status(400).json({ error: 'סיסמא חייבת להכיל לפחות 4 תווים' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'שם משתמש כבר קיים' });

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const info = db.prepare('INSERT INTO users(username, password, salt) VALUES (?, ?, ?)').run(username, hash, salt);

  seedUserDefaults(info.lastInsertRowid);

  res.json({ ok: true, id: info.lastInsertRowid, username });
});

// GET /api/auth/users — list all users
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, username, created_at FROM users').all();
  res.json(users);
});

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.userId = session.userId;
  req.username = session.username;
  next();
}

module.exports = { router, requireAuth };
