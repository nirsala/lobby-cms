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
db.pragma('foreign_keys = ON');

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

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT    NOT NULL,
    color      TEXT    DEFAULT '#ffffff',
    font_size  INTEGER DEFAULT 28,
    active     INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rss_config (
    id      INTEGER PRIMARY KEY DEFAULT 1,
    sources TEXT    DEFAULT '["ynet_all"]',
    speed   INTEGER DEFAULT 30,
    enabled INTEGER DEFAULT 1
  );
  INSERT OR IGNORE INTO rss_config (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS music_config (
    id      INTEGER PRIMARY KEY DEFAULT 1,
    genre   TEXT    DEFAULT 'lounge',
    volume  INTEGER DEFAULT 30,
    enabled INTEGER DEFAULT 1
  );
  INSERT OR IGNORE INTO music_config (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS music_files (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT NOT NULL,
    original   TEXT,
    sort_order INTEGER DEFAULT 0,
    active     INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Seed default settings
const defaults = {
  display_title    : 'ברוכים הבאים',
  building_address : '',
  logo_filename : '',
  message_scroll_speed: '72',
};
const insertSetting = db.prepare(
  `INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)`
);
for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);

// Migrate old default values to updated defaults
db.prepare(`UPDATE settings SET value='72' WHERE key='message_scroll_speed' AND value='40'`).run();

// ── Helpers ──────────────────────────────────────────────────────
const get  = (table, where = '', params = []) =>
  db.prepare(`SELECT * FROM ${table}${where ? ' WHERE ' + where : ''}`).all(...params);

const getOne = (table, where, params) =>
  db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...params);

const run = (sql, params = []) => db.prepare(sql).run(...params);

module.exports = { db, get, getOne, run };
