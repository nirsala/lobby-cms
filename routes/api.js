/**
 * routes/api.js — REST API for the admin panel
 */
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const fetch    = require('node-fetch');
const xml2js   = require('xml2js');
const { HDate, months } = require('@hebcal/core');
const { db, get, getOne, run } = require('../db');

const router   = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── RSS source catalog ──────────────────────────────────────────
const RSS_SOURCES = {
  ynet_all     : { name: 'Ynet — כל הידיעות',   url: 'https://www.ynet.co.il/Integration/StoryRss2.xml' },
  ynet_breaking: { name: 'Ynet — חדשות אחרונות', url: 'https://www.ynet.co.il/Integration/StoryRss1854.xml' },
  ynet_economy : { name: 'Ynet — כלכלה',         url: 'https://www.ynet.co.il/Integration/StoryRss6.xml' },
  ynet_sports  : { name: 'Ynet — ספורט',          url: 'https://www.ynet.co.il/Integration/StoryRss3.xml' },
  ynet_tech    : { name: 'Ynet — טכנולוגיה',      url: 'https://www.ynet.co.il/Integration/StoryRss544.xml' },
  walla_news   : { name: 'Walla — חדשות',         url: 'https://rss.walla.co.il/feed/1?type=main' },
  walla_sports : { name: 'Walla — ספורט',         url: 'https://rss.walla.co.il/feed/3?type=main' },
  walla_finance: { name: 'Walla — כלכלה',         url: 'https://rss.walla.co.il/feed/2?type=main' },
  walla_tech   : { name: 'Walla — טק',            url: 'https://rss.walla.co.il/feed/6?type=main' },
  mako_news    : { name: 'Mako — חדשות ישראל',    url: 'https://rcs.mako.co.il/rss/news-israel.xml' },
  maariv_all   : { name: 'מעריב — כל הידיעות',    url: 'https://www.maariv.co.il/rss/rssfeedsallnews' },
  maariv_break : { name: 'מעריב — חדשות אחרונות', url: 'https://www.maariv.co.il/rss/rssfeedsmivzakichadashot' },
};

// ── Music genres ────────────────────────────────────────────────
const MUSIC_GENRES = {
  off      : { name: 'ללא מוזיקה',      url: null },
  lounge   : { name: 'לאונג׳ ואמביינט', url: 'https://streams.ilovemusic.de/iloveradio17.mp3' },
  jazz     : { name: 'ג׳אז קלאסי',      url: 'https://streaming.live365.com/a21891' },
  classical: { name: 'מוזיקה קלאסית',   url: 'http://live.musopen.org:8085/streamvbr0' },
  israeli  : { name: 'פופ ישראלי',       url: 'http://glzwizzardnew.glz.co.il:8100/;stream/1' },
  nature   : { name: 'צלילי טבע',        url: 'https://stream.live365.com/a72659' },
  custom   : { name: 'URL מותאם אישית', url: null },
};

// ── RSS cache ───────────────────────────────────────────────────
let rssCache = { items: [], ts: 0 };
const RSS_TTL = 60 * 60 * 1000; // 1 hour

async function fetchRss(sourceKeys) {
  if (Date.now() - rssCache.ts < RSS_TTL && rssCache.items.length) return rssCache.items;
  const keys = sourceKeys.length ? sourceKeys : ['ynet_all'];
  const items = [];
  await Promise.all(keys.map(async key => {
    const src = RSS_SOURCES[key];
    if (!src) return;
    try {
      const res = await fetch(src.url, { timeout: 8000 });
      const xml = await res.text();
      const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
      const channel = parsed?.rss?.channel;
      const rawItems = channel?.item || [];
      const arr = Array.isArray(rawItems) ? rawItems : [rawItems];
      arr.slice(0, 10).forEach(i => {
        const title = typeof i.title === 'string' ? i.title : i.title?._ || '';
        if (title) items.push(title.trim());
      });
    } catch (e) {
      console.warn(`RSS fetch failed for ${key}:`, e.message);
    }
  }));
  rssCache = { items: items.slice(0, 10), ts: Date.now() };
  return rssCache.items;
}

// ── Hebrew date helper ──────────────────────────────────────────
const HEB_MONTHS = ['ניסן','אייר','סיוון','תמוז','אב','אלול','תשרי','חשוון','כסלו','טבת','שבט','אדר','אדר ב׳'];
const HEB_NUMS   = ['','א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ז׳','ח׳','ט׳','י׳','י"א','י"ב','י"ג','י"ד','ט"ו','ט"ז','י"ז','י"ח','י"ט','כ׳','כ"א','כ"ב','כ"ג','כ"ד','כ"ה','כ"ו','כ"ז','כ"ח','כ"ט','ל׳'];

function getHebrewDate() {
  try {
    const h = new HDate(new Date());
    const day   = h.getDate();
    const month = h.getMonth(); // 1-based Nissan=1 ... Adar2=14
    const monthName = HEB_MONTHS[month - 1] || '';
    return `${HEB_NUMS[day] || day} ${monthName}`;
  } catch {
    return '';
  }
}

