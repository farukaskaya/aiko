'use strict';

const chat = document.getElementById('chat');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const send = document.getElementById('send');
const typing = document.getElementById('typing');
const panel = document.getElementById('panel');
const scrim = document.getElementById('scrim');

const me = {
  profile: localStorage.getItem('aiko.profile') || '',
  personality: localStorage.getItem('aiko.personality') || '',
};

function saveMe() {
  localStorage.setItem('aiko.profile', me.profile);
  localStorage.setItem('aiko.personality', me.personality);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Every request says which profile and personality it is talking to. */
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (me.profile) headers['x-aiko-profile'] = me.profile;
  if (me.personality) headers['x-aiko-personality'] = me.personality;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function decisionHtml(d) {
  if (!d) return '';
  const pct = Math.round(d.probability * 100);
  const v = d.verdict;
  const reasons = (d.reasons || []).slice(0, 3).map((r) => `<li>${esc(r)}</li>`).join('');
  return `
    <div class="decision">
      <div class="verdict">
        <span class="word ${v}">${v.toUpperCase()}</span>
        <span class="pct">${pct}% sure</span>
      </div>
      <div class="track"><i class="${v}" style="width:${pct}%"></i></div>
      ${reasons ? `<ul class="reasons">${reasons}</ul>` : ''}
    </div>`;
}

function messageEl(m) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${m.role === 'user' ? 'user' : 'her'}`;
  wrap.dataset.id = m.id;
  wrap.innerHTML = `
    <div class="bubble">${esc(m.text)}</div>
    ${m.role === 'her' ? decisionHtml(m.decision) : ''}
    <div class="time">${timeOf(m.ts)}</div>`;
  return wrap;
}

function setMood(mood) {
  const pct = Math.round((mood.affection + mood.trust + mood.patience) / 3);
  document.getElementById('moodLabel').textContent = mood.label || 'content';
  document.getElementById('moodHearts').textContent = pct;
  document.getElementById('moodFill').style.width = `${pct}%`;

  const bars = document.getElementById('moodBars');
  if (bars) {
    bars.innerHTML = ['affection', 'trust', 'patience']
      .map((k) => `
        <div class="bar-row">
          <label>${k}</label>
          <div class="bar"><i style="width:${Math.round(mood[k])}%"></i></div>
          <span class="val">${Math.round(mood[k])}</span>
        </div>`)
      .join('');
  }
}

function setFacts(facts) {
  const list = document.getElementById('facts');
  const empty = document.getElementById('factsEmpty');
  document.getElementById('factCount').textContent = facts.length;
  empty.style.display = facts.length ? 'none' : 'block';
  list.innerHTML = facts
    .map((f) => `
      <li>
        <span class="tag">${esc(f.type)}</span>
        <span class="subject">${esc(f.subject)}</span>
        <button data-id="${f.id}" title="forget this" aria-label="forget this">&#10005;</button>
      </li>`)
    .join('');

  list.querySelectorAll('button').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/facts/${btn.dataset.id}`, { method: 'DELETE' });
      await refreshMeta();
    };
  });
}

function fillSelect(select, options, selectedId) {
  select.innerHTML = options
    .map((o) => `<option value="${esc(o.id)}"${o.id === selectedId ? ' selected' : ''}>${esc(o.name)}</option>`)
    .join('');
}

function personaHint(p) {
  const bits = [p.tagline || ''];
  bits.push(p.trainedAt ? `trained ${new Date(p.trainedAt).toLocaleDateString()}` : 'built-in voice');
  const bias = Math.round((p.biasOffset || 0) * 100) / 100;
  bits.push(`yes-bias ${bias > 0 ? '+' : ''}${bias}`);
  const words = (p.lexicon.positive.length || 0) + (p.lexicon.negative.length || 0);
  if (words) bits.push(`${words} learned words`);
  if (p.trained) bits.push(`${p.trained.lines.her} lines heard`);
  return bits.filter(Boolean).join(' · ');
}

