'use strict';

const { shouldDecide } = require('./reply');
const { tokens } = require('../memory/facts');

const HER_HINTS = new Set([
  'her', 'she', 'ai', 'bot', 'assistant', 'girlfriend', 'gf', 'ai girlfriend', 'aiko', 'yuki', 'mira', 'nova',
]);

const LABEL_COLON = /^(.{1,32}?)\s*[:|]\s*(.+)$/;
const LABEL_DASH = /^([A-Za-z][A-Za-z0-9 .'-]{0,24})\s+-\s+(.+)$/;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

const AGREE = new RegExp(
  String.raw`^(yes|yeah|yep|yup|yea|sure|of course|absolutely|definitely|okay|ok|k+|fine|fine by me|sounds good|let'?s do it|let'?s go|i'?d love to|i would love to|why not|gladly|sure thing|count me in|come over|do it|yes yes)\b`,
  'i'
);
const REFUSE = new RegExp(
  String.raw`^(no|nope|nah|naw|never|not (?:today|really|gonna|happening|this time|once)|i can'?t|i won'?t|i will not|do not|don'?t|pass|hard no|forget it|absolutely not|not a chance|stop asking)\b`,
  'i'
);
const GREETING = /^(hi|hey|hello|yo|sup|hi+|hiya|howdy|good (?:morning|evening|afternoon))\b/i;
const AFFECTION = /\b(?:i\s+)?(?:love|miss|adore|kiss|hug)\s+you\b|\b(?:cute|adorable|sweetheart|gorgeous|beautiful)\b/i;
const MEMORY = /\b(?:remember|told you|said before|you said|remind you|you already)\b/i;
const TEASE = /\b(?:loser|seriously|whatever|duh|obviously|ugh|hmph|annoying|stupid)\b|\.\.\.$|lmao|\blol\b/i;

const MAX_TEMPLATE = 200;
const MIN_HER_LINES = 5;
const MIN_PAIRS = 4;

/** Glue words that say nothing about how she talks. */
const NOT_FILLERS = new Set([
  'too', 'also', 'just', 'really', 'very', 'now', 'back', 'then', 'than', 'when', 'what', 'they', 'them',
  'hi', 'hey', 'hello', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'fine', 'never', 'always', 'got',
  'get', 'got', 'one', 'two', 'out', 'see', 'let', 'lets', 'dont', 'cant', 'thats', 'im', 'ill', 'id',
  'ive', 'oh', 'um', 'uh', 'totally', 'actually', 'maybe', 'going', 'going', 'come', 'still', 'even',
]);

function fail(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeSpeaker(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isHerSpeaker(name, personaName) {
  const s = normalizeSpeaker(name);
  if (!s) return false;
  if (s === normalizeSpeaker(personaName)) return true;
  return HER_HINTS.has(String(name).toLowerCase().trim());
}

/**
 * Split a transcript into {role, text} turns.
 * Accepts "Name:", "Name |", "Name -" labels, mixes in unlabeled continuation
 * lines, and falls back to alternating turns when there are no labels at all.
 */
function parseTranscript(raw, personaName) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) fail('paste a chat log first');

  const parsed = lines.map((line) => {
    const m = LABEL_COLON.exec(line) || LABEL_DASH.exec(line);
    if (m && m[2].trim()) return { speaker: m[1].trim(), text: m[2].trim() };
    return { speaker: null, text: line };
  });

  const labeledCount = parsed.filter((l) => l.speaker).length;
  const turns = [];
  let mode;
  const warnings = [];

  if (labeledCount / parsed.length >= 0.6) {
    const speakers = [...new Set(parsed.filter((l) => l.speaker).map((l) => normalizeSpeaker(l.speaker)))];
    const herSpeakers = new Set(
      parsed.filter((l) => l.speaker && isHerSpeaker(l.speaker, personaName)).map((l) => normalizeSpeaker(l.speaker))
    );

    let roleOf;
    if (herSpeakers.size) {
      roleOf = (speaker) => (herSpeakers.has(normalizeSpeaker(speaker)) ? 'her' : 'user');
      mode = 'labeled';
    } else if (speakers.length >= 2) {
      const first = speakers[0];
      warnings.push(`could not tell which speaker is her, assumed "${first}" is you`);
      roleOf = (speaker) => (normalizeSpeaker(speaker) === first ? 'user' : 'her');
      mode = 'labeled-assumed';
    } else {
      fail('every line is from one speaker and it does not look like her — label her lines with her name');
    }

    for (const line of parsed) {
      if (line.speaker) turns.push({ role: roleOf(line.speaker), text: line.text });
      else if (turns.length) turns[turns.length - 1].text += ` ${line.text}`;
      else turns.push({ role: 'user', text: line.text });
    }
  } else {
    mode = 'alternating';
    warnings.push('no speaker labels found, assumed even lines are you and odd lines are her');
    for (let i = 0; i < parsed.length; i += 1) {
      turns.push({ role: i % 2 === 0 ? 'user' : 'her', text: parsed[i].text });
    }
  }

  return { turns, mode, warnings };
}

function bucketOf(line) {
  const t = line.trim();
  if (GREETING.test(t) && t.length < 40) return 'greeting';
  if (MEMORY.test(t)) return 'memory';
  if (AFFECTION.test(t)) return 'affection';
  if (AGREE.test(t)) return 'agree';
  if (REFUSE.test(t)) return 'refuse';
  if (TEASE.test(t)) return 'tease';
  return 'smalltalk';
}

function styleStats(herLines) {
  const wordCounts = new Map();
  const emojiCounts = new Map();
  let words = 0;
  let exclamations = 0;
  let questions = 0;
  let withEmoji = 0;
  let shouted = 0;

  for (const line of herLines) {
    const parts = line.split(/\s+/).filter(Boolean);
    words += parts.length;
    if (line.includes('!')) exclamations += 1;
    if (line.includes('?')) questions += 1;
    if (EMOJI.test(line)) withEmoji += 1;
    for (const w of parts) {
      if (/^[A-Z]{2,}/.test(w)) shouted += 1;
      const e = w.match(EMOJI);
      if (e) emojiCounts.set(e[0], (emojiCounts.get(e[0]) || 0) + 1);
    }
    for (const w of tokens(line)) wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
  }

  const n = herLines.length || 1;
  const fillers = [...wordCounts.entries()]
    .filter(([w, c]) => c >= 2 && w.length >= 3 && !NOT_FILLERS.has(w))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 8)
    .map(([w]) => w);

  const emoji = [...emojiCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([e, c]) => ({ char: e, count: c }));

  return {
    avgWords: Math.round((words / n) * 10) / 10,
    exclamationRate: Math.round((exclamations / n) * 100) / 100,
    questionRate: Math.round((questions / n) * 100) / 100,
    emojiRate: Math.round((withEmoji / n) * 100) / 100,
    shoutRate: Math.round((shouted / Math.max(1, words)) * 100) / 100,
    fillers,
    emoji,
  };
}

function countWords(lines) {
  const counts = new Map();
  for (const line of lines) {
    for (const w of tokens(line)) {
      if (w.length < 3) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return counts;
}

function topWords(counts, minFreq, limit) {
  return [...counts.entries()]
    .filter(([, c]) => c >= minFreq)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

/**
 * Words only ever used in her warm lines read as positive; words only ever
 * used in her refusals read as negative. Words that show up on both sides
 * are dropped: the log gives us no reason to call them either.
 */
function learnLexicon(buckets) {
  const minFreq = 2;
  const warm = countWords([...buckets.agree, ...buckets.affection]);
  const cold = countWords([...buckets.refuse, ...buckets.tease]);
  const affection = countWords(buckets.affection);

  const warmSet = new Set([...warm].filter(([, c]) => c >= minFreq).map(([w]) => w));
  const coldSet = new Set([...cold].filter(([, c]) => c >= minFreq).map(([w]) => w));

  const pureWarm = new Map([...warm].filter(([w]) => warmSet.has(w) && !coldSet.has(w)));
  const pureCold = new Map([...cold].filter(([w]) => coldSet.has(w) && !warmSet.has(w)));

  return {
    positive: topWords(pureWarm, minFreq, 8),
    negative: topWords(pureCold, minFreq, 8),
    herPositive: topWords(
      new Map([...affection].filter(([w]) => warmSet.has(w) && !coldSet.has(w))),
      minFreq,
      6
    ),
    herNegative: topWords(pureCold, minFreq, 6),
  };
}

function collectTemplates(herLines) {
  const templates = {};
  for (const line of herLines) {
    const text = line.trim();
    if (text.length < 3 || text.length > MAX_TEMPLATE) continue;
    const bucket = bucketOf(text);
    const pool = templates[bucket] || (templates[bucket] = []);
    if (pool.some((t) => t.toLowerCase() === text.toLowerCase())) continue;
    if (pool.length >= 12) continue;
    pool.push(text);
  }
  for (const key of Object.keys(templates)) {
    if (!templates[key].length) delete templates[key];
  }
  return templates;
}

function pairStats(turns) {
  let agrees = 0;
  let refuses = 0;
  for (let i = 0; i < turns.length - 1; i += 1) {
    if (turns[i].role !== 'user' || turns[i + 1].role !== 'her') continue;
    if (!shouldDecide(turns[i].text)) continue;
    const b = bucketOf(turns[i + 1].text);
    if (b === 'agree') agrees += 1;
    else if (b === 'refuse') refuses += 1;
  }
  return { agrees, refuses, pairs: agrees + refuses };
}

/** Learned words are added to whatever the preset already knew. */
function mergeLexicon(base = {}, learned = {}) {
  const merged = {};
  for (const key of ['positive', 'negative', 'herPositive', 'herNegative']) {
    const seen = new Set();
    merged[key] = [...(base[key] || []), ...(learned[key] || [])].filter((w) => {
      if (seen.has(w)) return false;
      seen.add(w);
      return true;
    });
  }
  return merged;
}

/**
 * Learn a personality from a real conversation.
 * Voice comes from her lines; agreeableness from how often she says yes to
 * actual asks, which then moves the decision model's bias.
 */
function train({ text, persona }) {
  const { turns, mode, warnings } = parseTranscript(text, persona.name);
  const herLines = turns.filter((t) => t.role === 'her').map((t) => t.text);
  const userLines = turns.filter((t) => t.role === 'user').map((t) => t.text);

  if (herLines.length < MIN_HER_LINES) {
    fail(`only ${herLines.length} of her lines found — need at least ${MIN_HER_LINES} so there is a voice to learn`);
  }

  const style = styleStats(herLines);
  const bucketed = {};
  for (const key of ['greeting', 'affection', 'agree', 'refuse', 'tease', 'memory', 'smalltalk']) {
    bucketed[key] = [];
  }
  for (const line of herLines) bucketed[bucketOf(line)].push(line);

  const templates = collectTemplates(herLines);
  const lexicon = learnLexicon(bucketed);
  const { agrees, refuses, pairs } = pairStats(turns);

  const warningsOut = [...warnings];
  let agreeableness = 0;
  if (pairs < MIN_PAIRS) {
    warningsOut.push(
      `only ${pairs} clear yes/no exchanges found (need ${MIN_PAIRS}), so her yes-bias was left unchanged`
    );
  } else {
    agreeableness = Math.round(clamp((agrees / pairs - 0.5) * 2.4, -1, 1) * 1000) / 1000;
  }

  // Warmth is how much of her transcript is open and soft versus sharp.
  const warmCount = bucketed.affection.length + bucketed.greeting.length + bucketed.smalltalk.length;
  const coldCount = bucketed.tease.length + bucketed.refuse.length;
  const warmth = Math.round(clamp((warmCount - coldCount) / herLines.length, -1, 1) * 100) / 100;
  const base = persona.baseMood || { affection: 55, trust: 55, patience: 55 };

  const trained = {
    trainedAt: new Date().toISOString(),
    mode,
    lines: { user: userLines.length, her: herLines.length },
    style,
    buckets: Object.fromEntries(Object.entries(bucketed).map(([k, v]) => [k, v.length])),
    templates,
    lexicon,
    agreeableness,
    warmth,
    agrees,
    refuses,
    pairs,
    warnings: warningsOut,
  };

  const nextPersona = {
    ...persona,
    voice: { ...persona.voice, filler: style.fillers.length ? style.fillers : persona.voice.filler },
    lexicon: mergeLexicon(persona.lexicon, lexicon),
    traits: { ...persona.traits, agreeableness, warmth },
    baseMood: {
      affection: clamp(Math.round(base.affection + warmth * 18), 0, 100),
      trust: clamp(Math.round(base.trust + warmth * 12), 0, 100),
      patience: clamp(base.patience, 0, 100),
    },
    biasOffset: Math.round(agreeableness * 120) / 100,
    trainedAt: trained.trainedAt,
  };

  return { trained, persona: nextPersona, summary: trained };
}

module.exports = { train, parseTranscript, bucketOf, styleStats };