// ── Multer setup ────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    cb(null, base + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/(jpeg|png|gif|webp|bmp)|video\/(mp4|webm)|audio\/(mpeg|mp4|ogg|wav|aac|x-m4a)/.test(file.mimetype);
    cb(null, ok);
  }
});

// ══════════════════════════════════════════
//  DISPLAY STATE  (called by display page)
// ══════════════════════════════════════════
router.get('/display/state', async (req, res) => {
  const now        = new Date();
  const timeStr    = now.toTimeString().slice(0, 5); // HH:MM
  const dateStr    = now.toLocaleDateString('he-IL', { weekday:'long', year:'numeric', month:'2-digit', day:'2-digit' });
  const dayName    = now.toLocaleDateString('he-IL', { weekday:'long' });
  const hebDate    = getHebrewDate();
  const fullDate   = now.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });

  // Active media — filter by date/time
  const media = db.prepare(`
    SELECT * FROM media WHERE active=1
    AND (start_date IS NULL OR start_date='' OR start_date <= ?)
    AND (end_date   IS NULL OR end_date=''   OR end_date   >= ?)
    ORDER BY sort_order, id
  `).all(now.toISOString().slice(0,10), now.toISOString().slice(0,10));

  // Time-filtered
  const activeMedia = media.filter(m => {
    if (!m.start_time && !m.end_time) return true;
    if (m.start_time && m.end_time) return timeStr >= m.start_time && timeStr <= m.end_time;
    return true;
  });

  const messages  = db.prepare(`SELECT * FROM messages WHERE active=1 ORDER BY sort_order, id`).all();
  const rssCfg    = db.prepare(`SELECT * FROM rss_config WHERE id=1`).get();
  const musicCfg  = db.prepare(`SELECT * FROM music_config WHERE id=1`).get();
  const musicFiles = db.prepare(`SELECT * FROM music_files WHERE active=1 ORDER BY sort_order, id`).all();
  const settingsRows = db.prepare(`SELECT * FROM settings`).all();
  const settings  = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

  let selectedSources = [];
  try { selectedSources = JSON.parse(rssCfg?.sources || '[]'); } catch {}
  const rssItems = rssCfg?.enabled ? await fetchRss(selectedSources) : [];

  const genre = MUSIC_GENRES[musicCfg?.genre] || MUSIC_GENRES.off;
  const musicUrl = musicCfg?.genre === 'custom'
    ? (settings.music_custom_url || null)
    : genre.url;

  res.json({
    clock: { time: now.toTimeString().slice(0,8), date: fullDate, day: dayName, hebrew: hebDate },
    media: activeMedia.map(m => ({ ...m, url: '/uploads/' + m.filename })),
    messages: messages,
    message_speed: parseInt(settings.message_scroll_speed) || 40,
    rss: { items: rssItems, speed: rssCfg?.speed || 60, enabled: !!rssCfg?.enabled },
    music: {
      enabled: !!musicCfg?.enabled,
      volume: musicCfg?.volume || 30,
      files: musicFiles.map(f => ({ id: f.id, url: '/uploads/' + f.filename, original: f.original })),
    },
    settings,
  });
});

// ══════════════════════════════════════════
//  MEDIA
// ══════════════════════════════════════════
router.get('/media', (req, res) => {
  res.json(db.prepare(`SELECT * FROM media ORDER BY sort_order, id`).all());
});

