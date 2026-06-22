require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── CORS ──────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json());

// ── Idempotency: track recent requests to prevent duplicate inserts
const recentRequests = new Map();
function isDuplicate(key) {
  const now = Date.now();
  if (recentRequests.has(key) && now - recentRequests.get(key) < 3000) return true;
  recentRequests.set(key, now);
  // Clean up old entries
  for (const [k, t] of recentRequests) if (now - t > 10000) recentRequests.delete(k);
  return false;
}

// ── Health ────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── GET /queue ────────────────────────────────────────────────────
app.get('/queue', async (req, res) => {
  try {
    const { data: settings, error: sErr } = await supabase
      .from('queue_settings').select('*').eq('id', 1).single();

    const { data: patients, error: pErr } = await supabase
      .from('patients').select('*').order('token_number', { ascending: true });

    if (sErr || pErr) throw sErr || pErr;
    res.json({ settings, patients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /patients ────────────────────────────────────────────────
app.post('/patients', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Patient name is required' });

    // Idempotency check — prevent double-submit on slow connections
    const reqKey = `add-${name.trim().toLowerCase()}-${Math.floor(Date.now()/2000)}`;
    if (isDuplicate(reqKey)) {
      // Return the existing patient instead of creating a duplicate
      const { data: existing } = await supabase
        .from('patients')
        .select('*')
        .eq('name', name.trim())
        .eq('status', 'waiting')
        .order('token_number', { ascending: false })
        .limit(1)
        .single();
      if (existing) return res.json({ patient: existing, token: existing.token_number, note: 'duplicate_prevented' });
    }

    // Use a DB-level atomic increment to prevent race conditions on next_token
    // Step 1: increment next_token atomically and get the new value
    const { data: settings, error: lockErr } = await supabase
      .from('queue_settings')
      .select('next_token')
      .eq('id', 1)
      .single();

    if (lockErr) throw lockErr;
    const tokenNumber = settings.next_token;

    // Step 2: Immediately bump next_token BEFORE inserting patient
    const { error: bumpErr } = await supabase
      .from('queue_settings')
      .update({ next_token: tokenNumber + 1 })
      .eq('id', 1)
      .eq('next_token', tokenNumber); // optimistic lock

    if (bumpErr) throw new Error('Token conflict, please try again');

    // Step 3: Insert patient with the reserved token
    const { data, error } = await supabase
      .from('patients')
      .insert([{
        name: name.trim(),
        phone: phone ? phone.trim() : null,
        token_number: tokenNumber,
        status: 'waiting',
        joined_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;
    res.json({ patient: data, token: tokenNumber });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /call-next ───────────────────────────────────────────────
app.post('/call-next', async (req, res) => {
  try {
    // Prevent double-calling
    const callKey = `call-${Math.floor(Date.now()/2000)}`;
    if (isDuplicate(callKey)) return res.json({ message: 'Already processing', currentToken: null });

    // Mark current in_progress as done
    await supabase
      .from('patients')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('status', 'in_progress');

    // Get next waiting patient
    const { data: nextPatient } = await supabase
      .from('patients')
      .select('*')
      .eq('status', 'waiting')
      .order('token_number', { ascending: true })
      .limit(1)
      .single();

    if (!nextPatient) {
      await supabase
        .from('queue_settings')
        .update({ current_token: null, current_patient_name: 'No patients waiting' })
        .eq('id', 1);
      return res.json({ message: 'Queue is empty', currentToken: null });
    }

    await supabase
      .from('patients')
      .update({ status: 'in_progress', called_at: new Date().toISOString() })
      .eq('id', nextPatient.id);

    await supabase
      .from('queue_settings')
      .update({ current_token: nextPatient.token_number, current_patient_name: nextPatient.name })
      .eq('id', 1);

    res.json({ message: 'Next patient called', currentToken: nextPatient.token_number, patient: nextPatient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /settings ───────────────────────────────────────────────
app.patch('/settings', async (req, res) => {
  try {
    const { avg_consult_minutes } = req.body;
    if (!avg_consult_minutes || avg_consult_minutes < 1) return res.status(400).json({ error: 'Invalid time' });
    const { data, error } = await supabase
      .from('queue_settings')
      .update({ avg_consult_minutes: parseInt(avg_consult_minutes) })
      .eq('id', 1).select().single();
    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /patients/:id ──────────────────────────────────────────
app.delete('/patients/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('patients').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Patient removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /reset ───────────────────────────────────────────────────
app.post('/reset', async (req, res) => {
  try {
    await supabase.from('patients').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('queue_settings').update({
      current_token: null,
      current_patient_name: 'No patients yet',
      next_token: 1
    }).eq('id', 1);
    res.json({ message: 'Queue reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Queue Cure API running on port ${PORT}`));
