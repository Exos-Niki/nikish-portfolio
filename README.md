# NIKISH M – Portfolio

Portfolio website with a contact form, an admin inbox and a Postgres database.
Visitors send a message → it is saved in the database → you read it at `/admin`.
The page also counts visits (anonymously), so `/admin` shows how many people viewed your portfolio,
how many times each came back, and which sections they scrolled to.

```
public/index.html   the portfolio (contact form posts to /api/messages)
public/admin.html   admin portal: Messages inbox + visitor Analytics (Google or password login)
api/index.js        Express API (runs as a Vercel serverless function)
lib/db.js           Postgres connection, creates the `messages` table automatically
server.js           local dev server
vercel.json         Vercel settings
```

## 1. Get a free database (2 minutes)

Use any Postgres. Easiest: **Neon** (https://neon.tech) or Vercel's Storage tab → Neon.
Copy the connection string. It looks like `postgresql://user:pass@host/db?sslmode=require`.

## 1b. Sign in with your Google (Gmail) account (optional but recommended)

1. Go to https://console.cloud.google.com → create a project (any name).
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, and add your Gmail
   under **Test users**. (You can leave it in "Testing" mode; it only needs to work for you.)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
   Under **Authorized JavaScript origins** add `http://localhost:3000` and, later, `https://<your-project>.vercel.app`.
   (No redirect URI is needed.)
4. Copy the **Client ID** into `GOOGLE_CLIENT_ID`, and put your Gmail in `ADMIN_EMAIL`.

Only that exact Gmail address can log in. If you skip this, the password login still works.

## 2. Run it on your computer

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# open .env and fill in DATABASE_URL, JWT_SECRET, ADMIN_EMAIL + GOOGLE_CLIENT_ID (and/or ADMIN_PASSWORD)
npm run dev
```

- Portfolio: http://localhost:3000
- Admin inbox: http://localhost:3000/admin

## 3. Push to GitHub

Create an empty repository on github.com (no README), then:

```bash
git init
git add .
git commit -m "Portfolio with contact form and admin inbox"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

`.env` is in `.gitignore`, so your password and database URL are never uploaded.

## 4. Host on Vercel

1. vercel.com → **Add New → Project** → import your GitHub repository.
2. Leave the build settings as they are (no framework, no build command).
3. Open **Environment Variables** and add:
   - `DATABASE_URL` – your Postgres connection string
   - `JWT_SECRET` – any long random string (e.g. run `openssl rand -hex 32`)
   - `GOOGLE_CLIENT_ID` and `ADMIN_EMAIL` – for Google sign-in
   - `ADMIN_PASSWORD` – optional password login
   - `TZ_OFFSET_MIN` – optional, `330` for India
4. Click **Deploy**.

Your site is live at `https://<project>.vercel.app` and the inbox at `https://<project>.vercel.app/admin`.
Every `git push` redeploys automatically.

## Using the analytics

Open `/admin` → **Analytics**. Pick Today / 7 days / 30 days / 90 days / All time.

- **Page views, unique visitors, returning visitors, views today**
- **Page views per day** chart
- **Sections visited**: how many visitors reached About, Skills, Projects, Education and Contact
- **Link clicks**: LinkedIn, GitHub, Gmail, Flappy Bird buttons, contact form sent
- **Devices, countries, referring sites**
- **Visitors table**: each visitor is an anonymous ID (like `#A3F9C2`) with how many times they viewed,
  which sections they saw and what they clicked. The same browser keeps the same ID.
- **Latest visits**

Privacy: no names, emails or IP addresses are stored. A random ID is kept in the visitor's browser.
Your own visits are not counted once you have logged in to `/admin` on that browser.
Country comes from Vercel and only appears once deployed.

## Using the inbox

- Open `/admin` any time and log in. New messages show up within 15 seconds
  (the tab title shows the unread count, e.g. `(2) Inbox`).
- Press **Enable alerts** to get a desktop notification when a message arrives
  while the tab is in the background.
- **Reply** opens your mail app, **Mark read/unread** and **Delete** manage messages.

## Notes

- Spam protection: a hidden honeypot field plus a limit of 5 messages per 10 minutes per visitor.
- Login is limited to 10 attempts per 15 minutes. On Vercel these counters live in each
  server instance's memory, so they are a basic safeguard; use a long `ADMIN_PASSWORD`.
- To change the password or allowed Gmail, edit the variable in Vercel → Settings → Environment Variables and redeploy.
- Change the GitHub repository link in `public/index.html` (the Flappy Bird card) to your real repo.
