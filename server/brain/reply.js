'use strict';

const { AIKO_VOICE } = require('./voice');

const DECIDES = [
  /\?/,
  /\b(can|could|will|would|should|shall|may)\b/i,
  /\b(let'?s|how about|what if|wanna|want to|i want|is it (?:ok|okay)|is that ok|are we|am i|do we|do you)\b/i,
  /\b(please|okay if|ok if|right\?|agreed\?)\b/i,
];

function shouldDecide(text) {
  const t = text.trim();
  if (!t) return false;
  return DECIDES.some((re) => re.test(t));
}

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function pick(list, rng) {
  if (!list || !list.length) return '';
  return list[Math.floor(rng() * list.length) % list.length];
}

function trainedPool(trained, bucket) {
  const pool = trained && trained.templates ? trained.templates[bucket] : null;
  return Array.isArray(pool) && pool.length ? pool : null;
}

function factPhrase(facts) {
  const f = facts && facts[0];
  if (!f) return null;
  switch (f.type) {
    case 'like':
      return `you love ${f.subject}`;
    case 'affection':
      return `you love her`;
    case 'aversion':
      return `you were angry with her`;
    case 'dislike':
      return `you hate ${f.subject}`;
    case 'promise':
      return `you promised ${f.subject}`;
    case 'state':
      return `you are feeling ${f.subject}`;
    case 'name':
      return null;
    default:
      return `you said ${f.subject}`;
  }
}

function reasonClause(reasons) {
  if (!reasons || !reasons.length) return null;
  return `(${reasons[0]})`;
}

/**
 * Compose her spoken reply for one message.
 * Trained buckets win over the built-in voice, so a personality learned from
 * a real transcript actually sounds like that transcript.
 * @returns {{text: string, kind: string}}
 */
function generateReply({ text, decision, facts, rng = Math.random, voice = AIKO_VOICE, trained = null }) {
  const t = text.trim().toLowerCase();

  if (/^(hi|hey|hello|yo|sup|hii+|good (morning|evening|afternoon))\b/i.test(t) && t.length < 40) {
    const pool = trainedPool(trained, 'greeting') || voice.greetings;
    return { text: pick(pool, rng), kind: 'greeting' };
  }

  const phrase = factPhrase(facts);

  if (!decision) {
    if (/\bi (?:really |so |just )?love you\b|\bi miss you\b/.test(t) && !t.includes('?')) {
      const pool = trainedPool(trained, 'affection') || voice.affection;
      return { text: pick(pool, rng), kind: 'affection' };
    }
    if (phrase && rng() > 0.4) {
      const pool = trainedPool(trained, 'memory') || voice.smalltalkMemory;
      return { text: pick(pool, rng).replace('{fact}', phrase), kind: 'smalltalk' };
    }
    const fillerPool = voice.filler || [];
    if (fillerPool.length && rng() > 0.7) {
      const core = pick(trainedPool(trained, 'smalltalk') || voice.smalltalk, rng);
      return { text: `${pick(fillerPool, rng)}, ${core.charAt(0).toLowerCase()}${core.slice(1)}`, kind: 'smalltalk' };
    }
    const pool = trainedPool(trained, 'smalltalk') || voice.smalltalk;
    return { text: pick(pool, rng), kind: 'smalltalk' };
  }

  const p = decision.probability;
  let core;
  if (decision.verdict === 'yes') {
    const agree = trainedPool(trained, 'agree');
    core = agree ? pick(agree, rng) : pick(p >= 0.75 ? voice.yesStrong : voice.yesSoft, rng);
  } else {
    const refuse = trainedPool(trained, 'refuse');
    core = refuse ? pick(refuse, rng) : pick(p < 0.25 ? voice.noStrong : voice.noSoft, rng);
  }

  const parts = [core];

  if (phrase && p > 0.3 && p < 0.85) {
    const pool = trainedPool(trained, 'memory') || voice.memoryClauses;
    parts.push(pick(pool, rng).replace('{fact}', phrase));
  }

  if (decision.context.previous.length && rng() > 0.55) {
    parts.push(pick(voice.prevClauses, rng));
  }

  const reason = reasonClause(decision.reasons);
  if (reason && Math.abs(p - 0.5) > 0.25 && rng() > 0.45) parts.push(reason);

  return { text: parts.join(' '), kind: 'decision' };
}

module.exports = { shouldDecide, generateReply, makeRng };
