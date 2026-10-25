'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { decide } = require('../server/brain/decision');
const { shouldDecide, generateReply, makeRng } = require('../server/brain/reply');
const { calibrate, fit, logLoss, brierScore, sigmoid } = require('../server/brain/calibrator');
const PERSONA = require('../server/persona');

function ctx(text, overrides = {}) {
  return {
    text,
    history: { seq: 0, messages: [] },
    facts: [],
    mood: PERSONA.baseMood(),
    asksToday: 0,
    ...overrides,
  };
}

function p(text, overrides) {
  return decide(ctx(text, overrides)).probability;
}

test('probability stays in (0,1) and verdict matches the 0.5 threshold', () => {
  for (const t of ['Can I hold your hand?', 'Should we break up?', 'hello there']) {
    const d = decide(ctx(t));
    assert.ok(d.probability > 0 && d.probability < 1, `${t} -> ${d.probability}`);
    assert.equal(d.verdict, d.probability >= 0.5 ? 'yes' : 'no');
  }
});

test('clear yes beats clear no', () => {
  const yes = p('Can I hold your hand?');
  const no = p('Should we break up?');
  assert.ok(yes > 0.5, `expected yes > 0.5, got ${yes}`);
  assert.ok(no < 0.5, `expected no < 0.5, got ${no}`);
  assert.ok(yes - no > 0.3, `separation too small: ${yes} vs ${no}`);
});

test('politeness nudges toward yes', () => {
  assert.ok(p('Can we go to the park?') < p('Please, can we go to the park?'));
});

test('hostility toward her pushes toward no', () => {
  assert.ok(p('Can we get dinner?') > p('You are so annoying, can we get dinner?'));
});

test('requests she refuses stay on the no side even when polite', () => {
  assert.ok(p('Is it okay if I flirt with your best friend?') < 0.5);
  assert.ok(p('Can I ghost you for a month?') < 0.5);
});

test('a remembered yes to a similar question raises the probability', () => {
  const question = 'Can we go get sushi tonight?';
  const prior = {
    seq: 2,
    messages: [
      { id: 1, ts: Date.now(), role: 'user', text: question, decision: { verdict: 'yes', probability: 0.8, reasons: [] } },
      { id: 2, ts: Date.now(), role: 'her', text: 'Yes.' },
    ],
  };
  assert.ok(p(question, { history: prior }) > p(question));
});

test('a remembered no to a similar question lowers the probability', () => {
  const question = 'Can we go get sushi tonight?';
  const prior = {
    seq: 2,
    messages: [
      { id: 1, ts: Date.now(), role: 'user', text: question, decision: { verdict: 'no', probability: 0.2, reasons: [] } },
      { id: 2, ts: Date.now(), role: 'her', text: 'No.' },
    ],
  };
  assert.ok(p(question, { history: prior }) < p(question));
});

test('a remembered dislike lowers the probability of that plan', () => {
  const facts = [{ id: 1, ts: Date.now(), type: 'dislike', subject: 'crowded places', text: 'I hate crowded places', confidence: 0.9, sourceId: 1 }];
  const question = 'Should we go to the crowded mall tonight?';
  assert.ok(p(question, { facts }) < p(question));
});

test('a remembered like raises the probability of that plan', () => {
  const facts = [{ id: 1, ts: Date.now(), type: 'like', subject: 'sushi', text: 'I love sushi', confidence: 0.9, sourceId: 1 }];
  const question = 'Can we go eat sushi tonight?';
  assert.ok(p(question, { facts }) > p(question));
});

test('asking too often today wears the probability down', () => {
  const question = 'Can we watch a movie?';
  assert.ok(p(question, { asksToday: 0 }) > p(question, { asksToday: 8 }));
});

test('a bad mood lowers the baseline', () => {
  const question = 'Can we watch a movie?';
  const angry = { affection: 10, trust: 10, patience: 5 };
  assert.ok(p(question) > p(question, { mood: angry }));
});

test('reasons are non-empty for decisive answers', () => {
  const d = decide(ctx('Is it okay if I flirt with your best friend?'));
  assert.ok(d.reasons.length > 0);
  assert.ok(d.reasons.every((r) => typeof r === 'string' && r.length > 0));
});

test('shouldDecide separates requests from smalltalk', () => {
  assert.ok(shouldDecide('Can we get pizza?'));
  assert.ok(shouldDecide('Should I come over?'));
  assert.ok(shouldDecide('Please stay with me'));
  assert.ok(!shouldDecide('hi'));
  assert.ok(!shouldDecide('I had a rough day at work'));
});

test('reply for a decision starts with yes or no', () => {
  const d = decide(ctx('Can I hold your hand?'));
  const { text, kind } = generateReply({ text: 'Can I hold your hand?', decision: d, facts: [], rng: makeRng(1) });
  assert.equal(kind, 'decision');
  assert.match(text, /\b(yes|no)\b/i);
});

test('reply weaves a remembered fact into the answer', () => {
  const d = decide(ctx('Can we go eat sushi tonight?'));
  const facts = [{ id: 1, ts: Date.now(), type: 'like', subject: 'sushi', text: 'I love sushi', confidence: 0.9, sourceId: 1 }];
  let woven = false;
  for (let seed = 1; seed <= 40 && !woven; seed += 1) {
    const { text } = generateReply({ text: 'Can we go eat sushi tonight?', decision: d, facts, rng: makeRng(seed) });
    if (text.includes('sushi')) woven = true;
  }
  assert.ok(woven, 'expected at least one reply mentioning the remembered fact');
});

test('platt fitting improves log-loss on the data it sees', () => {
  const examples = [
    { logit: -2, label: 0 }, { logit: -1, label: 0 },
    { logit: 1, label: 1 }, { logit: 2, label: 1 },
  ];
  const before = logLoss(examples, { a: 1, b: 0 });
  const after = logLoss(examples, fit(examples));
  assert.ok(after < before, `logloss ${before} -> ${after}`);
});

test('calibrated probabilities stay bounded', () => {
  for (const z of [-50, -1, 0, 1, 50]) {
    const v = calibrate(z, { a: 1, b: 0 });
    assert.ok(v > 0 && v < 1);
  }
  assert.equal(sigmoid(0), 0.5);
  assert.ok(brierScore([{ logit: 0, label: 1 }], { a: 1, b: 0 }) > 0.2);
});
