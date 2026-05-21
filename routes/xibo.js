/**
 * routes/xibo.js — Xibo CMS integration
 * Supports Xibo 3.x / 4.x REST API (OAuth2 client_credentials)
 */
const express = require('express');
const fetch   = require('node-fetch');
const { db }  = require('../db');

const router  = express.Router();
let xiboToken = null;
let tokenExpiry = 0;

function getSettings() {
  const rows = db.prepare(`SELECT * FROM settings`).all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function getToken(cfg) {
  if (xiboToken && Date.now() < tokenExpiry - 10000) return xiboToken;
  const url = cfg.xibo_url.replace(/\/$/, '') + '/api/authorize/access_token';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type   : 'client_credentials',
      client_id    : cfg.xibo_client_id,
      client_secret: cfg.xibo_client_secret,
    }),
    timeout: 10000,
  });
  if (!res.ok) throw new Error(`Xibo auth failed: ${res.status}`);
  const data = await res.json();
  xiboToken  = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return xiboToken;
}

async function xibo(method, path, body, cfg) {
  const token = await getToken(cfg);
  const base  = cfg.xibo_url.replace(/\/$/, '') + '/api';
  const opts  = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  };
  if (body) opts.body = new URLSearchParams(body);
  const res = await fetch(base + path, opts);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

// GET /api/xibo/status — test connection
router.get('/status', async (req, res) => {
  const cfg = getSettings();
  if (!cfg.xibo_url || !cfg.xibo_client_id || !cfg.xibo_client_secret)
    return res.json({ connected: false, error: 'Xibo credentials not configured' });
  try {
    await getToken(cfg);
    const r = await xibo('GET', '/about', null, cfg);
    res.json({ connected: true, version: r.data?.version || 'unknown' });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

// POST /api/xibo/push — create or update a Xibo layout with a Webpage widget
// pointing to the local display URL
router.post('/push', async (req, res) => {
  const cfg = getSettings();
  if (!cfg.xibo_url || !cfg.xibo_client_id || !cfg.xibo_client_secret)
    return res.status(400).json({ error: 'Xibo credentials not configured' });

  const displayUrl = req.body.display_url || `${req.protocol}://${req.headers.host}/display/`;

  try {
    let layoutId = cfg.xibo_layout_id ? parseInt(cfg.xibo_layout_id) : null;
    let playlistId;

    if (!layoutId) {
      // Create new layout
      const cr = await xibo('POST', '/layout', {
        name: 'Pixel Lobby CMS',
        width: 1920, height: 1080,
        backgroundColor: '#000000',
        backgroundImageId: null,
      }, cfg);
      if (!cr.ok) throw new Error(`Create layout failed: ${JSON.stringify(cr.data)}`);
      layoutId   = cr.data.layoutId;
      playlistId = cr.data.regions?.[0]?.playlists?.[0]?.playlistId;

      // Save layout ID
      db.prepare(`INSERT OR REPLACE INTO settings(key,value) VALUES('xibo_layout_id',?)`)
        .run(String(layoutId));
    } else {
      // Get existing layout's first region playlist
      const layout = await xibo('GET', `/layout/${layoutId}`, null, cfg);
      if (!layout.ok) throw new Error(`Get layout failed: ${layout.status}`);
      playlistId = layout.data?.regions?.[0]?.playlists?.[0]?.playlistId;
    }

    if (!playlistId) throw new Error('Could not find playlist in layout');

    // Add / replace webpage widget
    const wRes = await xibo('POST', `/playlist/${playlistId}/widget`, {
      type    : 'webpage',
      duration: 86400,
      useDuration: 1,
      uri     : displayUrl,
      modeId  : 1,  // open natively
      scaling : 1,
    }, cfg);

    if (!wRes.ok) throw new Error(`Widget add failed: ${JSON.stringify(wRes.data)}`);

    res.json({
      ok: true,
      layoutId,
      widgetId : wRes.data?.widgetId,
      displayUrl,
      message  : `Layout #${layoutId} updated in Xibo`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/xibo/displays — list displays
router.get('/displays', async (req, res) => {
  const cfg = getSettings();
  try {
    const r = await xibo('GET', '/display', null, cfg);
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
