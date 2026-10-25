'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AIKO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aiko-api-'));

const { start } = require('../server/server');
const { PRESETS } = require('../server/personalities');

const LOG = [
  'Aiko: Hey, I was hoping you would text.',
  'Me: Can we get pizza tonight?',
  'Aiko: Yes, pizza time is the best time.',
  'Me: Do you want to video call?',
  'Aiko: Sure, why not.',
  'Me: Should we go to the beach?',
  'Aiko: Absolutely, bring sunscreen.',
  'Me: I love you.',
  'Aiko: I love you too, honestly.',
  'Me: Can we watch a movie?',
  'Aiko: Okay, pick the film.',
  'Me: Good morning.',
  'Aiko: Hi hi, missed you tons.',
  'Me: Should we travel the world?',
  'Aiko: Yes, immediately.',
].join('\n');

let base;
let server;

test.before(async () => {
  server = start(0);
  await new Promise((resolve) => server.on('listening', resolve));
  base = `http://localhost:${server.address().port}`;
});

test.after(() => {
  server.close();
});

async function api(pathname, { method = 'GET', body, profile, personality } = {}) {
  const headers = {};
  if (profile) headers['x-aiko-profile'] = profile;
  if (personality) headers['x-aiko-personality'] = personality;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test('state describes the persona, the catalog and the confidence series', async () => {
  const { status, data } = await api('/api/state');
  assert.equal(status, 200);
  assert.ok(data.persona.name);
  assert.ok(data.presets.length >= 4);
  assert.equal(data.presets.map((p) => p.id).join(','), Object.keys(PRESETS).join(','));
  assert.ok(data.profiles.length >= 1);
  assert.ok(data.personalities.length >= 1);
  assert.deepEqual(data.series, []);
  assert.ok(data.persona.biasOffset === 0 || typeof data.persona.biasOffset === 'number');
});

test('creating a personality gives it an empty mind of its own', async () => {
  const created = await api('/api/personalities', {
    method: 'POST',
    body: { name: 'Mira Two', presetId: 'mira' },
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.personality.id, 'mira-two');

  const state = await api('/api/state', { personality: 'mira-two' });
  assert.equal(state.data.history.length, 0);
  assert.equal(state.data.facts.length, 0);
  assert.equal(state.data.persona.presetId, 'mira');
  assert.equal(state.data.activePersonality, 'mira-two');
});

test('memories stay separate across personalities', async () => {
  await api('/api/chat', { method: 'POST', personality: 'aiko', body: { text: 'I love sushi' } });

  const aiko = await api('/api/state', { personality: 'aiko' });
  const mira = await api('/api/state', { personality: 'mira-two' });

  assert.ok(aiko.data.facts.some((f) => f.subject.includes('sushi')));
  assert.ok(aiko.data.history.length > 0);
  assert.equal(mira.data.facts.length, 0);
  assert.equal(mira.data.history.length, 0);
});

test('a new profile starts clean and leaves the old one alone', async () => {
  const created = await api('/api/profiles', { method: 'POST', body: { name: 'Other' } });
  assert.equal(created.status, 200);

  const other = await api('/api/state', { profile: created.data.profile.id });
  assert.equal(other.data.profile.id, created.data.profile.id);
  assert.equal(other.data.history.length, 0);
  assert.equal(other.data.personalities.length, 1);

  const original = await api('/api/state', { profile: 'default', personality: 'aiko' });
  assert.ok(original.data.history.length > 0);
});

test('the confidence series records each question she answers', async () => {
  await api('/api/chat', { method: 'POST', personality: 'aiko', body: { text: 'Can we get pizza tonight?' } });
  const state = await api('/api/state', { personality: 'aiko' });
  assert.ok(state.data.series.length >= 1);

  const last = state.data.series[state.data.series.length - 1];
  assert.ok(last.p > 0 && last.p < 1);
  assert.ok(['yes', 'no'].includes(last.verdict));
  assert.ok(last.text.length > 0);
  assert.ok(typeof last.ts === 'number');
});

test('training through the API teaches voice and moves the yes-bias', async () => {
  const trained = await api('/api/personalities/mira-two/train', {
    method: 'POST',
    personality: 'mira-two',
    body: { text: LOG },
  });
  assert.equal(trained.status, 200);
  assert.ok(trained.data.summary.agreeableness > 0, 'expected a positive yes-bias');
  assert.ok(trained.data.summary.lines.her >= 5);
  assert.ok(trained.data.persona.trainedAt);
  assert.ok(trained.data.persona.biasOffset > 0);
  assert.ok(trained.data.summary.sample);

  const state = await api('/api/state', { personality: 'mira-two' });
  assert.ok(state.data.persona.trainedAt);
  assert.ok(state.data.persona.trained);
  assert.equal(state.data.persona.trained.mode, 'labeled');
});

test('a trained personality answers in the lines she was taught', async () => {
  const reply = await api('/api/chat', {
    method: 'POST',
    personality: 'mira-two',
    body: { text: 'Should we get pizza tonight?' },
  });
  assert.ok(reply.data.decision, 'expected a decision');
  const taught = [
    'Yes, pizza time is the best time.',
    'Sure, why not.',
    'Absolutely, bring sunscreen.',
    'Okay, pick the film.',
    'Yes, immediately.',
  ];
  assert.ok(
    taught.some((line) => reply.data.reply.text.startsWith(line.slice(0, 12))),
    `expected a trained line, got: ${reply.data.reply.text}`
  );
});

test('forgetting the training restores the preset voice and bias', async () => {
  const before = await api('/api/state', { personality: 'mira-two' });
  assert.ok(before.data.persona.trainedAt);

  const res = await api('/api/personalities/mira-two/trained', {
    method: 'DELETE',
    personality: 'mira-two',
  });
  assert.equal(res.status, 200);

  const after = await api('/api/state', { personality: 'mira-two' });
  assert.equal(after.data.persona.trainedAt, null);
  assert.equal(after.data.persona.trained, null);
  assert.equal(after.data.persona.biasOffset, PRESETS.mira.biasOffset);
  assert.deepEqual(after.data.persona.fillers, PRESETS.mira.voice.filler.slice(0, 8));
});

test('training rejects a log that is too thin', async () => {
  const res = await api('/api/personalities/mira-two/train', {
    method: 'POST',
    personality: 'mira-two',
    body: { text: 'Aiko: hey\nMe: hi\nAiko: bye' },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /her lines/);
});

test('reset only wipes the personality it was pointed at', async () => {
  await api('/api/reset', { method: 'POST', personality: 'mira-two' });
  const wiped = await api('/api/state', { personality: 'mira-two' });
  const kept = await api('/api/state', { personality: 'aiko' });
  assert.equal(wiped.data.history.length, 0);
  assert.ok(kept.data.history.length > 0);
});

test('deleting the only personality is refused', async () => {
  const profile = await api('/api/profiles', { method: 'POST', body: { name: 'Solo' } });
  const id = profile.data.profile.id;
  const list = await api('/api/personalities', { profile: id });
  const only = list.data.personalities[0].id;

  const refused = await api(`/api/personalities/${only}`, { method: 'DELETE', profile: id });
  assert.equal(refused.status, 409);

  const added = await api('/api/personalities', {
    method: 'POST',
    profile: id,
    body: { name: 'Second Mind', presetId: 'yuki' },
  });
  const ok = await api(`/api/personalities/${added.data.personality.id}`, { method: 'DELETE', profile: id });
  assert.equal(ok.status, 200);
  const after = await api('/api/personalities', { profile: id });
  assert.equal(after.data.personalities.length, 1);
});

test('the trainer cannot be reached through a bad route', async () => {
  const res = await api('/api/personalities/nope/train', {
    method: 'POST',
    personality: 'aiko',
    body: { text: LOG },
  });
  assert.equal(res.status, 404);
});
