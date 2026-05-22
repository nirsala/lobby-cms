/**
 * routes/xibo.js — Xibo CMS integration
 * Uses the logged-in user's Xibo token from the session
 */
const express = require('express');
const fetch   = require('node-fetch');

const router  = express.Router();

function getBaseUrl() {
  return (process.env.XIBO_URL || '').replace(/\/+$/, '');
}

async function xibo(method, path, body, token) {
  const base = getBaseUrl() + '/api';
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  };
  if (body) opts.body = new URLSearchParams(body);
  const res  = await fetch(base + path, opts);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

// GET /api/xibo/status
router.get('/status', async (req, res) => {
  if (!getBaseUrl())
    return res.json({ connected: false, error: 'Xibo URL not configured' });
  try {
    const r = await xibo('GET', '/about', null, req.xiboToken);
    res.json({ connected: true, version: r.data?.version || 'unknown' });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

// POST /api/xibo/push
router.post('/push', async (req, res) => {
  if (!getBaseUrl())
    return res.status(400).json({ error: 'Xibo URL not configured' });

  const displayUrl = req.body.display_url || `${req.protocol}://${req.headers.host}/display/`;
  const layoutName = req.body.layout_name || 'Pixel Lobby CMS';
  const token      = req.xiboToken;

  try {
    let layoutId = req.body.layout_id ? parseInt(req.body.layout_id) : null;
    let playlistId;

    if (!layoutId) {
      const cr = await xibo('POST', '/layout', {
        name: layoutName, width: 1920, height: 1080, backgroundColor: '#000000',
      }, token);
      if (!cr.ok) throw new Error(`Create layout failed: ${JSON.stringify(cr.data)}`);
      layoutId   = cr.data.layoutId;
      playlistId = cr.data.regions?.[0]?.playlists?.[0]?.playlistId;
    } else {
      const layout = await xibo('GET', `/layout/${layoutId}`, null, token);
      if (!layout.ok) throw new Error(`Get layout failed: ${layout.status}`);
      playlistId = layout.data?.regions?.[0]?.playlists?.[0]?.playlistId;
    }

    if (!playlistId) throw new Error('Could not find playlist in layout');

    const wRes = await xibo('POST', `/playlist/${playlistId}/widget`, {
      type: 'webpage', duration: 86400, useDuration: 1,
      uri: displayUrl, modeId: 1, scaling: 1,
    }, token);

    if (!wRes.ok) throw new Error(`Widget add failed: ${JSON.stringify(wRes.data)}`);

    res.json({
      ok: true, layoutId, widgetId: wRes.data?.widgetId,
      displayUrl, message: `Layout #${layoutId} updated in Xibo`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/xibo/displays
router.get('/displays', async (req, res) => {
  if (!getBaseUrl()) return res.json([]);
  try {
    const r = await xibo('GET', '/display', null, req.xiboToken);
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
