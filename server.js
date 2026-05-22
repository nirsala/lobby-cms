/**
 * server.js — Pixel Lobby CMS
 * מערכת ניהול תוכן ללובי עם אינטגרציית Xibo
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { router: apiRouter } = require('./routes/api');
const xiboRouter = require('./routes/xibo');
const { router: authRouter, requireAuth } = require('./routes/auth');

const app  = express();
const PORT = process.env.PORT || 3400;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/display', express.static(path.join(__dirname, 'public', 'display')));
app.use('/admin',   express.static(path.join(__dirname, 'public', 'admin')));
app.use('/assets',  express.static(path.join(__dirname, 'public', 'assets')));

// Public API routes (no auth required)
app.use('/api/auth', authRouter);

// Auth gate — skip for public endpoints, require for everything else
const PUBLIC_PATHS = ['/display/state', '/events', '/rss/preview'];
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next('route');
  if (PUBLIC_PATHS.includes(req.path)) return next();
  requireAuth(req, res, next);
});

// All API routes (auth already checked above)
app.use('/api', apiRouter);
app.use('/api/xibo', xiboRouter);

// Root → admin panel
app.get('/', (req, res) => res.redirect('/admin/'));

app.listen(PORT, () => {
  console.log(`\n🖥️  Pixel Lobby CMS פועל על http://localhost:${PORT}`);
  console.log(`   פאנל ניהול : http://localhost:${PORT}/admin/`);
  console.log(`   מסך תצוגה  : http://localhost:${PORT}/display/`);
  console.log(`   API        : http://localhost:${PORT}/api/\n`);
});
