require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase admin client (service role — full access)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());

// ─── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── GET /queue — fetch full queue state ───────────────────────
app.get('/queue', async (req, res) => {
  try {
    const { data: settings, error: sErr } = await supabase
      .from('queue_settings')
      .select('*')
      .eq('id', 1)
      .single();

    const { data: patients, error: pErr } = await supabase
      .from('patients')
      .select('*')
      .order('token_number', { ascending: true });

    if (sErr || pErr) throw sErr || pErr;

    res.json({ settings, patients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /patients — add a new patient ───────────────────────
app.post('/patients', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Patient name is required' });
    }

    // Get next token number
    const { data: settings } = await supabase
      .from('queue_settings')
      .select('next_token, current_token, avg_consult_minutes')
      .eq('id', 1)
      .single();

    const tokenNumber = settings.next_token;

    // Insert patient
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

    // Bump next_token
    await supabase
      .from('queue_settings')
      .update({ next_token: tokenNumber + 1 })
      .eq('id', 1);

    res.json({ patient: data, token: tokenNumber });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /call-next — advance queue to next patient ──────────
app.post('/call-next', async (req, res) => {
  try {
    const { data: settings } = await supabase
      .from('queue_settings')
      .select('*')
      .eq('id', 1)
      .single();

    // Mark current "in_progress" patient as done
    await supabase
      .from('patients')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('status', 'in_progress');

    // Find next waiting patient
    const { data: nextPatient } = await supabase
      .from('patients')
      .select('*')
      .eq('status', 'waiting')
      .order('token_number', { ascending: true })
      .limit(1)
      .single();

    if (!nextPatient) {
      // No more patients waiting
      await supabase
        .from('queue_settings')
        .update({ current_token: null, current_patient_name: 'No patients waiting' })
        .eq('id', 1);

      return res.json({ message: 'Queue is empty', currentToken: null });
    }

    // Mark next patient as in_progress
    await supabase
      .from('patients')
      .update({ status: 'in_progress', called_at: new Date().toISOString() })
      .eq('id', nextPatient.id);

    // Update settings with new current token
    await supabase
      .from('queue_settings')
      .update({
        current_token: nextPatient.token_number,
        current_patient_name: nextPatient.name
      })
      .eq('id', 1);

    res.json({ message: 'Next patient called', currentToken: nextPatient.token_number, patient: nextPatient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /settings — update avg consultation time ───────────
app.patch('/settings', async (req, res) => {
  try {
    const { avg_consult_minutes } = req.body;
    if (!avg_consult_minutes || avg_consult_minutes < 1) {
      return res.status(400).json({ error: 'Invalid consultation time' });
    }

    const { data, error } = await supabase
      .from('queue_settings')
      .update({ avg_consult_minutes: parseInt(avg_consult_minutes) })
      .eq('id', 1)
      .select()
      .single();

    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /patients/:id — remove a patient from queue ───────
app.delete('/patients/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('patients')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Patient removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /reset — clear entire queue (end of day) ────────────
app.post('/reset', async (req, res) => {
  try {
    await supabase.from('patients').delete().neq('id', 0);
    await supabase
      .from('queue_settings')
      .update({
        current_token: null,
        current_patient_name: 'No patients yet',
        next_token: 1
      })
      .eq('id', 1);

    res.json({ message: 'Queue reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Queue Cure API running on port ${PORT}`);
});
