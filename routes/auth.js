/**
 * routes/auth.js — Authentication via Xibo credentials
 */
const express = require('express');
const crypto  = require('crypto');
const fetch   = require('node-fetch');

const router  = express.Router();

// In-memory session store: token → { username, xiboToken, expiresAt }
const sessions = new Map();

const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

function cleanExpired() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(token);
  }
}
setInterval(cleanExpired, 10 * 60 * 1000);

function getXiboConfig() {
  return {
    url          : (process.env.XIBO_URL || '').replace(/\/+$/, ''),
    clientId     : process.env.XIBO_CLIENT_ID || '',
    clientSecret : process.env.XIBO_CLIENT_SECRET || '',
  };
}

// POST /api/auth/login  { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'שם משתמש וסיסמא נדרשים' });

  const cfg = getXiboConfig();
  if (!cfg.url || !cfg.clientId || !cfg.clientSecret)
    return res.status(500).json({ error: 'Xibo לא מוגדר בשרת' });

  try {
    const authRes = await fetch(cfg.url + '/api/authorize/access_token', {
      method : 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body   : new URLSearchParams({
        grant_type   : 'password',
        client_id    : cfg.clientId,
        client_secret: cfg.clientSecret,
        username,
        password,
      }),
      timeout: 10000,
    });

    if (!authRes.ok) {
      const text = await authRes.text();
      if (authRes.status === 401 || authRes.status === 400)
        return res.status(401).json({ error: 'שם משתמש או סיסמא שגויים' });
      return res.status(502).json({ error: 'שגיאת חיבור ל-Xibo' });
    }

    const data = await authRes.json();
    const sessionToken = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionToken, {
      username,
      xiboToken: data.access_token,
      expiresAt: Date.now() + SESSION_TTL,
    });

    res.json({ token: sessionToken, username });
  } catch (e) {
    res.status(502).json({ error: 'לא ניתן להתחבר ל-Xibo: ' + e.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  sessions.delete(token);
  res.json({ ok: true });
});

// GET /api/auth/me — check session validity
router.get('/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ username: session.username });
});

// Middleware: protect routes behind auth
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.xiboToken = session.xiboToken;
  req.xiboUser  = session.username;
  next();
}

module.exports = { router, requireAuth, sessions };
