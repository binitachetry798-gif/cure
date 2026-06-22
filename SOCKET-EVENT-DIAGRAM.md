# Queue Cure '26 — Real-Time Event Diagram

> Queue Cure uses **Supabase Realtime** (PostgreSQL logical replication)
> instead of raw WebSockets. This is architecturally superior: the DB is
> the single source of truth, and any subscriber — regardless of browser tab
> or device — gets the same update simultaneously.

---

## Architecture Overview

```
┌────────────────────┐        REST API         ┌─────────────────────┐
│  RECEPTIONIST      │ ──────────────────────► │  EXPRESS BACKEND    │
│  BROWSER           │  POST /patients         │  (Render.com)       │
│                    │  POST /call-next        │                     │
│  Supabase JS SDK   │  PATCH /settings        │  Supabase           │
│  (anon key)        │  DELETE /patients/:id   │  Service Role       │
│                    │  POST /reset            │  (full DB access)   │
└────────┬───────────┘                         └──────────┬──────────┘
         │                                                │
         │  Supabase Realtime                             │  SQL writes
         │  (postgres_changes)                            ▼
         │                                     ┌─────────────────────┐
         ├────────────────────────────────────► │   SUPABASE          │
         │                                     │   POSTGRESQL DB     │
         │  Supabase Realtime                  │                     │
         │  (postgres_changes)                 │  • patients         │
         │                                     │  • queue_settings   │
┌────────┴───────────┐                         └─────────────────────┘
│  PATIENT           │ ◄────────────────────────────────────────────
│  BROWSER           │        Realtime push (no polling)
│                    │
│  Supabase JS SDK   │
│  (anon key)        │
└────────────────────┘
```

---

## Event Flow: Add Patient

```
Receptionist types name → clicks "Register Patient"
        │
        ▼
POST /patients  { name, phone }
        │
        ▼
Backend: reads next_token from queue_settings
Backend: INSERT INTO patients (name, phone, token_number, status='waiting')
Backend: UPDATE queue_settings SET next_token = next_token + 1
        │
        ▼
Supabase Realtime fires:
  Channel: patients-channel
  Event:   postgres_changes → INSERT on patients
        │
        ├──► Receptionist browser receives → loadQueue() → re-renders list
        └──► Patient browser receives     → loadQueue() → updates waiting count
```

---

## Event Flow: Call Next Token

```
Receptionist clicks "Call Next Patient"
        │
        ▼
POST /call-next
        │
        ▼
Backend:
  1. UPDATE patients SET status='done', completed_at=NOW()
     WHERE status='in_progress'
  2. SELECT * FROM patients WHERE status='waiting'
     ORDER BY token_number ASC LIMIT 1
  3. UPDATE patients SET status='in_progress', called_at=NOW()
     WHERE id = nextPatient.id
  4. UPDATE queue_settings
     SET current_token = nextPatient.token_number,
         current_patient_name = nextPatient.name
     WHERE id = 1
        │
        ▼
Supabase Realtime fires TWO events simultaneously:
  ┌── patients-channel: UPDATE (old patient → done)
  ├── patients-channel: UPDATE (next patient → in_progress)
  └── settings-channel: UPDATE (current_token changed)
        │
        ├──► Receptionist: stats refresh, queue list re-renders
        └──► Patient screen: "Now Serving" token updates instantly
              (ZERO page refresh required)
```

---

## Event Flow: Update Avg Consultation Time

```
Receptionist sets minutes → clicks "Set"
        │
        ▼
PATCH /settings  { avg_consult_minutes: 15 }
        │
        ▼
Backend: UPDATE queue_settings SET avg_consult_minutes=15 WHERE id=1
        │
        ▼
Supabase Realtime:
  settings-channel: postgres_changes → UPDATE on queue_settings
        │
        ├──► Receptionist: stat card updates
        └──► Patient: token lookup now uses new avg (wait times recalculate)
```

---

## Concurrency & Edge Cases

| Scenario | Handling |
|---|---|
| Two receptionists click "Call Next" simultaneously | Backend UPDATE is a single atomic SQL transaction. PostgreSQL row-level locking ensures only one UPDATE runs at a time. Second click finds no `in_progress` row to move, safely skips. |
| Patient checks token that's already done | `lookupToken()` only searches `status='waiting'`. Done tokens show "not found". |
| Queue is empty when "Call Next" is clicked | Backend SELECT returns null → updates `current_patient_name` to "No patients waiting" → Realtime pushes to all screens. |
| Network drop during call-next | The `finally` block re-enables the button. Supabase reconnects automatically on network restore. |
| Receptionist accidentally adds duplicate name | Token numbers are strictly sequential integers; no deduplication — each registration is a new person. |
| Backend is cold-starting on Render | Frontend shows toast: "Could not connect to server." Retries on next action. Queue data is safe in Supabase. |

---

## Why Supabase Realtime > Socket.IO here

| | Socket.IO | Supabase Realtime |
|---|---|---|
| State source | In-memory on Node server | PostgreSQL (persistent) |
| Scales to N tabs | Manual room management | Automatic — any subscriber gets it |
| Server restarts | State lost unless persisted | State always in DB |
| Free hosting | Requires always-on server | Serverless, free tier |
| Setup | ~200 lines of socket code | 6 lines of JS |
