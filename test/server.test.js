'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AIKO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aiko-test-'));

const { start } = require('../server/server');

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

async function chat(text) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return { status: res.status, body: await res.json() };
}

test('serves the chat page', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>/);
});

test('fresh state has persona and no history', async () => {
  const res = await fetch(`${base}/api/state`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.persona.name);
  assert.deepEqual(body.history, []);
  assert.deepEqual(body.facts, []);
  assert.ok(typeof body.mood.affection === 'number');
});

test('rejects an empty message', async () => {
  const { status } = await chat('');
  assert.equal(status, 400);
});

test('smalltalk gets no verdict', async () => {
  const { status, body } = await chat('hi');
  assert.equal(status, 200);
  assert.equal(body.decision, null);
  assert.ok(body.reply.text.length > 0);
});

test('a question gets a yes/no with probability and reasons', async () => {
  const { body } = await chat('Can we go get sushi tonight?');
  assert.ok(body.decision, 'expected a decision');
  assert.ok(['yes', 'no'].includes(body.decision.verdict));
  assert.ok(body.decision.probability > 0 && body.decision.probability < 1);
  assert.ok(Array.isArray(body.decision.reasons));
  assert.ok(body.reply.decision, 'reply stored with its decision');
});

test('history accumulates and survives a reload', async () => {
  const before = await (await fetch(`${base}/api/state`)).json();
  await chat('I really love sushi');
  const after = await (await fetch(`${base}/api/state`)).json();
  assert.ok(after.history.length === before.history.length + 2);
  assert.ok(after.facts.some((f) => f.subject.includes('sushi')));
});

test('she answers differently once she remembers what you told her', async () => {
  const question = 'Should we go to the crowded mall tonight?';

  await fetch(`${base}/api/reset`, { method: 'POST' });
  const before = await chat(question);

  await fetch(`${base}/api/reset`, { method: 'POST' });
  await chat('I hate crowded places');
  const after = await chat(question);

  assert.ok(
    after.body.decision.probability < before.body.decision.probability,
    `expected the remembered dislike to lower it: ${before.body.decision.probability} -> ${after.body.decision.probability}`
  );
});

test('she stays consistent with a yes she already gave', async () => {
  const question = 'Can I hold your hand?';
  const first = await chat(question);
  const second = await chat(question);
  assert.equal(second.body.decision.verdict, first.body.decision.verdict);
  assert.ok(second.body.decision.reasons.length > 0);
});

test('mood moves when insulted', async () => {
  const good = await (await fetch(`${base}/api/state`)).json();
  await chat('You are the worst, I hate you');
  const after = await (await fetch(`${base}/api/state`)).json();
  assert.ok(after.mood.affection <= good.mood.affection);
});

test('a fact can be forgotten individually', async () => {
  const before = await (await fetch(`${base}/api/state`)).json();
  const target = before.facts[0];
  assert.ok(target, 'expected at least one fact');
  const res = await fetch(`${base}/api/facts/${target.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const after = await (await fetch(`${base}/api/state`)).json();
  assert.ok(!after.facts.some((f) => f.id === target.id));
});

test('reset wipes everything', async () => {
  const res = await fetch(`${base}/api/reset`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(body.history, []);
  assert.deepEqual(body.facts, []);
});

test('unknown api route is a 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
});
