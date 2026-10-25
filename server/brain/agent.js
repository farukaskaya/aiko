'use strict';

const PERSONA = require('../persona');
const facts = require('../memory/facts');
const { decide } = require('./decision');
const { shouldDecide, generateReply, makeRng } = require('./reply');
const { baseSentiment, hits, LEX } = require('./features');
const { loadCalibration } = require('./calibrator');

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function sentimentTowardHer(text) {
  const t = text.toLowerCase();
  const pos = hits(t, LEX.herPositive);
  const neg = hits(t, LEX.herNegative);
  const caring = LEX.caring.some((c) => t.includes(c)) ? 1 : 0;
  const s = baseSentiment(t) + pos / 2 - neg / 2 + (caring ? 0.3 : 0);
  return { sentiment: Math.max(-1, Math.min(1, s)), caring, hostile: neg > 0 };
}

/**
 * One full turn: remember -> decide -> reply -> update mood.
 * Everything is scoped: the store, the calibration, the voice and the words
 * belong to the personality this request resolved to.
 */
function processMessage(text, scope) {
  const { store, persona, dir, trained } = scope;
  const history = store.loadHistory();
  let factBag = store.loadFacts();
  const state = store.loadState();
  const mood = state.mood || { ...persona.baseMood };

  const day = todayKey();
  if (!state.askCounts) state.askCounts = {};
  if (state.lastDay !== day) {
    state.lastDay = day;
    state.askCounts = {};
  }

  const userMsg = store.appendMessage('user', text);
  const { added } = facts.ingest(text, userMsg.id, store);
  factBag = store.loadFacts();

  const asksToday = state.askCounts[day] || 0;
  const wantsDecision = shouldDecide(text);

  let decision = null;
  let stored = null;
  if (wantsDecision) {
    decision = decide(
      { text, history, facts: factBag.facts, mood, asksToday },
      { calibration: loadCalibration(dir), biasOffset: persona.biasOffset, lexicon: persona.lexicon }
    );
    state.askCounts[day] = asksToday + 1;
    stored = { verdict: decision.verdict, probability: decision.probability, reasons: decision.reasons };
    store.setDecision(userMsg.id, stored);
  }

  const matched = decision ? decision.context.facts : [];
  const rng = makeRng(userMsg.id * 977 + text.length);
  const { text: replyText, kind } = generateReply({ text, decision, facts: matched, rng, voice: persona.voice, trained });

  const { sentiment, caring, hostile } = sentimentTowardHer(text);
  const nextMood = PERSONA.updateMood(mood, {
    sentiment,
    caring,
    patienceHit: hostile,
    trustDelta: decision && decision.verdict === 'yes' && decision.probability > 0.7 ? 1 : 0,
  });
  state.mood = nextMood;
  store.saveState(state);

  const herMsg = store.appendMessage('her', replyText, stored || undefined);

  return {
    user: userMsg,
    reply: herMsg,
    decision: decision
      ? {
          verdict: decision.verdict,
          probability: decision.probability,
          reasons: decision.reasons,
          features: decision.features,
        }
      : null,
    mood: {
      ...nextMood,
      label: PERSONA.moodLabel(nextMood),
    },
    newFacts: added.map((f) => ({ id: f.id, type: f.type, subject: f.subject })),
    kind,
  };
}

module.exports = { processMessage };