router.post('/media', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { title, start_date, end_date, start_time, end_time, duration, sort_order } = req.body;
  const stmt = db.prepare(`
    INSERT INTO media(filename, original, title, start_date, end_date, start_time, end_time, duration, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  const info = stmt.run(req.file.filename, req.file.originalname, title || req.file.originalname,
    start_date||null, end_date||null, start_time||null, end_time||null,
    parseInt(duration)||10, parseInt(sort_order)||0);
  res.json({ id: info.lastInsertRowid, filename: req.file.filename });
});

router.put('/media/:id', (req, res) => {
  const { title, start_date, end_date, start_time, end_time, duration, sort_order, active } = req.body;
  db.prepare(`
    UPDATE media SET title=?, start_date=?, end_date=?, start_time=?, end_time=?, duration=?, sort_order=?, active=?
    WHERE id=?
  `).run(title, start_date||null, end_date||null, start_time||null, end_time||null,
    parseInt(duration)||10, parseInt(sort_order)||0, active?1:0, req.params.id);
  res.json({ ok: true });
});

router.delete('/media/:id', (req, res) => {
  const row = db.prepare(`SELECT filename FROM media WHERE id=?`).get(req.params.id);
  if (row) {
    const fp = path.join(UPLOAD_DIR, row.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare(`DELETE FROM media WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

router.post('/media/reorder', (req, res) => {
  const { order } = req.body; // [{id, sort_order}]
  const stmt = db.prepare(`UPDATE media SET sort_order=? WHERE id=?`);
  (order || []).forEach(({ id, sort_order }) => stmt.run(sort_order, id));
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  MESSAGES
// ══════════════════════════════════════════
router.get('/messages', (req, res) => {
  res.json(db.prepare(`SELECT * FROM messages ORDER BY sort_order, id`).all());
});

router.post('/messages', (req, res) => {
  const { text, color, font_size, sort_order } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const info = db.prepare(`INSERT INTO messages(text,color,font_size,sort_order) VALUES(?,?,?,?)`)
    .run(text.trim(), color||'#ffffff', parseInt(font_size)||28, parseInt(sort_order)||0);
  res.json({ id: info.lastInsertRowid });
});

router.put('/messages/:id', (req, res) => {
  const { text, color, font_size, active, sort_order } = req.body;
  db.prepare(`UPDATE messages SET text=?,color=?,font_size=?,active=?,sort_order=? WHERE id=?`)
    .run(text, color||'#ffffff', parseInt(font_size)||28, active?1:0, parseInt(sort_order)||0, req.params.id);
  res.json({ ok: true });
});

router.delete('/messages/:id', (req, res) => {
  db.prepare(`DELETE FROM messages WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  RSS
// ══════════════════════════════════════════
router.get('/rss/sources', (req, res) => res.json(RSS_SOURCES));

router.get('/rss/config', (req, res) => {
  const cfg = db.prepare(`SELECT * FROM rss_config WHERE id=1`).get();
  try { cfg.sources = JSON.parse(cfg.sources); } catch { cfg.sources = []; }
  res.json(cfg);
});

router.put('/rss/config', (req, res) => {
  const { sources, speed, enabled } = req.body;
  db.prepare(`UPDATE rss_config SET sources=?,speed=?,enabled=? WHERE id=1`)
    .run(JSON.stringify(sources||[]), parseInt(speed)||60, enabled?1:0);
  rssCache.ts = 0; // invalidate cache
  res.json({ ok: true });
});

router.get('/rss/preview', async (req, res) => {
  const cfg = db.prepare(`SELECT sources FROM rss_config WHERE id=1`).get();
  let keys = [];
  try { keys = JSON.parse(cfg?.sources||'[]'); } catch {}
  rssCache.ts = 0;
  const items = await fetchRss(keys);
  res.json({ items });
});

// ══════════════════════════════════════════
//  MUSIC
// ══════════════════════════════════════════
router.get('/music/genres', (req, res) => res.json(MUSIC_GENRES));

router.get('/music/config', (req, res) => {
  res.json(db.prepare(`SELECT * FROM music_config WHERE id=1`).get());
});

router.put('/music/config', (req, res) => {
  const { genre, volume, enabled } = req.body;
  db.prepare(`UPDATE music_config SET genre=?,volume=?,enabled=? WHERE id=1`)
    .run(genre||'off', parseInt(volume)||30, enabled?1:0);
  res.json({ ok: true });
});

router.get('/music/files', (req, res) => {
  res.json(db.prepare(`SELECT * FROM music_files ORDER BY sort_order, id`).all());
});

router.post('/music/files', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const info = db.prepare(`INSERT INTO music_files(filename, original) VALUES(?,?)`)
    .run(req.file.filename, req.file.originalname);
  res.json({ id: info.lastInsertRowid, filename: req.file.filename });
  broadcast();
});

router.delete('/music/files/:id', (req, res) => {
  const row = db.prepare(`SELECT filename FROM music_files WHERE id=?`).get(req.params.id);
  if (row) {
    const fp = path.join(UPLOAD_DIR, row.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.prepare(`DELETE FROM music_files WHERE id=?`).run(req.params.id);
  }
  res.json({ ok: true });
  broadcast();
});

// ══════════════════════════════════════════
//  SETTINGS & LOGO
// ══════════════════════════════════════════
router.get('/settings', (req, res) => {
  const rows = db.prepare(`SELECT * FROM settings`).all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/settings', (req, res) => {
  const stmt = db.prepare(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`);
  for (const [k, v] of Object.entries(req.body)) stmt.run(k, String(v));
  res.json({ ok: true });
});

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname,'..','public','uploads')),
    filename: (req, file, cb) => cb(null, 'logo' + path.extname(file.originalname))
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /image/.test(file.mimetype))
});

router.post('/logo', logoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  db.prepare(`INSERT OR REPLACE INTO settings(key,value) VALUES('logo_filename',?)`)
    .run(req.file.filename);
  res.json({ filename: req.file.filename });
});

// ══════════════════════════════════════════
//  SERVER-SENT EVENTS (real-time update signal)
// ══════════════════════════════════════════
const sseClients = new Set();

router.get('/events', (req, res) => {
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
  res.flushHeaders();
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'connected' });
  sseClients.add(send);
  req.on('close', () => sseClients.delete(send));
});

function broadcast(type, payload = {}) {
  for (const send of sseClients) send({ type, ...payload });
}

router.use((req, res, next) => {
  if (['POST','PUT','DELETE'].includes(req.method)) {
    res.on('finish', () => { if (res.statusCode < 300) broadcast('update'); });
  }
  next();
});

module.exports = { router, MUSIC_GENRES, broadcast };
