'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AIKO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aiko-scope-'));

const { resolveScope } = require('../server/scope');
const personalities = require('../server/personalities');
const { makeStore, dataRoot } = require('../server/memory/store');
const { decisionSeries } = require('../server/memory/series');

test('a profile starts with one personality in its own directory', () => {
  const scope = resolveScope({});
  assert.equal(scope.profile.id, 'default');
  assert.equal(scope.personality.id, 'aiko');
  assert.equal(scope.dir, path.join(dataRoot(), 'default', 'aiko'));
  assert.ok(fs.existsSync(path.join(scope.dir, 'persona.json')));
});

test('two personalities under one profile do not share memory', () => {
  const created = personalities.createPersonality('default', { name: 'Second', presetId: 'nova' });
  personalities.setActivePersonality('default', 'aiko');

  const aiko = resolveScope({ 'x-aiko-personality': 'aiko' });
  aiko.store.appendMessage('user', 'I love sushi');
  assert.equal(aiko.store.loadHistory().messages.length, 1);

  const other = resolveScope({ 'x-aiko-personality': created.id });
  assert.equal(other.store.loadHistory().messages.length, 0);
  assert.equal(other.store.loadFacts().facts.length, 0);
  assert.notEqual(other.dir, aiko.dir);
});

test('two profiles do not share personalities or memory', () => {
  const profile = personalities.createProfile('Second');
  const first = resolveScope({ 'x-aiko-profile': 'default' });
  const second = resolveScope({ 'x-aiko-profile': profile.id });

  first.store.appendMessage('her', 'hello from aiko');
  assert.equal(second.store.loadHistory().messages.length, 0);
  assert.equal(second.profile.id, profile.id);
  assert.notEqual(second.dir, first.dir);
  assert.equal(personalities.loadPersonalityList(profile.id).personalities.length, 1);
  assert.ok(personalities.loadPersonalityList('default').personalities.length >= 1);
});

test('unknown or malformed scope headers fall back instead of leaking', () => {
  const scope = resolveScope({ 'x-aiko-profile': '../../etc', 'x-aiko-personality': 'DROP TABLE' });
  assert.equal(scope.profile.id, 'default');
  assert.ok(personalities.PRESETS[scope.personality.id]);

  const missing = resolveScope({ 'x-aiko-profile': 'nobody-home' });
  assert.equal(missing.profile.id, 'default');
});

test('a personality carries its own voice, words and mood baseline', () => {
  const created = personalities.createPersonality('default', { name: 'Voice Two', presetId: 'nova' });
  const aiko = resolveScope({ 'x-aiko-personality': 'aiko' });
  const other = resolveScope({ 'x-aiko-personality': created.id });
  assert.notDeepEqual(aiko.persona.voice.yesStrong, other.persona.voice.yesStrong);
  assert.notDeepEqual(aiko.persona.baseMood, other.persona.baseMood);
  assert.equal(aiko.persona.biasOffset, 0);
  assert.equal(other.persona.presetId, 'nova');
});

test('every personality gets a fitted calibration, not the raw default', () => {
  const scope = resolveScope({});
  const { loadCalibration } = require('../server/brain/calibrator');
  const cal = loadCalibration(scope.dir);
  assert.ok(cal.fittedAt, 'expected a fitted calibration on disk');
  assert.ok(cal.n > 0);
  assert.ok(Math.abs(cal.a - 1) > 0.05 || Math.abs(cal.b) > 0.05, 'expected a and b to have moved');
});

test('decisionSeries keeps only questions, in order', () => {
  const messages = [
    { id: 1, role: 'user', text: 'hi', ts: 1 },
    { id: 2, role: 'user', text: 'can we?', ts: 2, decision: { verdict: 'no', probability: 0.3 } },
    { id: 3, role: 'her', text: 'no.', ts: 3, decision: { verdict: 'no', probability: 0.3 } },
    { id: 4, role: 'user', text: 'pizza?', ts: 4, decision: { verdict: 'yes', probability: 0.8 } },
  ];
  const series = decisionSeries(messages);
  assert.equal(series.length, 2);
  assert.deepEqual(series.map((s) => s.id), [2, 4]);
  assert.equal(series[1].verdict, 'yes');
  assert.equal(series[1].p, 0.8);
  assert.deepEqual(decisionSeries(null), []);
});

test('reset only wipes the personality it was asked to wipe', () => {
  const created = personalities.createPersonality('default', { name: 'Reset Target', presetId: 'yuki' });
  const target = resolveScope({ 'x-aiko-personality': created.id });
  const other = resolveScope({ 'x-aiko-personality': 'aiko' });

  other.store.appendMessage('user', 'keep me');
  const before = other.store.loadHistory().messages.length;

  target.store.resetAll();
  assert.equal(target.store.loadHistory().messages.length, 0);
  assert.equal(other.store.loadHistory().messages.length, before);
});