/** Confidence over time: one point per question she answered. */
function renderChart(series) {
  const el = document.getElementById('chart');
  if (!series || series.length < 2) {
    el.innerHTML = '<p class="empty">Answer a couple of questions and her confidence shows up here.</p>';
    return;
  }

  const W = 320;
  const H = 116;
  const pad = { l: 30, r: 10, t: 10, b: 18 };
  const x = (i) => pad.l + (i / (series.length - 1)) * (W - pad.l - pad.r);
  const y = (p) => pad.t + (1 - p) * (H - pad.t - pad.b);
  const YES = '#4ade80';
  const NO = '#fb7185';
  const EVEN = '#9a94b3';

  const segments = series
    .map((pt, i) => {
      if (i === 0) return '';
      const prev = series[i - 1];
      const color = prev.p >= 0.5 && pt.p >= 0.5 ? YES : prev.p < 0.5 && pt.p < 0.5 ? NO : EVEN;
      return `<line x1="${x(i - 1).toFixed(1)}" y1="${y(prev.p).toFixed(1)}" x2="${x(i).toFixed(1)}" y2="${y(pt.p).toFixed(1)}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    })
    .join('');

  const dots = series
    .map((pt, i) => {
      const color = pt.p >= 0.5 ? YES : NO;
      const label = `${Math.round(pt.p * 100)}% ${pt.verdict} — ${pt.text}`;
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(pt.p).toFixed(1)}" r="3.4" fill="${color}"><title>${esc(label)}</title></circle>`;
    })
    .join('');

  const last = series[series.length - 1];
  const lastPct = `${Math.round(last.p * 100)}%`;

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="confidence over time" preserveAspectRatio="none">
      <line x1="${pad.l}" y1="${y(0.5)}" x2="${W - pad.r}" y2="${y(0.5)}" stroke="#3a3552" stroke-width="1" stroke-dasharray="4 4"/>
      <line x1="${pad.l}" y1="${y(1)}" x2="${W - pad.r}" y2="${y(1)}" stroke="#2e2a40" stroke-width="1"/>
      <line x1="${pad.l}" y1="${y(0)}" x2="${W - pad.r}" y2="${y(0)}" stroke="#2e2a40" stroke-width="1"/>
      <text x="4" y="${y(1) + 4}" class="axis">100</text>
      <text x="4" y="${y(0.5) + 4}" class="axis">50</text>
      <text x="4" y="${y(0) + 4}" class="axis">0</text>
      ${segments}
      ${dots}
      <text x="${W - pad.r}" y="${H - 4}" text-anchor="end" class="axis">${series.length} answers · now ${lastPct}</text>
    </svg>`;
}

function scrollDown() {
  chat.scrollTop = chat.scrollHeight;
}

async function refreshMeta() {
  const state = await api('/api/state');
  setFacts(state.facts);
  setMood(state.mood);
  document.getElementById('msgCount').textContent = `${state.history.length} messages`;
  renderChart(state.series);
}

function showTyping(on) {
  typing.hidden = !on;
  if (on) scrollDown();
}

function renderPersonaMeta(state) {
  document.getElementById('name').textContent = state.persona.name;
  document.getElementById('avatar').textContent = state.persona.name[0] || '?';
  input.placeholder = `Say something to ${state.persona.name}...`;
  document.getElementById('personaHint').textContent = personaHint(state.persona);
  document.getElementById('untrainBtn').hidden = !state.persona.trainedAt;

  fillSelect(document.getElementById('personaSelect'), state.personalities, state.activePersonality);
  fillSelect(document.getElementById('personaPanelSelect'), state.personalities, state.activePersonality);
  fillSelect(document.getElementById('profileSelect'), state.profiles, state.profile.id);
  fillSelect(
    document.getElementById('presetSelect'),
    state.presets.map((p) => ({ id: p.id, name: `${p.name} — ${p.tagline}` })),
    'aiko'
  );
}

async function loadState() {
  const res = await api('/api/state');
  me.profile = res.profile.id;
  me.personality = res.persona.id;
  saveMe();

  renderPersonaMeta(res);
  chat.innerHTML = '';
  res.history.forEach((m) => chat.appendChild(messageEl(m)));
  if (!res.history.length) {
    const hint = document.createElement('div');
    hint.className = 'msg her';
    hint.innerHTML = `<div class="bubble">Ask me anything. I will tell you how likely I am to say yes.</div>`;
    chat.appendChild(hint);
  }
  setMood(res.mood);
  setFacts(res.facts);
  document.getElementById('msgCount').textContent = `${res.history.length} messages`;
  renderChart(res.series);
  scrollDown();
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  send.disabled = true;
  chat.appendChild(messageEl({ id: Date.now(), role: 'user', text, ts: Date.now() }));
  scrollDown();
  showTyping(true);

  const started = Date.now();
  try {
    const data = await api('/api/chat', { method: 'POST', body: JSON.stringify({ text }) });
    await delay(Math.max(0, 500 + Math.random() * 500 - (Date.now() - started)));
    showTyping(false);

    chat.appendChild(messageEl(data.reply));
    setMood(data.mood);
    refreshMeta();
    scrollDown();
  } catch (err) {
    showTyping(false);
    const el = document.createElement('div');
    el.className = 'msg her';
    el.innerHTML = `<div class="bubble">Something broke: ${esc(err.message)}</div>`;
    chat.appendChild(el);
    scrollDown();
  } finally {
    send.disabled = false;
    input.focus();
  }
});

function openPanel(open) {
  panel.hidden = !open;
  scrim.hidden = !open;
}

document.getElementById('menuBtn').onclick = () => openPanel(true);
document.getElementById('closePanel').onclick = () => openPanel(false);
scrim.onclick = () => openPanel(false);

document.getElementById('resetBtn').onclick = async () => {
  if (!confirm('Forget the entire conversation and everything she knows?')) return;
  await api('/api/reset', { method: 'POST' });
  openPanel(false);
  await loadState();
};

async function switchProfile(id) {
  me.profile = id;
  me.personality = '';
  saveMe();
  await loadState();
}

async function switchPersonality(id) {
  me.personality = id;
  saveMe();
  await api(`/api/personalities/${id}/activate`, { method: 'POST' }).catch(() => {});
  await loadState();
}

document.getElementById('profileSelect').onchange = (e) => switchProfile(e.target.value);
document.getElementById('personaSelect').onchange = (e) => switchPersonality(e.target.value);
document.getElementById('personaPanelSelect').onchange = (e) => switchPersonality(e.target.value);

document.getElementById('newProfileBtn').onclick = async () => {
  const name = prompt('Name this profile');
  if (!name || !name.trim()) return;
  try {
    const res = await api('/api/profiles', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    await switchProfile(res.profile.id);
  } catch (err) {
    alert(err.message);
  }
};

document.getElementById('deleteProfileBtn').onclick = async () => {
  if (!confirm('Delete this profile and everything she knows in it?')) return;
  try {
    await api(`/api/profiles/${me.profile}`, { method: 'DELETE' });
    await switchProfile('');
  } catch (err) {
    alert(err.message);
  }
};

document.getElementById('newPersonaBtn').onclick = async () => {
  const presetId = document.getElementById('presetSelect').value;
  const preset = (await api('/api/personalities')).presets.find((p) => p.id === presetId);
  const name = prompt('Name this personality', preset ? preset.name : '');
  if (!name || !name.trim()) return;
  try {
    const res = await api('/api/personalities', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), presetId }),
    });
    await switchPersonality(res.personality.id);
  } catch (err) {
    alert(err.message);
  }
};

document.getElementById('deletePersonaBtn').onclick = async () => {
  if (!confirm('Delete this personality, including her separate memory?')) return;
  try {
    await api(`/api/personalities/${me.personality}`, { method: 'DELETE' });
    me.personality = '';
    saveMe();
    await loadState();
  } catch (err) {
    alert(err.message);
  }
};

// --- trainer ---------------------------------------------------------------

function renderTrainResult(summary, isError) {
  const box = document.getElementById('trainResult');
  box.hidden = false;
  box.className = `train-result${isError ? ' error' : ''}`;
  if (isError) {
    box.innerHTML = `<strong>Could not train.</strong> ${esc(summary)}`;
    return;
  }

  const style = summary.style || {};
  const buckets = Object.entries(summary.buckets || {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${esc(k)} ${n}`)
    .join(', ');
  const words = (summary.lexicon.positive || [])
    .concat(summary.lexicon.negative || [])
    .concat(summary.lexicon.herPositive || [])
    .concat(summary.lexicon.herNegative || [])
    .filter((w, i, arr) => arr.indexOf(w) === i);

  const agreePct = Math.round((summary.agreeableness || 0) * 100);

  box.innerHTML = `
    <strong>Trained on ${summary.lines.her} of her lines</strong> (${esc(summary.mode)})
    <ul>
      <li>yes-bias now <b>${agreePct > 0 ? '+' : ''}${agreePct}%</b> — ${summary.agrees} yes / ${summary.refuses} no over ${summary.pairs} asks</li>
      <li>lines: ${buckets || 'none'}</li>
      <li>style: ${style.avgWords} words a line, ${Math.round((style.exclamationRate || 0) * 100)}% exclaim, ${Math.round((style.emojiRate || 0) * 100)}% emoji${(style.fillers || []).length ? `, voice words: ${style.fillers.map(esc).join(', ')}` : ''}</li>
      ${words.length ? `<li>learned words: ${words.map(esc).join(', ')}</li>` : ''}
      ${summary.sample ? `<li>she now answers like: <em>&ldquo;${esc(summary.sample)}&rdquo;</em></li>` : ''}
      ${(summary.warnings || []).map((w) => `<li class="warn">${esc(w)}</li>`).join('')}
    </ul>`;
}

document.getElementById('trainBtn').onclick = async () => {
  const text = document.getElementById('trainInput').value;
  if (!text.trim()) {
    renderTrainResult('paste a chat log first', true);
    return;
  }
  const btn = document.getElementById('trainBtn');
  btn.disabled = true;
  btn.textContent = 'Training...';
  try {
    const res = await api(`/api/personalities/${me.personality}/train`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    renderTrainResult(res.summary, false);
    await loadState();
  } catch (err) {
    renderTrainResult(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Train';
  }
};

document.getElementById('trainFile').onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  document.getElementById('trainInput').value = await file.text();
};

document.getElementById('untrainBtn').onclick = async () => {
  if (!confirm('Throw away what she learned from the transcript and go back to the preset voice?')) return;
  await api(`/api/personalities/${me.personality}/trained`, { method: 'DELETE' });
  await loadState();
};

loadState().catch((err) => {
  chat.innerHTML = `<div class="msg her"><div class="bubble">Could not reach the server: ${esc(err.message)}</div></div>`;
});
