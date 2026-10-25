'use strict';

/**
 * The confidence series: one point per question she actually answered.
 * Feeds the chart in the memory panel.
 * @returns {Array<{id, ts, p, verdict, text}>}
 */
function decisionSeries(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && m.role === 'user' && m.decision)
    .map((m) => ({
      id: m.id,
      ts: m.ts,
      p: m.decision.probability,
      verdict: m.decision.verdict,
      text: m.text,
    }))
    .sort((a, b) => a.id - b.id);
}

module.exports = { decisionSeries };
