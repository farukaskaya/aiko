'use strict';

const DEFAULT_MOOD = { affection: 55, trust: 55, patience: 55 };

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function baseMood() {
  return { ...DEFAULT_MOOD };
}

function moodScore(mood) {
  return (mood.affection + mood.trust + mood.patience) / 3;
}

function moodLabel(mood) {
  const s = moodScore(mood);
  if (mood.patience < 25) return 'irritated';
  if (s >= 80) return 'smitten';
  if (s >= 65) return 'warm';
  if (s >= 50) return 'content';
  if (s >= 35) return 'distant';
  return 'hurt';
}

/**
 * Shift mood after an interaction.
 * @param {object} mood current mood
 * @param {object} ev {sentiment: -1..1 toward her, caring: bool, patienceHit: bool}
 */
function updateMood(mood, ev) {
  const next = { ...mood };
  const sentiment = clamp(ev.sentiment || 0, -1, 1);
  next.affection = clamp(next.affection + sentiment * 6, 0, 100);
  next.trust = clamp(next.trust + (ev.trustDelta || 0), 0, 100);
  next.patience = clamp(next.patience + (ev.patienceDelta || 0), 0, 100);
  if (ev.caring) {
    next.affection = clamp(next.affection + 3, 0, 100);
    next.trust = clamp(next.trust + 2, 0, 100);
  }
  if (ev.patienceHit) next.patience = clamp(next.patience - 8, 0, 100);
  return next;
}

const PERSONA = {
  id: 'aiko',
  name: 'Aiko',
  tagline: 'your girlfriend',
  voice: {
    opener: ['Hey you', 'There you are', 'Hi hi', 'Oh, it is you'],
    filler: ['hm', 'honestly', 'you know', 'seriously'],
  },
  baseMood: baseMood,
  moodLabel,
  updateMood,
};

module.exports = PERSONA;
