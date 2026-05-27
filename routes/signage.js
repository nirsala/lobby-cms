/**
 * routes/signage.js — Integration with digital signage CMS
 * Uses client_credentials from env vars
 */
const express = require('express');
const fetch   = require('node-fetch');

const router  = express.Router();
let cachedToken = null;
let tokenExpiry = 0;

function getBaseUrl() {
  return (process.env.XIBO_URL || '').replace(/\/+$/, '');
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 10000) return cachedToken;

  const base = getBaseUrl();
  const res = await fetch(base + '/api/authorize/access_token', {
    method : 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body   : new URLSearchParams({
      grant_type   : 'client_credentials',
      client_id    : process.env.XIBO_CLIENT_ID || '',
      client_secret: process.env.XIBO_CLIENT_SECRET || '',
    }),
    timeout: 10000,
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data  = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function apiCall(method, path, body) {
  const token = await getToken();
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  };
  if (body) opts.body = new URLSearchParams(body);
  const res  = await fetch(getBaseUrl() + '/api' + path, opts);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

router.get('/status', async (req, res) => {
  if (!getBaseUrl()) return res.json({ connected: false, error: 'Not configured' });
  try {
    await getToken();
    const r = await apiCall('GET', '/about');
    res.json({ connected: true, version: r.data?.version || 'unknown' });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

router.post('/push', async (req, res) => {
  if (!getBaseUrl()) return res.status(400).json({ error: 'Not configured' });
  const displayUrl = req.body.display_url || `${req.protocol}://${req.headers.host}/display/`;
  const layoutName = req.body.layout_name || 'Pixel Lobby CMS';
  try {
    let layoutId = req.body.layout_id ? parseInt(req.body.layout_id) : null;
    let playlistId;
    if (!layoutId) {
      const cr = await apiCall('POST', '/layout', {
        name: layoutName, width: 1920, height: 1080, backgroundColor: '#000000',
      });
      if (!cr.ok) throw new Error(`Create layout failed: ${JSON.stringify(cr.data)}`);
      layoutId   = cr.data.layoutId;
      playlistId = cr.data.regions?.[0]?.playlists?.[0]?.playlistId;
    } else {
      const layout = await apiCall('GET', `/layout/${layoutId}`);
      if (!layout.ok) throw new Error(`Get layout failed: ${layout.status}`);
      playlistId = layout.data?.regions?.[0]?.playlists?.[0]?.playlistId;
    }
    if (!playlistId) throw new Error('Could not find playlist in layout');
    const wRes = await apiCall('POST', `/playlist/${playlistId}/widget`, {
      type: 'webpage', duration: 86400, useDuration: 1,
      uri: displayUrl, modeId: 1, scaling: 1,
    });
    if (!wRes.ok) throw new Error(`Widget add failed: ${JSON.stringify(wRes.data)}`);
    res.json({ ok: true, layoutId, widgetId: wRes.data?.widgetId, displayUrl,
      message: `Layout #${layoutId} updated` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/displays', async (req, res) => {
  if (!getBaseUrl()) return res.json([]);
  try {
    const r = await apiCall('GET', '/display');
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
