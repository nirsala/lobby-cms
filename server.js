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

const app  = express();
const PORT = process.env.PORT || 3400;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files — uploads may live on a persistent disk (env override)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/display', express.static(path.join(__dirname, 'public', 'display')));
app.use('/admin',   express.static(path.join(__dirname, 'public', 'admin')));
app.use('/assets',  express.static(path.join(__dirname, 'public', 'assets')));

// API routes
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
