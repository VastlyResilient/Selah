# Morning Word 🌅
> Daily Bible verses by SMS — users subscribe once, receive verses every morning.

## How It Works
- Users visit your site, pick a theme, enter their phone number & preferred time
- Your server (running 24/7 on Railway) sends a personalized Bible verse via Twilio SMS every morning
- Each text includes a one-tap unsubscribe link
- You pay ~$0.0079/SMS (Twilio) — about $0.24/month per subscriber

---

## Deploy in 15 Minutes

### Step 1 — Get a Twilio account (free)
1. Sign up at [twilio.com/try-twilio](https://www.twilio.com/try-twilio)
2. Verify your own phone number during signup
3. Get a free Twilio phone number (US numbers work great)
4. Note your **Account SID**, **Auth Token**, and **Phone Number** from the Console

### Step 2 — Deploy to Railway
1. Sign up at [railway.app](https://railway.app) (free tier available)
2. Create a **New Project → Deploy from GitHub repo**
   - Push this folder to a GitHub repo first, OR
   - Use **New Project → Empty Project → Upload files**
3. Once deployed, Railway gives you a public URL like `https://morning-word-production.up.railway.app`

### Step 3 — Add Environment Variables in Railway
In your Railway project → **Variables** tab, add:

| Variable | Value |
|---|---|
| `TWILIO_SID` | Your Twilio Account SID (starts with AC...) |
| `TWILIO_TOKEN` | Your Twilio Auth Token |
| `TWILIO_FROM` | Your Twilio phone number (e.g. +15551234567) |
| `APP_URL` | Your Railway URL (e.g. https://morning-word-production.up.railway.app) |

Railway sets `PORT` automatically — don't add it manually.

### Step 4 — Done! 🎉
- Visit your Railway URL to see the live site
- Share it with people to subscribe
- Verses fire every morning at each subscriber's chosen time

---

## Project Structure
```
morning-word/
├── server.js          # Express backend + cron scheduler
├── package.json
├── .env.example       # Copy to .env for local dev
├── data/
│   └── subscribers.json  # Auto-created, stores subscribers
└── public/
    └── index.html     # Frontend (served by Express)
```

## Local Development
```bash
npm install
cp .env.example .env   # Fill in your Twilio credentials
node server.js
# Visit http://localhost:3000
```

## Notes
- Subscribers are stored in `data/subscribers.json` (simple, works great for personal use)
- The cron job runs every minute and checks who needs a text based on their timezone + send time
- Railway's free tier keeps the server running continuously
- To scale up: swap the JSON file for a real database (SQLite, PostgreSQL)
