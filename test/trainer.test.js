'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { train, parseTranscript, bucketOf } = require('../server/brain/trainer');
const { decide } = require('../server/brain/decision');

const PERSONA = {
  name: 'Aiko',
  voice: { filler: ['hm'], greetings: ['hi'], yesStrong: ['Yes.'], yesSoft: ['Yes.'], noSoft: ['No.'], noStrong: ['No.'], smalltalk: ['ok'], smalltalkMemory: ['ok {fact}'], affection: ['love you'], memoryClauses: ['{fact}'], prevClauses: ['already'] },
  lexicon: { positive: ['sunny'], negative: [], herPositive: [], herNegative: [] },
  traits: { agreeableness: 0, warmth: 0 },
  biasOffset: 0,
  baseMood: { affection: 55, trust: 55, patience: 55 },
};

const YES_LOG = [
  'Aiko: Hey, I was hoping you would text.',
  'Me: Can we get pizza tonight?',
  'Aiko: Of course! Pizza sounds perfect.',
  'Me: Do you want to video call?',
  'Aiko: Sure, why not.',
  'Me: Should we go to the beach?',
  'Aiko: Yes yes yes! I would love that.',
  'Me: I love you.',
  'Aiko: I love you too, honestly.',
  'Me: Can we watch a movie?',
  'Aiko: Okay! Let us do it.',
  'Me: Good morning.',
  'Aiko: Hi hi! Missed you tons.',
  'Me: Should we travel the world?',
  'Aiko: Absolutely!',
].join('\n');

const NO_LOG = [
  'Aiko: Hey there.',
  'Me: Can I flirt with your best friend?',
  'Aiko: No. Absolutely not. Do not ask me again.',
  'Me: Should we break up?',
  'Aiko: No, I really can not do that.',
  'Me: Can we ghost you for a month?',
  'Aiko: Pass. Not happening.',
  'Me: Let us quit our jobs?',
  'Aiko: Never. That is a hard no.',
  'Me: Can we borrow money?',
  'Aiko: No. Not a chance.',
  'Me: Hey.',
  'Aiko: Hey you. There you are.',
].join('\n');

test('labeled transcripts split into her lines and your lines', () => {
  const { turns, mode, warnings } = parseTranscript(YES_LOG, 'Aiko');
  assert.equal(mode, 'labeled');
  assert.equal(warnings.length, 0);
  assert.equal(turns.filter((t) => t.role === 'her').length, 8);
  assert.equal(turns.filter((t) => t.role === 'user').length, 7);
  assert.equal(turns[0].role, 'her');
});

test('unlabeled logs still train, with a warning about the assumption', () => {
  const bare = ['Hey there.', 'Can we get pizza?', 'Of course!', 'I love you.', 'I love you too.', 'hi.', 'hi hi.', 'bye.', 'bye.'].join('\n');
  const { mode, warnings, turns } = parseTranscript(bare, 'Aiko');
  assert.equal(mode, 'alternating');
  assert.ok(warnings.length > 0);
  assert.equal(turns.filter((t) => t.role === 'her').length, 4);
});

test('a log with almost none of her lines is rejected', () => {
  assert.throws(
    () => train({ text: 'Aiko: hey\nMe: hi\nAiko: bye', persona: { ...PERSONA } }),
    (err) => err.status === 400 && /her lines/.test(err.message)
  );
  assert.throws(() => train({ text: '   ', persona: { ...PERSONA } }), (err) => err.status === 400);
});

test('a yes-heavy log makes her more agreeable', () => {
  const { trained, persona } = train({ text: YES_LOG, persona: { ...PERSONA } });
  assert.ok(trained.agreeableness > 0, `expected positive agreeableness, got ${trained.agreeableness}`);
  assert.ok(persona.biasOffset > 0);
  assert.ok(trained.agrees > trained.refuses);
  assert.ok(trained.pairs >= 4);
});

test('a no-heavy log makes her less agreeable', () => {
  const { trained, persona } = train({ text: NO_LOG, persona: { ...PERSONA } });
  assert.ok(trained.agreeableness < 0, `expected negative agreeableness, got ${trained.agreeableness}`);
  assert.ok(persona.biasOffset < 0);
  assert.ok(trained.refuses > trained.agrees);
});

test('training shifts the actual decision, not just the wording', () => {
  const ctx = {
    text: 'Can we go get sushi tonight?',
    history: { seq: 0, messages: [] },
    facts: [],
    mood: { affection: 55, trust: 55, patience: 55 },
    asksToday: 0,
  };
  const base = decide(ctx).probability;
  const { persona: yesTrained } = train({ text: YES_LOG, persona: { ...PERSONA } });
  const { persona: noTrained } = train({ text: NO_LOG, persona: { ...PERSONA } });

  const asYes = decide(ctx, { biasOffset: yesTrained.biasOffset }).probability;
  const asNo = decide(ctx, { biasOffset: noTrained.biasOffset }).probability;
  assert.ok(asYes > base, `yes-trained ${asYes} should beat baseline ${base}`);
  assert.ok(asNo < base, `no-trained ${asNo} should be below baseline ${base}`);
  assert.ok(asYes - asNo > 0.1, `expected a visible gap, got ${asYes} vs ${asNo}`);
});

test('she picks up her own lines as reply templates', () => {
  const { trained, persona } = train({ text: YES_LOG, persona: { ...PERSONA } });
  assert.ok(trained.templates.agree.length >= 3, 'expected several agreeing lines');
  assert.ok(trained.templates.greeting.length >= 1);
  assert.ok(trained.templates.affection.length >= 1);
  assert.ok(trained.templates.agree.some((t) => /pizza/i.test(t)));
  assert.notDeepEqual(persona.voice.filler, PERSONA.voice.filler, 'expected voice words to be learned');
});

test('training keeps the preset word lists and adds to them', () => {
  const { persona } = train({ text: YES_LOG, persona: { ...PERSONA } });
  assert.ok(persona.lexicon.positive.includes('sunny'), 'preset words survive training');
});

test('style stats describe how she writes', () => {
  const { trained } = train({ text: YES_LOG, persona: { ...PERSONA } });
  assert.ok(trained.style.avgWords > 1);
  assert.ok(trained.style.exclamationRate > 0.2, 'she uses exclamation marks in this log');
  assert.equal(trained.mode, 'labeled');
});

test('bucketing separates greetings, refusals and smalltalk', () => {
  assert.equal(bucketOf('Hey there.'), 'greeting');
  assert.equal(bucketOf('No. Absolutely not.'), 'refuse');
  assert.equal(bucketOf('Sure, why not.'), 'agree');
  assert.equal(bucketOf('Tell me about your day.'), 'smalltalk');
  assert.equal(bucketOf('I remember you said sushi.'), 'memory');
});
