/**
 * db.js — SQLite schema & helpers (better-sqlite3)
 */
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'lobby.db'));
db.pragma('journal_mode = WAL');

// ── Users table ─────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    NOT NULL UNIQUE,
    password   TEXT    NOT NULL,
    salt       TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now'))
  );
`);

// ── Migration helper: add column if missing ─────────────────────
function addColumnIfMissing(table, col, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find(c => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
  }
}

// ── Media ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    filename     TEXT    NOT NULL,
    original     TEXT,
    title        TEXT,
    start_date   TEXT,
    end_date     TEXT,
    start_time   TEXT,
    end_time     TEXT,
    duration     INTEGER DEFAULT 10,
    sort_order   INTEGER DEFAULT 0,
    active       INTEGER DEFAULT 1,
    created_at   TEXT    DEFAULT (datetime('now'))
  );
`);
addColumnIfMissing('media', 'user_id', 'INTEGER NOT NULL DEFAULT 0');

// ── Messages ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT    NOT NULL,
    color      TEXT    DEFAULT \'#ffffff\',
    font_size  INTEGER DEFAULT 28,
    active     INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now'))
  );
`);
addColumnIfMissing('messages', 'user_id', 'INTEGER NOT NULL DEFAULT 0');

// ── Music files ─────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS music_files (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT NOT NULL,
    original   TEXT,
    sort_order INTEGER DEFAULT 0,
    active     INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
addColumnIfMissing('music_files', 'user_id', 'INTEGER NOT NULL DEFAULT 0');

// ── RSS config (migrate from singleton to per-user) ─────────────
const rssColsOld = db.prepare(`PRAGMA table_info(rss_config)`).all();
if (rssColsOld.length && !rssColsOld.find(c => c.name === 'user_id')) {
  const oldRow = db.prepare('SELECT * FROM rss_config WHERE id=1').get();
  db.exec('DROP TABLE rss_config');
  db.exec(`
    CREATE TABLE rss_config (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE DEFAULT 0,
      sources TEXT    DEFAULT '["ynet_all"]',
      speed   INTEGER DEFAULT 30,
      enabled INTEGER DEFAULT 1
    );
  `);
  if (oldRow) {
    db.prepare('INSERT INTO rss_config(user_id, sources, speed, enabled) VALUES(0,?,?,?)')
      .run(oldRow.sources, oldRow.speed, oldRow.enabled);
  }
} else if (!rssColsOld.length) {
  db.exec(`
    CREATE TABLE rss_config (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE DEFAULT 0,
      sources TEXT    DEFAULT '["ynet_all"]',
      speed   INTEGER DEFAULT 30,
      enabled INTEGER DEFAULT 1
    );
  `);
}

// ── Music config (migrate from singleton to per-user) ───────────
const musicColsOld = db.prepare(`PRAGMA table_info(music_config)`).all();
if (musicColsOld.length && !musicColsOld.find(c => c.name === 'user_id')) {
  const oldRow = db.prepare('SELECT * FROM music_config WHERE id=1').get();
  db.exec('DROP TABLE music_config');
  db.exec(`
    CREATE TABLE music_config (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE DEFAULT 0,
      genre   TEXT    DEFAULT 'lounge',
      volume  INTEGER DEFAULT 30,
      enabled INTEGER DEFAULT 1
    );
  `);
  if (oldRow) {
    db.prepare('INSERT INTO music_config(user_id, genre, volume, enabled) VALUES(0,?,?,?)')
      .run(oldRow.genre, oldRow.volume, oldRow.enabled);
  }
} else if (!musicColsOld.length) {
  db.exec(`
    CREATE TABLE music_config (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE DEFAULT 0,
      genre   TEXT    DEFAULT 'lounge',
      volume  INTEGER DEFAULT 30,
      enabled INTEGER DEFAULT 1
    );
  `);
}

// ── Settings (migrate from key-only PK to key+user_id PK) ───────
const settingsCols = db.prepare(`PRAGMA table_info(settings)`).all();
if (settingsCols.length && !settingsCols.find(c => c.name === 'user_id')) {
  const oldRows = db.prepare('SELECT * FROM settings').all();
  db.exec('DROP TABLE settings');
  db.exec(`
    CREATE TABLE settings (
      key     TEXT NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 0,
      value   TEXT,
      PRIMARY KEY (key, user_id)
    );
  `);
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key, user_id, value) VALUES(?, 0, ?)');
  for (const r of oldRows) ins.run(r.key, r.value);
} else if (!settingsCols.length) {
  db.exec(`
    CREATE TABLE settings (
      key     TEXT NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 0,
      value   TEXT,
      PRIMARY KEY (key, user_id)
    );
  `);
}

// ── Seed defaults ───────────────────────────────────────────────
const defaults = {
  display_title        : 'ברוכים הבאים',
  building_address     : '',
  logo_filename        : '',
  message_scroll_speed : '72',
};
const insertSetting = db.prepare(
  `INSERT OR IGNORE INTO settings(key, user_id, value) VALUES (?, 0, ?)`
);
for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);

function seedUserDefaults(userId) {
  const ins = db.prepare(`INSERT OR IGNORE INTO settings(key, user_id, value) VALUES (?, ?, ?)`);
  for (const [k, v] of Object.entries(defaults)) ins.run(k, userId, v);
  db.prepare(`INSERT OR IGNORE INTO rss_config(user_id) VALUES (?)`).run(userId);
  db.prepare(`INSERT OR IGNORE INTO music_config(user_id) VALUES (?)`).run(userId);
}

// ── Helpers ──────────────────────────────────────────────────────
const get  = (table, where = '', params = []) =>
  db.prepare(`SELECT * FROM ${table}${where ? ' WHERE ' + where : ''}`).all(...params);

const getOne = (table, where, params) =>
  db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...params);

const run = (sql, params = []) => db.prepare(sql).run(...params);

module.exports = { db, get, getOne, run, seedUserDefaults, defaults };
