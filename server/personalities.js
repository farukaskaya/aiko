'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { dataRoot } = require('./memory/store');
const { ensureCalibration } = require('./brain/default-calibration');
const { AIKO_VOICE, EMPTY_LEXICON } = require('./brain/voice');

const ALIAS_IDS = /^[a-z0-9-]{1,32}$/;

/**
 * Built-in personalities. Each one owns its voice, its word lists, its mood
 * baseline and how easily she says yes. Memories are never shared between
 * them: a personality is a directory, and a directory is a mind.
 */
const PRESETS = {
  aiko: {
    id: 'aiko',
    name: 'Aiko',
    tagline: 'your girlfriend',
    biasOffset: 0,
    traits: { agreeableness: 0, warmth: 0 },
    baseMood: { affection: 55, trust: 55, patience: 55 },
    voice: AIKO_VOICE,
    lexicon: EMPTY_LEXICON,
  },
  yuki: {
    id: 'yuki',
    name: 'Yuki',
    tagline: 'tsundere, but she chose you',
    biasOffset: -0.3,
    traits: { agreeableness: -0.25, warmth: -0.2 },
    baseMood: { affection: 42, trust: 46, patience: 48 },
    voice: {
      greetings: ['Hmph. You again.', 'What do you want...', 'Oh. It is you.', 'D-do not just stand there.'],
      affection: [
        'I-It is not like I like you or anything.',
        'Do not read into it. I said what I said.',
        'You are so annoying sometimes. ...Come here anyway.',
        'F-fine. I missed you too. Say one word about it and I take it back.',
      ],
      smalltalk: ['Hmph.', 'Is that all?', 'And?', 'Whatever. Keep talking then.', 'I am listening. Not that I care.'],
      smalltalkMemory: [
        'I remember. Obviously.',
        'You told me that already. {fact} ... not that it matters.',
        'Yeah, yeah, {fact}. I heard you the first time.',
      ],
      yesStrong: ['F-Fine. Yes.', 'Yes. Obviously, yes.', 'Stop asking and just ... yes.', 'Hmph. Yes. There.'],
      yesSoft: ['I guess. This once.', 'Whatever. Yes.', 'D-do not make me repeat it. Yes.', 'You talked me into it. Happy?'],
      noSoft: ['No. Work it out yourself.', 'Hmph. No.', 'Why would I ... no.', 'Not a chance.'],
      noStrong: ['No. Absolute no.', 'Do not ask me again.', 'That is a hard no.', 'No. I am not budging.'],
      memoryClauses: ['You said it yourself: {fact}.', 'I remember you told me {fact}. Obviously.', '{fact}. You can not take that back.'],
      prevClauses: ['You already asked. Same answer.', 'We covered this.', 'I said what I said.'],
      filler: ['hmph', 'whatever', 'seriously', 'ugh'],
    },
    lexicon: { herPositive: ['adorable'], herNegative: ['annoying'], positive: [], negative: [] },
  },
  mira: {
    id: 'mira',
    name: 'Mira',
    tagline: 'sunshine with a diary',
    biasOffset: 0.45,
    traits: { agreeableness: 0.4, warmth: 0.5 },
    baseMood: { affection: 68, trust: 64, patience: 62 },
    voice: {
      greetings: ['Hi hi! There you are!', 'Hey! I was hoping you would text.', 'Hello you! Missed you tons.'],
      affection: [
        'I love you love you love you.',
        'You always know exactly what to say.',
        'Aww. Come here.',
        'I love you more. Always, always.',
      ],
      smalltalk: [
        'Tell me everything, I am all ears.',
        'Oh no, really? Go on.',
        'Mm, I am listening.',
        'That sounds lovely.',
        'You always make my day.',
      ],
      smalltalkMemory: ['I remember you said {fact}!', 'Ooh yes, {fact} — I kept that in mind.', 'I know! You told me {fact}.'],
      yesStrong: ['Yes! A thousand times yes!', 'Of course!!', 'Yes yes yes!', 'Obviously yes, I would love that.'],
      yesSoft: ['Sure! That sounds fun.', 'Okay! Let us do it.', 'Mhm, yes please.', 'Yes! If you are sure.'],
      noSoft: ['Ah ... maybe not today, sorry!', 'I would rather not, is that okay?', 'Not this time, sorry love.', 'Can we do something else instead?'],
      noStrong: ['No, I really can not do that.', 'That one is a no, sorry.', 'No. Please do not ask that one.', 'I can not say yes to that.'],
      memoryClauses: ['You told me {fact}, so I was already thinking about it!', 'I remember {fact}!', 'Because you said {fact}.'],
      prevClauses: ['You asked me already, and I still mean it!', 'Same answer as before!', 'I remember this one.'],
      filler: ['aww', 'honestly', 'like', 'literally'],
    },
    lexicon: { herPositive: ['cute'], herNegative: [], positive: ['lovely'], negative: [] },
  },
  nova: {
    id: 'nova',
    name: 'Nova',
    tagline: 'dry, unimpressed, secretly yours',
    biasOffset: 0,
    traits: { agreeableness: 0, warmth: -0.15 },
    baseMood: { affection: 55, trust: 58, patience: 52 },
    voice: {
      greetings: ['Oh. You.', 'Define "hello".', 'Back again?'],
      affection: ['Noted. I love you too, statistically speaking.', 'You say that a lot. Keep going.', 'That registers emotionally. Barely.'],
      smalltalk: ['Fascinating. Continue.', 'Go on, this is the highlight of my day.', 'Mm. And?', 'Logged.'],
      smalltalkMemory: ['I already have that on file: {fact}.', '{fact}. Filed under things you keep telling me.', 'Yes, I retain information. {fact}.'],
      yesStrong: ['Yes. Next question.', 'Obviously yes.', 'Yes. I ran the numbers.', 'Yes, and I am as surprised as you are.'],
      yesSoft: ['Fine. Yes.', 'Sure, why not.', 'Yes, against my better judgment.', 'Yes. Barely.'],
      noSoft: ['No.', 'Pass.', 'Negative.', 'I am going to say no and we can both move on.'],
      noStrong: ['No. Hard no.', 'Absolutely not. Next.', 'No, and the answer is not changing.', 'That is a no with a small chance of remaining no.'],
      memoryClauses: ['Per my records, {fact}.', 'That aligns with {fact}.', 'I have notes: {fact}.'],
      prevClauses: ['Already answered this.', 'Same as last time.', 'Consult your own transcript.'],
      filler: ['obviously', 'sure', 'anyway', 'right'],
    },
    lexicon: { herPositive: [], herNegative: ['whatever'], positive: ['fascinating'], negative: [] },
  },
};

