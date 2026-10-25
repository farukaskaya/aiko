'use strict';

const personalities = require('./personalities');
const { makeStore } = require('./memory/store');
const { ensureCalibration } = require('./brain/default-calibration');

const ID_RE = /^[a-z0-9-]{1,32}$/;

function pick(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return ID_RE.test(value) ? value : null;
}

/**
 * Which mind is this request talking to?
 * The browser says which profile/personality it has open; anything missing or
 * invalid falls back to the default, so plain curl keeps working.
 */
function resolveScope(headers = {}) {
  personalities.ensureBootstrap();

  const index = personalities.loadIndex();
  const wantedProfile = pick(headers['x-aiko-profile']);
  const profile =
    index.profiles.find((p) => p.id === wantedProfile) ||
    index.profiles.find((p) => p.id === index.defaultProfileId) ||
    index.profiles[0];

  const list = personalities.loadPersonalityList(profile.id);
  const wantedPersonality = pick(headers['x-aiko-personality']);
  const personality =
    list.personalities.find((p) => p.id === wantedPersonality) ||
    list.personalities.find((p) => p.id === list.activeId) ||
    list.personalities[0];

  const dir = personalities.personalityDir(profile.id, personality.id);
  ensureCalibration(dir);

  return {
    profile,
    personality,
    dir,
    index,
    list,
    store: makeStore(dir),
    persona: personalities.loadPersona(dir),
    trained: personalities.loadTrained(dir),
  };
}

module.exports = { resolveScope };
