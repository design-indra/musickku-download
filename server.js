const express = require('express');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*' }));
app.use(express.json());

const TMP_DIR = '/tmp/musickku-dl';
const COOKIES_FILE = '/tmp/yt-cookies.txt';

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Tulis cookies dari env ke file
if (process.env.YT_COOKIES) {
  fs.writeFileSync(COOKIES_FILE, process.env.YT_COOKIES);
  console.log('✅ YouTube cookies loaded from environment');
} else {
  console.warn('⚠️  YT_COOKIES not set - downloads may fail');
}

// Cleanup tmp setiap 15 menit
setInterval(() => {
  try {
    fs.readdirSync(TMP_DIR).forEach(f => {
      const fp = path.join(TMP_DIR, f);
      try { if (Date.now() - fs.statSync(fp).mtimeMs > 10*60*1000) fs.unlinkSync(fp); } catch {}
    });
  } catch {}
}, 15*60*1000);

// ── HEALTH ────────────────────────────────────────────────
app.get('/', (req, res) => {
  const ytdlp = spawnSync('yt-dlp', ['--version']);
  res.json({
    status: 'ok',
    app: 'MusicKu Download API',
    version: '1.1.0',
    ytdlp: ytdlp.status === 0 ? ytdlp.stdout.toString().trim() : 'NOT FOUND',
    cookies: fs.existsSync(COOKIES_FILE) ? 'loaded' : 'missing'
  });
});

// ── DOWNLOAD → MP3 ────────────────────────────────────────
const jobs = {};

app.post('/api/download', (req, res) => {
  const { videoId, title } = req.body;
  if (!videoId || !isValidId(videoId)) return res.status(400).json({ error: 'videoId tidak valid' });

  const safeTitle = (title || videoId).replace(/[^\w\s\-]/g, '').trim().slice(0, 80) || videoId;
  const jobId = `${videoId}_${Date.now()}`;
  const outTemplate = path.join(TMP_DIR, `${jobId}.%(ext)s`);

  jobs[jobId] = { status: 'downloading', percent: 0, title: safeTitle, videoId };
  console.log(`[DOWNLOAD] Start: ${safeTitle}`);

  const args = [
    '--no-warnings', '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android,web',
    '-f', 'bestaudio/best',
    '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '-o', outTemplate,
  ];

  // Pakai cookies kalau ada
  if (fs.existsSync(COOKIES_FILE)) {
    args.push('--cookies', COOKIES_FILE);
  }

  args.push(`https://youtube.com/watch?v=${videoId}`);

  const proc = spawn('yt-dlp', args);

  let output = '';
  proc.stdout.on('data', d => {
    output += d.toString();
    const m = output.match(/(\d+\.?\d*)%/g);
    if (m) jobs[jobId].percent = parseFloat(m[m.length - 1]);
  });
  proc.stderr.on('data', d => { output += d.toString(); });
  proc.on('close', code => {
    if (code === 0) {
      const files = fs.readdirSync(TMP_DIR).filter(f => f.startsWith(jobId));
      if (files.length > 0) {
        jobs[jobId] = { ...jobs[jobId], status: 'done', percent: 100, file: files[0] };
        console.log(`[DOWNLOAD] Done: ${files[0]}`);
      } else {
        jobs[jobId] = { ...jobs[jobId], status: 'error', message: 'File tidak ditemukan' };
      }
    } else {
      jobs[jobId] = { ...jobs[jobId], status: 'error', message: output.slice(-300) };
      console.error(`[DOWNLOAD] Failed (${code})`);
    }
    setTimeout(() => {
      try { if (jobs[jobId]?.file) fs.unlinkSync(path.join(TMP_DIR, jobs[jobId].file)); } catch {}
      delete jobs[jobId];
    }, 10*60*1000);
  });

  res.json({ jobId, message: 'Download dimulai' });
});

app.get('/api/download/progress/:jobId', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ status: 'not_found' });
  res.json(job);
});

app.get('/api/download/file/:jobId', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const job = jobs[req.params.jobId];
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'File belum siap' });
  const filePath = path.join(TMP_DIR, job.file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File tidak ada' });
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent((job.title || 'lagu') + '.mp3')}`);
  res.setHeader('Content-Length', fs.statSync(filePath).size);
  res.sendFile(filePath);
});

function isValidId(id) { return /^[a-zA-Z0-9_-]{11}$/.test(id); }

app.listen(PORT, () => console.log(`\n⬇️  MusicKu Download API v1.1 — Port:${PORT}\n`));