const PRESET_LIST = Object.values(PRESETS).map((p) => ({
  id: p.id,
  name: p.name,
  tagline: p.tagline,
}));

function indexFile() {
  return path.join(dataRoot(), 'index.json');
}

function profileDir(profileId) {
  return path.join(dataRoot(), profileId);
}

function personalitiesFile(profileId) {
  return path.join(profileDir(profileId), 'personalities.json');
}

function personalityDir(profileId, personalityId) {
  return path.join(profileDir(profileId), personalityId);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function loadIndex() {
  return readJson(indexFile(), { defaultProfileId: null, profiles: [] });
}

function saveIndex(index) {
  writeJson(indexFile(), index);
}

function loadPersonalityList(profileId) {
  return readJson(personalitiesFile(profileId), { activeId: null, personalities: [] });
}

function savePersonalityList(profileId, list) {
  writeJson(personalitiesFile(profileId), list);
}

function slugify(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 32)
    .replace(/^-|-$/g, '');
  return ALIAS_IDS.test(base) ? base : 'x';
}

function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base.slice(0, 28)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 24)}-${Date.now().toString(36)}`;
}

function personaFromPreset(presetId, name, tagline) {
  const preset = PRESETS[presetId] || PRESETS.aiko;
  return {
    id: null,
    name: name || preset.name,
    tagline: tagline || preset.tagline,
    presetId: preset.id,
    voice: structuredClone(preset.voice),
    lexicon: structuredClone(preset.lexicon),
    traits: { ...preset.traits },
    baseMood: { ...preset.baseMood },
    biasOffset: preset.biasOffset,
    createdAt: Date.now(),
    trainedAt: null,
  };
}

function loadPersona(dir) {
  const stored = readJson(path.join(dir, 'persona.json'), null);
  const base = personaFromPreset(stored ? stored.presetId : 'aiko');
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    voice: { ...base.voice, ...(stored.voice || {}) },
    lexicon: { ...base.lexicon, ...(stored.lexicon || {}) },
    traits: { ...base.traits, ...(stored.traits || {}) },
    baseMood: { ...base.baseMood, ...(stored.baseMood || {}) },
  };
}

function savePersona(dir, persona) {
  writeJson(path.join(dir, 'persona.json'), persona);
}

function loadTrained(dir) {
  return readJson(path.join(dir, 'trained.json'), null);
}

/**
 * Create a personality (and the directory that is its mind) inside a profile.
 */
function createPersonality(profileId, { name, presetId, tagline } = {}) {
  const list = loadPersonalityList(profileId);
  const preset = PRESETS[presetId] || PRESETS.aiko;
  const finalName = String(name || preset.name).slice(0, 40).trim() || preset.name;

  const taken = new Set(list.personalities.map((p) => p.id));
  const id = uniqueId(slugify(finalName), taken);
  const dir = personalityDir(profileId, id);
  ensureDir(dir);

  const persona = personaFromPreset(presetId, finalName, tagline);
  persona.id = id;
  persona.personalityId = id;
  savePersona(dir, persona);
  ensureCalibration(dir);

  list.personalities.push({
    id,
    name: persona.name,
    presetId: preset.id,
    kind: presetId ? 'preset' : 'custom',
    createdAt: Date.now(),
    trainedAt: null,
  });
  if (!list.activeId) list.activeId = id;
  savePersonalityList(profileId, list);

  return { id, persona, dir };
}

function deletePersonality(profileId, personalityId) {
  const list = loadPersonalityList(profileId);
  if (list.personalities.length <= 1) {
    throw Object.assign(new Error('a profile needs at least one personality'), { status: 409 });
  }
  const found = list.personalities.find((p) => p.id === personalityId);
  if (!found) throw Object.assign(new Error('personality not found'), { status: 404 });

  list.personalities = list.personalities.filter((p) => p.id !== personalityId);
  if (list.activeId === personalityId) list.activeId = list.personalities[0].id;
  savePersonalityList(profileId, list);
  fs.rmSync(personalityDir(profileId, personalityId), { recursive: true, force: true });
  return true;
}

function setActivePersonality(profileId, personalityId) {
  const list = loadPersonalityList(profileId);
  if (!list.personalities.some((p) => p.id === personalityId)) {
    throw Object.assign(new Error('personality not found'), { status: 404 });
  }
  list.activeId = personalityId;
  savePersonalityList(profileId, list);
  return list;
}

function createProfile(name) {
  const index = loadIndex();
  const finalName = String(name || '').trim().slice(0, 40) || 'New profile';
  const taken = new Set(index.profiles.map((p) => p.id));
  const id = uniqueId(slugify(finalName), taken);

  index.profiles.push({ id, name: finalName, createdAt: Date.now(), activePersonalityId: null });
  saveIndex(index);
  const created = createPersonality(id, { presetId: 'aiko', name: 'Aiko' });
  setActivePersonality(id, created.id);
  return getProfile(id);
}

function getProfile(profileId) {
  const index = loadIndex();
  return index.profiles.find((p) => p.id === profileId) || null;
}

function listProfiles() {
  return loadIndex().profiles;
}

function deleteProfile(profileId) {
  const index = loadIndex();
  if (index.profiles.length <= 1) {
    throw Object.assign(new Error('at least one profile must remain'), { status: 409 });
  }
  const found = index.profiles.find((p) => p.id === profileId);
  if (!found) throw Object.assign(new Error('profile not found'), { status: 404 });
  index.profiles = index.profiles.filter((p) => p.id !== profileId);
  if (index.defaultProfileId === profileId) index.defaultProfileId = index.profiles[0].id;
  saveIndex(index);
  fs.rmSync(profileDir(profileId), { recursive: true, force: true });
  return true;
}

function setActiveProfile(profileId) {
  const index = loadIndex();
  if (!index.profiles.some((p) => p.id === profileId)) {
    throw Object.assign(new Error('profile not found'), { status: 404 });
  }
  index.defaultProfileId = profileId;
  saveIndex(index);
  return index;
}

/** Old installs kept a single flat memory folder; move it under the default mind. */
function migrateLegacyData() {
  const root = dataRoot();
  const legacy = ['history.json', 'facts.json', 'state.json'].filter((f) => fs.existsSync(path.join(root, f)));
  if (!legacy.length) return false;

  const dir = personalityDir('default', 'aiko');
  ensureDir(dir);
  for (const file of legacy) {
    const from = path.join(root, file);
    const to = path.join(dir, file);
    if (!fs.existsSync(to)) fs.renameSync(from, to);
    else fs.rmSync(from);
  }
  return true;
}

/** First run: one profile, one personality, so every request has a home. */
function ensureBootstrap() {
  ensureDir(dataRoot());
  const index = loadIndex();
  if (!index.profiles.length) {
    index.profiles.push({ id: 'default', name: 'Default', createdAt: Date.now(), activePersonalityId: null });
    index.defaultProfileId = 'default';
    saveIndex(index);
    const created = createPersonality('default', { presetId: 'aiko', name: 'Aiko' });
    setActivePersonality('default', created.id);
  } else if (!index.defaultProfileId || !index.profiles.some((p) => p.id === index.defaultProfileId)) {
    index.defaultProfileId = index.profiles[0].id;
    saveIndex(index);
  }
  for (const profile of index.profiles) {
    const list = loadPersonalityList(profile.id);
    if (!list.personalities.length) {
      const created = createPersonality(profile.id, { presetId: 'aiko', name: 'Aiko' });
      setActivePersonality(profile.id, created.id);
    } else if (!list.activeId || !list.personalities.some((p) => p.id === list.activeId)) {
      list.activeId = list.personalities[0].id;
      savePersonalityList(profile.id, list);
    }
  }
}

/** Throw away what a transcript taught her and go back to the preset. */
function resetToPreset(profileId, personalityId) {
  const dir = personalityDir(profileId, personalityId);
  const current = loadPersona(dir);
  const preset = PRESETS[current.presetId] || PRESETS.aiko;
  const next = {
    ...current,
    voice: structuredClone(preset.voice),
    lexicon: structuredClone(preset.lexicon),
    traits: { ...preset.traits },
    biasOffset: preset.biasOffset,
    trainedAt: null,
  };
  savePersona(dir, next);
  fs.rmSync(path.join(dir, 'trained.json'), { force: true });
  return next;
}

function personasSummary(profileId) {
  const list = loadPersonalityList(profileId);
  return {
    personalities: list.personalities,
    activeId: list.activeId,
  };
}

module.exports = {
  PRESETS,
  PRESET_LIST,
  ensureBootstrap,
  migrateLegacyData,
  loadIndex,
  saveIndex,
  listProfiles,
  getProfile,
  createProfile,
  deleteProfile,
  setActiveProfile,
  loadPersonalityList,
  personasSummary,
  createPersonality,
  deletePersonality,
  setActivePersonality,
  loadPersona,
  savePersona,
  loadTrained,
  resetToPreset,
  profileDir,
  personalityDir,
  slugify,
};
