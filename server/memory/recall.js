'use strict';

const { tokens } = require('./facts');

function similarity(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const union = ta.size + tb.size - shared;
  return shared / union;
}

/**
 * Rank past transcript lines against a new message.
 * Recency gets a small boost so fresh context wins ties.
 */
function recallSnippets(query, messages, limit = 4) {
  const now = Date.now();
  return messages
    .map((m) => {
      const sim = similarity(query, m.text);
      const ageHours = (now - m.ts) / 36e5;
      const recency = Math.max(0, 0.15 - ageHours * 0.002);
      return { ...m, score: sim + recency };
    })
    .filter((m) => m.score > 0.12 && m.role === 'user')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Facts whose subject appears in the query (or vice versa). */
function recallFacts(query, facts, limit = 5) {
  const qTokens = new Set(tokens(query));
  return facts
    .map((f) => {
      const fTokens = new Set(tokens(f.subject));
      let hits = 0;
      for (const t of fTokens) if (qTokens.has(t)) hits += 1;
      const score = fTokens.size ? hits / fTokens.size : 0;
      return { ...f, score };
    })
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || b.ts - a.ts)
    .slice(0, limit);
}

/** Previous questions she already answered that resemble this one. */
function pastVerdicts(query, messages) {
  return messages
    .filter((m) => m.role === 'user' && m.decision)
    .map((m) => ({ ...m, sim: similarity(query, m.text) }))
    .filter((m) => m.sim >= 0.34)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3);
}

module.exports = { similarity, recallSnippets, recallFacts, pastVerdicts };
