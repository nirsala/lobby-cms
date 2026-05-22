/**
 * routes/auth.js — Authentication via Xibo OAuth2 Authorization Code flow
 */
const express = require('express');
const crypto  = require('crypto');
const fetch   = require('node-fetch');

const router  = express.Router();

// In-memory session store: token → { xiboToken, expiresAt }
const sessions = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(token);
  }
}, 10 * 60 * 1000);

function getXiboConfig() {
  const url = (process.env.XIBO_URL || '').replace(/\/+$/, '');
  return {
    url,
    clientId     : process.env.XIBO_CLIENT_ID || '',
    clientSecret : process.env.XIBO_CLIENT_SECRET || '',
    redirectUri  : `${url.replace('https://', 'http://').split('/')[0]}//${url.split('//')[1]?.split('/')[0]?.replace(':443', '')}`,
  };
}

function getRedirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/auth/callback`;
}

// GET /api/auth/login — redirect to Xibo login page
router.get('/login', (req, res) => {
  const cfg   = getXiboConfig();
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = getRedirectUri(req);

  // Store state temporarily to verify on callback
  res.cookie('xibo_state', state, { httpOnly: true, maxAge: 300000, sameSite: 'lax' });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id    : cfg.clientId,
    redirect_uri : redirectUri,
    state,
  });

  res.redirect(`${cfg.url}/api/authorize?${params}`);
});

// GET /api/auth/callback — Xibo redirects back here with ?code=...
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const cfg = getXiboConfig();
  const redirectUri = getRedirectUri(req);

  if (!code) {
    return res.redirect('/admin/?error=' + encodeURIComponent(req.query.error || 'no_code'));
  }

  try {
    const tokenRes = await fetch(cfg.url + '/api/authorize/access_token', {
      method : 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body   : new URLSearchParams({
        grant_type   : 'authorization_code',
        code,
        client_id    : cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri : redirectUri,
      }),
      timeout: 10000,
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Xibo token exchange failed:', err);
      return res.redirect('/admin/?error=auth_failed');
    }

    const data = await tokenRes.json();
    const sessionToken = crypto.randomBytes(32).toString('hex');

    sessions.set(sessionToken, {
      xiboToken: data.access_token,
      expiresAt: Date.now() + SESSION_TTL,
    });

    res.redirect(`/admin/?token=${sessionToken}`);
  } catch (e) {
    console.error('Auth callback error:', e.message);
    res.redirect('/admin/?error=connection_failed');
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
  res.json({ ok: true });
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
  next();
}

module.exports = { router, requireAuth, sessions };
