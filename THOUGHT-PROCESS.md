# Queue Cure '26 — Thought Process Sheet

**Team / Builder:** [Your Name]
**Hackathon:** Queue Cure '26 on Wooble
**Stack:** Node.js + Express · Supabase (PostgreSQL + Realtime) · Vanilla JS · Render.com

---

## 1. Problem Framing

India has 1.5 million clinics. 76% run on paper tokens and verbal announcements. This means:
- Patients wait 2–3 hours with **zero visibility** into their position
- Receptionists manage everything from **memory** — prone to errors
- Doctors have **no dashboard** to see queue state
- Any missed announcement = patient misses their turn

The fix isn't complex — it's a **shared, live view of a simple ordered list** with one write operation (call next) that all connected clients reflect instantly.

---

## 2. Core Design Decisions

### Why Supabase Realtime over Socket.IO?

The tempting choice is Socket.IO + a Node server managing an in-memory queue. I rejected this for three reasons:

1. **Durability**: An in-memory queue dies if the server restarts (Render free tier spins down). Supabase persists data in PostgreSQL.
2. **Simplicity**: Socket.IO requires event naming, room management, and broadcasting logic. Supabase Realtime gives us `postgres_changes` — the DB change IS the event.
3. **Free tier fit**: Supabase Realtime works on the free tier with no always-on server needed for the pub/sub layer.

The backend (Express on Render) only handles **writes** — all reads and live updates flow through Supabase directly to the browser.

### Why a single `queue_settings` row?

The "current token" is global clinic state, not per-patient state. Keeping it in a dedicated row means:
- One Realtime subscription picks up all state changes
- Atomic updates prevent split-brain (token number updated ≠ patient status updated)
- Easy to query: always `WHERE id = 1`

### Why token numbers instead of queue positions?

Token numbers are **immutable identifiers** — a patient's token never changes even if someone ahead leaves. Position in queue is derived at read time by counting `status='waiting'` rows with lower token numbers. This avoids the concurrency nightmare of re-numbering every patient when someone is removed.

---

## 3. Wait Time Calculation

Wait time is **never hardcoded**. It's computed at runtime:

```
waitMinutes = patientsAhead × avgConsultMinutes

where:
  patientsAhead      = COUNT of patients with status='waiting'
                       AND token_number < myToken
  avgConsultMinutes  = queue_settings.avg_consult_minutes
                       (set by receptionist, default 10)
```

**Example:**
- Token 7 is being seen now
- Tokens 8, 9 are waiting (2 patients ahead of Token 10)
- Avg consult = 12 minutes
- Token 10's wait = 2 × 12 = **24 minutes**

This updates every time the receptionist clicks "Call Next" because the Realtime push triggers a full `loadQueue()` → recomputes positions.

**Edge case — if the in-progress patient started 5 minutes ago:**
In a v2, we'd subtract elapsed time: `waitMins = (patientsAhead × avg) - elapsed`. The current model conservatively shows the full slot, giving patients a pleasant surprise if they're called earlier.

---

## 4. Concurrency Handling

The most dangerous operation is **"Call Next"** — what if two receptionists click it at the same time?

**Solution: atomic SQL transaction ordering**

```sql
-- Step 1: Mark current in_progress as done
UPDATE patients SET status='done' WHERE status='in_progress';

-- Step 2: Find next waiting
SELECT * FROM patients WHERE status='waiting' ORDER BY token_number LIMIT 1;

-- Step 3: Mark them in_progress
UPDATE patients SET status='in_progress' WHERE id = $1;
```

PostgreSQL's row-level locking means two concurrent `UPDATE WHERE status='in_progress'` calls cannot both succeed on the same row simultaneously. The second one finds no matching row (already marked done by the first) and moves on safely.

**Result:** No double-calling, no skipped patients.

---

## 5. Edge Cases Addressed

| Edge Case | Resolution |
|---|---|
| Queue empty on "Call Next" | Backend returns `{currentToken: null}`, UI shows "No patients waiting" |
| Patient removed mid-wait | DELETE patient by ID; Realtime updates all screens; wait times recalculate |
| Receptionist enters 0 minutes avg | Frontend validates `min="1"` + backend checks `< 1` → 400 error |
| Patient checks an already-done token | Lookup only searches `status='waiting'` → shows "token not found" |
| Backend cold start (Render free tier) | Frontend shows toast error; queue data safe in Supabase; auto-recovers |
| Two patients registered simultaneously | Each gets a different `next_token` because the backend increments atomically per request |
| Doctor runs fast/slow today | Receptionist can update avg consult time any time; all wait estimates update instantly |

---

## 6. UX Decisions

**Receptionist screen must be fast and mistake-proof (20% of score)**

- Enter to submit form — no clicking required
- Token auto-increments — receptionist never assigns numbers manually
- Delete button only appears on `waiting` patients (can't accidentally remove someone mid-consult)
- "Reset Queue" requires double confirmation (window.confirm)
- Current stats (serving / waiting / avg time) always visible at the top

**Patient screen must be trustworthy**

- "Now Serving" is large and central — visible from across a room
- Token lookup shows exact minutes AND patients-ahead count (two confidence signals)
- Progress bar gives visual sense of how close they are
- Queue list shows only waiting + in_progress patients, not completed (reduces noise)

---

## 7. What I'd Build Next (v2)

1. **SMS notifications** (Twilio free trial) — text patient when 2 tokens away
2. **Doctor dashboard** — see next 3 patients, add consultation notes
3. **Historical analytics** — avg wait per hour, busiest days, actual vs estimated time accuracy
4. **Multi-doctor support** — separate queues per doctor, patients choose
5. **QR code on token slip** — patient scans to open their personal status page
