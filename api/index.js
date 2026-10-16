const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../lib/db');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

const COOKIE = 'admin_token';
const COOKIE_PATH = '/api';
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SECTIONS = ['home', 'about', 'skills', 'projects', 'education', 'contact'];

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (v) => String(v == null ? '' : v).trim();
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET must be set (16+ characters)');
  return s;
}

function limiter(windowMs, limit, error) {
  return rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error } });
}

function requireAdmin(req, res, next) {
  try {
    jwt.verify(req.cookies[COOKIE] || '', secret(), { algorithms: ['HS256'] });
    next();
  } catch (err) {
    if (/JWT_SECRET/.test(err.message)) return next(err);
    res.status(401).json({ error: 'Please log in.' });
  }
}

function startSession(res) {
  const token = jwt.sign({ role: 'admin' }, secret(), { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: COOKIE_PATH
  });
  res.json({ ok: true });
}

app.use('/api/admin', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

/* ---------- public: contact form ---------- */
app.post(
  '/api/messages',
  limiter(10 * 60 * 1000, 5, 'Too many messages. Please try again in a few minutes.'),
  wrap(async (req, res) => {
    const body = req.body || {};
    if (clean(body.website)) return res.json({ ok: true }); // honeypot: bots fill this in

    const name = clean(body.name);
    const email = clean(body.email);
    const message = clean(body.message);

    if (!name || !email || !message) return res.status(400).json({ error: 'Please fill in all fields.' });
    if (name.length > 60 || email.length > 120 || message.length > 500)
      return res.status(400).json({ error: 'One of the fields is too long.' });
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

    await db.query('INSERT INTO messages (name, email, message) VALUES ($1, $2, $3)', [name, email, message]);
    res.status(201).json({ ok: true });
  })
);

/* ---------- public: anonymous visit tracking ---------- */
const KINDS = new Set(['view', 'section', 'click']);
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|curl|wget|python-requests/i;

app.post(
  '/api/track',
  limiter(10 * 60 * 1000, 200, 'Too many requests.'),
  wrap(async (req, res) => {
    const ua = req.get('user-agent') || '';
    if (BOT.test(ua)) return res.sendStatus(204);

    const b = req.body || {};
    const vid = clean(b.vid);
    const kind = clean(b.kind);
    const section = clean(b.section);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(vid) || !KINDS.has(kind) || !/^[a-z0-9-]{1,30}$/.test(section))
      return res.sendStatus(400);

    let ref = '';
    try {
      ref = new URL(clean(b.ref)).hostname.replace(/^www\./, '').slice(0, 100);
    } catch (e) {
      /* no / invalid referrer */
    }
    if (ref === req.hostname) ref = '';

    const device = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop';
    const country = (req.get('x-vercel-ip-country') || '').slice(0, 2).toUpperCase();

    await db.query(
      'INSERT INTO events (visitor_id, kind, section, referrer, device, country) VALUES ($1, $2, $3, $4, $5, $6)',
      [vid, kind, section, ref || null, device, country || null]
    );
    res.sendStatus(204);
  })
);

/* ---------- admin: login (password and/or Google) ---------- */
app.get('/api/admin/config', (req, res) => {
  res.json({
    google: process.env.GOOGLE_CLIENT_ID && process.env.ADMIN_EMAIL ? process.env.GOOGLE_CLIENT_ID : null,
    password: !!process.env.ADMIN_PASSWORD
  });
});

app.post(
  '/api/admin/login',
  limiter(15 * 60 * 1000, 10, 'Too many login attempts. Try again later.'),
  wrap(async (req, res) => {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) return res.status(503).json({ error: 'Password login is not set up.' });
    if (!safeEqual(clean(req.body && req.body.password), expected))
      return res.status(401).json({ error: 'Wrong password.' });
    startSession(res);
  })
);

app.post(
  '/api/admin/google',
  limiter(15 * 60 * 1000, 20, 'Too many login attempts. Try again later.'),
  wrap(async (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const adminEmail = clean(process.env.ADMIN_EMAIL).toLowerCase();
    if (!clientId || !adminEmail) return res.status(503).json({ error: 'Google sign-in is not set up.' });

    const credential = clean(req.body && req.body.credential);
    if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });

    // Google checks the signature and expiry of the token for us.
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    const t = await r.json().catch(() => ({}));
    const ok =
      r.ok &&
      t.aud === clientId &&
      /^(https:\/\/)?accounts\.google\.com$/.test(t.iss || '') &&
      String(t.email_verified) === 'true' &&
      clean(t.email).toLowerCase() === adminEmail;
    if (!ok) return res.status(401).json({ error: 'This Google account is not allowed.' });
    startSession(res);
  })
);

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
  res.json({ ok: true });
});

app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ ok: true }));

/* ---------- admin: messages ---------- */
app.get(
  '/api/admin/messages',
  requireAdmin,
  wrap(async (req, res) => {
    const list = await db.query(
      'SELECT id, name, email, message, is_read, created_at FROM messages ORDER BY created_at DESC, id DESC LIMIT 500'
    );
    const total = await db.query('SELECT count(*)::int AS n FROM messages');
    const unread = await db.query('SELECT count(*)::int AS n FROM messages WHERE is_read = false');
    res.json({ messages: list.rows, total: total.rows[0].n, unread: unread.rows[0].n });
  })
);

