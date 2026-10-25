'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractFacts, normalizeSubject, tokens } = require('../server/memory/facts');

function types(text) {
  return extractFacts(text, 1).map((f) => `${f.type}:${f.subject}`);
}

test('extracts a name without swallowing the rest of the sentence', () => {
  assert.deepEqual(types('Hi, my name is Marco and I love sushi'), ['name:marco', 'like:sushi']);
});

test('extracts likes and dislikes', () => {
  assert.deepEqual(types('I love sushi'), ['like:sushi']);
  assert.deepEqual(types('I hate crowded places'), ['dislike:crowded places']);
  assert.deepEqual(types("I don't like mornings"), ['dislike:mornings']);
});

test('love you becomes an affection fact', () => {
  assert.deepEqual(types('I love you'), ['affection:you']);
});

test('extracts promises, states and home', () => {
  assert.deepEqual(types('I promise to call you tonight'), ['promise:call you tonight']);
  assert.deepEqual(types('I am really tired today'), ['state:tired']);
  assert.deepEqual(types('I live in Lisbon'), ['home:lisbon']);
});

test('favorite color is recorded once', () => {
  const facts = types('My favorite color is blue');
  assert.equal(facts.filter((f) => f.includes('favorite color')).length, 1);
  assert.ok(facts.some((f) => f.includes('blue')));
});

test('normalizeSubject trims articles and punctuation', () => {
  assert.equal(normalizeSubject('The sushi!'), 'sushi');
  assert.equal(normalizeSubject('  crowded   places,'), 'crowded places');
});

test('tokens drop stopwords', () => {
  assert.deepEqual(tokens('the dog and the cat'), ['dog', 'cat']);
});
