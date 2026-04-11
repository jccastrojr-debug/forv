const express = require('express');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { fetchAllPapers } = require('./fetcher');
const { synthesizePapers, generateCrossDomainLinks } = require('./synthesizer');

const app = express();
// Rate limiting
const refreshLimiter = new Map();
const REFRESH_LIMIT = 3;
const REFRESH_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds
const PORT = process.env.PORT || 8080;

// Store latest synthesis in memory
let latestCards = [];
let latestLinks = [];
let lastUpdated = null;
let isGenerating = false;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint — feed cards
// Feedback endpoint
app.use(express.json());
app.post('/api/feedback', (req, res) => {
  const { name, email, message } = req.body;
  console.log('--- FEEDBACK RECEIVED ---');
  console.log(`From: ${name} <${email}>`);
  console.log(`Message: ${message}`);
  console.log('-------------------------');
  res.json({ success: true });
});

app.get('/api/cards', (req, res) => {
  res.json({
    cards: latestCards,
    links: latestLinks,
    lastUpdated,
    isGenerating,
    paperCount: latestCards.length
  });
});

// API endpoint — trigger manual refresh
// Privacy policy page
app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — FORV.</title>
  <style>
    body { background:#0a0a0a; color:#ccc; font-family:monospace; font-size:13px; line-height:1.9; max-width:600px; margin:60px auto; padding:0 24px; }
    h1 { font-family:'Syne',sans-serif; color:#00ff88; font-size:18px; letter-spacing:0.1em; margin-bottom:40px; }
    h2 { font-size:13px; color:#fff; margin-top:32px; letter-spacing:0.05em; }
    a { color:#00ff88; text-decoration:none; }
    .back { display:inline-block; margin-bottom:40px; font-size:11px; letter-spacing:0.1em; border-bottom:1px solid #00ff88; }
  </style>
</head>
<body>
  <a href="/" class="back">← FORV.</a>
  <h1>PRIVACY POLICY</h1>
  <p>FORV. does not collect, store, or share personal data.</p>
  <p>The feedback form accepts optional messages to help improve the platform. These messages are not linked to any identifying information and are reviewed only by the FORV. team.</p>
  <p>No cookies are used. No tracking scripts are loaded. No analytics are collected.</p>
  <p>FORV. is a free tool built to surface scientific research. It has no commercial interest in your data.</p>
  <p>If you have questions, contact us through the feedback form.</p>
  <p style="margin-top:48px; opacity:0.5;">Last updated: April 2026</p>
</body>
</html>`);
});
app.get('/api/refresh', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const record = refreshLimiter.get(ip) || { count: 0, start: now };

  if (now - record.start > REFRESH_WINDOW) {
    record.count = 0;
    record.start = now;
  }

  if (record.count >= REFRESH_LIMIT) {
    return res.status(429).json({ status: 'rate limited', message: 'Maximum 3 refreshes per hour.' });
  }

  record.count++;
  refreshLimiter.set(ip, record);

  if (isGenerating) {
    return res.json({ status: 'already running' });
  }
  res.json({ status: 'started' });
  runPipeline();
});

// API endpoint — status
app.get('/api/status', (req, res) => {
  res.json({
    status: isGenerating ? 'generating' : 'ready',
    lastUpdated,
    cardCount: latestCards.length
  });
});

// Main pipeline
async function runPipeline() {
  if (isGenerating) return;
  isGenerating = true;
  console.log('\n--- FORV Pipeline starting ---');

  try {
    const papers = await fetchAllPapers();

    if (!papers.length) {
      console.log('No papers fetched — aborting synthesis');
      isGenerating = false;
      return;
    }

    const cards = await synthesizePapers(papers);
    const links = await generateCrossDomainLinks(cards);

    latestCards = cards;
    latestLinks = links;
    lastUpdated = new Date().toISOString();

    // Save to disk so it survives server restart
    const cache = { cards, links, lastUpdated };
    fs.writeFileSync('./cache.json', JSON.stringify(cache, null, 2));

    console.log(`Pipeline complete — ${cards.length} cards, ${links.length} cross-domain links`);
  } catch (err) {
    console.error('Pipeline error:', err.message);
  }

  isGenerating = false;
}

// Load cache on startup if it exists
function loadCache() {
  try {
    if (fs.existsSync('./cache.json')) {
      const cache = JSON.parse(fs.readFileSync('./cache.json'));
      latestCards = cache.cards || [];
      latestLinks = cache.links || [];
      lastUpdated = cache.lastUpdated || null;
      console.log(`Loaded ${latestCards.length} cards from cache`);
    }
  } catch {
    console.log('No cache found — will generate on first run');
  }
}

// Schedule daily refresh at 6am
cron.schedule('0 6 * * *', () => {
  console.log('Scheduled daily synthesis running...');
  runPipeline();
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FORV running at http://0.0.0.0:${PORT}`);
  loadCache();

  // Run pipeline immediately on first start if no cache
  if (!latestCards.length) {
    console.log('No cache found — running initial synthesis now...');
    runPipeline();
  }
});