app.post(
  '/api/admin/messages/read-all',
  requireAdmin,
  wrap(async (req, res) => {
    await db.query('UPDATE messages SET is_read = true WHERE is_read = false');
    res.json({ ok: true });
  })
);

app.patch(
  '/api/admin/messages/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
    const read = !!(req.body && req.body.read);
    const r = await db.query('UPDATE messages SET is_read = $1 WHERE id = $2', [read, id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Message not found.' });
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/messages/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
    await db.query('DELETE FROM messages WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

/* ---------- admin: analytics ---------- */
const tally = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const top = (map, n) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));

app.get(
  '/api/admin/analytics',
  requireAdmin,
  wrap(async (req, res) => {
    const days = [1, 7, 30, 90, 0].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const offset = Number(process.env.TZ_OFFSET_MIN || 330) * 60000; // default: India (UTC+5:30)
    const dayKey = (d) => new Date(new Date(d).getTime() + offset).toISOString().slice(0, 10);
    const todayKey = dayKey(Date.now());

    // "Today" = since local midnight, "7 days" = today + previous 6 days, and so on.
    const startKey = days ? dayKey(Date.now() - (days - 1) * 864e5) : null;
    const since = startKey ? new Date(new Date(startKey + 'T00:00:00Z').getTime() - offset) : new Date(0);

    const { rows } = await db.query(
      'SELECT visitor_id, kind, section, referrer, device, country, created_at FROM events WHERE created_at >= $1 ORDER BY created_at ASC LIMIT 50000',
      [since]
    );

    const visitors = new Map();
    const perDay = new Map();
    const sectionHits = new Map();
    const sectionVisitors = new Map();
    const clicks = new Map();
    const devices = new Map();
    const countries = new Map();
    const sources = new Map();
    const recent = [];
    let pageViews = 0;
    let todayViews = 0;

    for (const r of rows) {
      const at = new Date(r.created_at);
      let v = visitors.get(r.visitor_id);
      if (!v) {
        v = { views: 0, first: at, last: at, device: r.device, country: r.country, sections: new Set(), clicks: new Set() };
        visitors.set(r.visitor_id, v);
      }
      v.last = at;
      if (r.device) v.device = r.device;
      if (r.country) v.country = r.country;

      if (r.kind === 'view') {
        pageViews++;
        v.views++;
        const k = dayKey(at);
        if (k === todayKey) todayViews++;
        const d = perDay.get(k) || { views: 0, visitors: new Set() };
        d.views++;
        d.visitors.add(r.visitor_id);
        perDay.set(k, d);
        tally(devices, r.device || 'unknown');
        tally(countries, r.country || 'Unknown');
        tally(sources, r.referrer || 'Direct');
        recent.push({ at, id: r.visitor_id.slice(0, 6).toUpperCase(), device: r.device, country: r.country, source: r.referrer || 'Direct' });
      } else if (r.kind === 'section') {
        tally(sectionHits, r.section);
        v.sections.add(r.section);
        if (!sectionVisitors.has(r.section)) sectionVisitors.set(r.section, new Set());
        sectionVisitors.get(r.section).add(r.visitor_id);
      } else if (r.kind === 'click') {
        tally(clicks, r.section);
        v.clicks.add(r.section);
      }
    }

    const viewers = [...visitors.entries()].filter(([, v]) => v.views > 0);

    // daily series (last 90 days at most)
    const series = [];
    const first = startKey || (rows[0] ? dayKey(rows[0].created_at) : todayKey);
    let cursor = new Date(first + 'T00:00:00Z');
    const end = new Date(todayKey + 'T00:00:00Z');
    while (cursor <= end && series.length < 400) {
      const k = cursor.toISOString().slice(0, 10);
      const d = perDay.get(k);
      series.push({ day: k, views: d ? d.views : 0, visitors: d ? d.visitors.size : 0 });
      cursor = new Date(cursor.getTime() + 864e5);
    }

    res.json({
      days,
      truncated: rows.length >= 50000,
      totals: {
        pageViews,
        todayViews,
        uniqueVisitors: viewers.length,
        returningVisitors: viewers.filter(([, v]) => v.views > 1).length
      },
      series: series.slice(-90),
      sections: SECTIONS.map((s) => ({
        section: s,
        visitors: sectionVisitors.has(s) ? sectionVisitors.get(s).size : 0,
        hits: sectionHits.get(s) || 0
      })),
      clicks: top(clicks, 12),
      devices: top(devices, 5),
      countries: top(countries, 8),
      sources: top(sources, 8),
      visitors: viewers
        .sort((a, b) => b[1].views - a[1].views || b[1].last - a[1].last)
        .slice(0, 25)
        .map(([id, v]) => ({
          id: id.slice(0, 6).toUpperCase(),
          views: v.views,
          first: v.first,
          last: v.last,
          device: v.device,
          country: v.country,
          sections: SECTIONS.filter((s) => v.sections.has(s)),
          clicks: [...v.clicks]
        })),
      recent: recent.slice(-20).reverse()
    });
  })
);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = app;
