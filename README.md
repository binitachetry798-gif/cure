# 🏥 Queue Cure '26 — Smart Clinic Queue Manager

> Live queue management for Indian clinics. No more paper tokens. No more shouting.
> Patients see their wait time in real-time. Receptionists manage everything in one click.

[![Live Demo](https://img.shields.io/badge/Live-Demo-00d4aa?style=for-the-badge)](#)
[![Supabase](https://img.shields.io/badge/Supabase-Realtime-3ECF8E?style=for-the-badge&logo=supabase)](#)
[![Render](https://img.shields.io/badge/Render-Backend-46E3B7?style=for-the-badge)](#)

---

## ✨ Features

| Feature | Detail |
|---|---|
| 🔴 Live sync | Both screens update the moment "Call Next" is clicked — no refresh |
| ⏱️ Dynamic wait time | Computed from real queue depth × avg consult time — never hardcoded |
| 🩺 Receptionist dashboard | Add patient, call next, update consult time, remove patients |
| 🪑 Patient waiting room | See current token, tokens ahead, estimated wait in minutes |
| 🔢 Token lookup | Patient enters their token → sees exact wait + progress bar |
| 🔁 End-of-day reset | One-click queue clear for a fresh start |
| ⚡ Concurrency-safe | Atomic SQL prevents double-calling on simultaneous clicks |

---

## 🛠 Tech Stack

```
Frontend  →  Vanilla HTML/CSS/JS (no framework, zero build step)
Realtime  →  Supabase Realtime (PostgreSQL logical replication)
Backend   →  Node.js + Express (REST API for writes)
Database  →  Supabase (PostgreSQL)
Hosting   →  Render.com (backend, free tier)
```

---

## 🚀 Setup & Deployment

### Step 1 — Supabase Database

1. Go to [supabase.com](https://supabase.com) → create a new project
2. Navigate to **SQL Editor → New Query**
3. Paste the entire contents of `supabase-schema.sql` and click **Run**
4. Go to **Project Settings → API** and copy:
   - Project URL
   - `anon` public key
   - `service_role` secret key

### Step 2 — Backend on Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Set these values:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Add **Environment Variables:**
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   PORT=3001
   ```
6. Click **Deploy** — copy the live URL (e.g. `https://queue-cure-api.onrender.com`)

### Step 3 — Frontend

1. Open `frontend/public/index.html`
2. Replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your values (already done if you used the provided keys)
3. Add your Render backend URL:
   ```js
   const API_URL = 'https://your-queue-cure-api.onrender.com';
   ```
4. Deploy `frontend/public/` to any static host:
   - **Netlify**: drag and drop the `public` folder at [app.netlify.com](https://app.netlify.com/drop)
   - **Vercel**: `npx vercel frontend/public`
   - **GitHub Pages**: push to `gh-pages` branch

### Step 4 — Open Both Screens

- Open the frontend URL in **Tab 1** → click **Receptionist**
- Open the same URL in **Tab 2** → click **Waiting Room**
- Add a patient on Tab 1 → watch Tab 2 update live ⚡

---

## 📁 Project Structure

```
queue-cure/
├── backend/
│   ├── server.js          # Express API (add patient, call next, settings)
│   ├── package.json
│   └── .env               # Supabase keys (DO NOT commit to git)
├── frontend/
│   └── public/
│       └── index.html     # Complete frontend (both screens)
├── supabase-schema.sql    # Run once in Supabase SQL Editor
├── SOCKET-EVENT-DIAGRAM.md
├── THOUGHT-PROCESS.md
└── README.md
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/queue` | Get full queue state (patients + settings) |
| POST | `/patients` | Add new patient `{ name, phone? }` |
| POST | `/call-next` | Advance queue to next patient |
| PATCH | `/settings` | Update avg consult time `{ avg_consult_minutes }` |
| DELETE | `/patients/:id` | Remove patient from queue |
| POST | `/reset` | Clear all patients, reset tokens to 1 |

---

## ⚡ How Live Sync Works

```
Receptionist clicks "Call Next"
        │
        ▼
POST /call-next → Express backend
        │
        ▼
Supabase: UPDATE patients + UPDATE queue_settings
        │
        ▼
Supabase Realtime broadcasts postgres_changes event
        │
        ├──► Receptionist screen re-renders instantly
        └──► Patient screen updates "Now Serving" token instantly
```

No WebSocket server to maintain. No polling. The database change IS the event.

---

## 🏆 Hackathon Submission Checklist

- [x] Working prototype link
- [x] GitHub repository with README
- [x] Socket event diagram (`SOCKET-EVENT-DIAGRAM.md`)
- [x] Thought process sheet (`THOUGHT-PROCESS.md`)

---

## 📄 License

MIT — built for Queue Cure '26 on Wooble.
