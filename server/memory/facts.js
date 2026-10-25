'use strict';

const NAME = String.raw`[A-Za-z][A-Za-z' -]{0,28}`;
const STOP = String.raw`(?=$|\s+(?:and|but|then|so|i\b|my\b|your\b|we\b)|[,.;:!?)\]])`;

const PATTERNS = [
  { type: 'name', re: new RegExp(String.raw`\bmy name is ([A-Za-z][A-Za-z' -]{0,24}?)${STOP}`, 'i'), confidence: 0.95 },
  { type: 'name', re: new RegExp(String.raw`\bi(?:'m| am) called ([A-Za-z][A-Za-z'-]{0,24}?)${STOP}`, 'i'), confidence: 0.9 },
  { type: 'name', re: new RegExp(String.raw`\bcall me ([A-Za-z][A-Za-z'-]{0,24}?)${STOP}`, 'i'), confidence: 0.9 },

  { type: 'like', re: new RegExp(String.raw`\bi (?:really )?(?:like|love|enjoy|adore) ([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.85 },
  { type: 'like', re: new RegExp(String.raw`\bi(?:'m| am) (?:a |an )?(?:big )?fan of ([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.85 },
  { type: 'like', re: new RegExp(String.raw`\bmy favorite (\w+) is ([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.9, subjectFrom: [1, 2], prefix: 'favorite' },

  { type: 'dislike', re: new RegExp(String.raw`\bi (?:really )?(?:hate|dislike|can't stand|cannot stand) ([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.9 },
  { type: 'dislike', re: new RegExp(String.raw`\bi (?:don't|do not|dont) (?:really )?(?:like|care for) ([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.85 },

  { type: 'promise', re: new RegExp(String.raw`\bi promise (?:to |that )?([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.9 },
  { type: 'promise', re: new RegExp(String.raw`\bi(?:'ll| will) (?:definitely |always |try to )?([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.7 },
  { type: 'promise', re: new RegExp(String.raw`\bi(?:'m| am) (?:going to|gonna) ([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.65 },

  { type: 'decision', re: new RegExp(String.raw`\bfrom now on[,\s]+([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.85 },
  { type: 'decision', re: new RegExp(String.raw`\bi (?:decided|have decided) to ([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.85 },

  { type: 'state', re: /\bi(?:'m| am) (?:really |so |pretty )?(tired|sad|happy|stressed|hungry|excited|bored|sick|lonely|nervous|angry)\b/i, confidence: 0.8 },
  { type: 'work', re: new RegExp(String.raw`\bi work (?:as|at|in) ([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.85 },
  { type: 'home', re: new RegExp(String.raw`\bi live (?:in|at) ([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.85 },
  { type: 'about', re: new RegExp(String.raw`\bmy (birthday|anniversary|dog|cat|sister|brother|mom|mother|dad|father|boss|hobby|city|girlfriend|boyfriend|wife|husband|car) is ([^.,!?;]+?)${STOP}`, 'i'), confidence: 0.75, subjectFrom: [1, 2], prefix: 'my' },
];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are',
  'was', 'were', 'be', 'been', 'it', 'its', 'i', 'you', 'me', 'my', 'your', 'that',
  'this', 'at', 'by', 'from', 'as', 'so', 'if', 'but', 'not', 'no', 'yes', 'do',
  'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'we', 'us',
]);

function normalizeSubject(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?;,]+$/g, '')
    .replace(/^(the|a|an|to|my|your)\s+/i, '')
    .trim();
}

function tokens(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

/**
 * Pull candidate facts out of a single user message.
 * @returns {Array<{type, subject, text, confidence, sourceId}>}
 */
function extractFacts(text, sourceId) {
  const out = [];
  const seen = new Set();

  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;

    let subject;
    let type = p.type;
    if (p.subjectFrom) {
      const parts = p.subjectFrom.map((g) => (m[g] || '').trim()).filter(Boolean);
      subject = normalizeSubject(parts.join(': '));
      if (p.prefix) subject = `${p.prefix} ${subject}`;
    } else {
      subject = normalizeSubject(m[1] || m[0]);
    }
    if (!subject || subject.length < 2) continue;

    if (type === 'like' && /^(you|u|her|you too)$/.test(subject)) type = 'affection';
    if (type === 'dislike' && /^(you|u|me|this)$/.test(subject)) type = 'aversion';

    const key = `${type}:${subject}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      type,
      subject,
      text: text.trim(),
      confidence: p.confidence,
      sourceId,
    });
  }
  return out;
}

function sameFact(a, b) {
  return a.type === b.type && a.subject === b.subject;
}

/**
 * Extract facts and merge them into storage.
 * Replaces an older fact of the same type+subject (beliefs can change).
 * @param {object} store the scoped store these facts belong to
 * @returns {{added: object[], updated: object[]}}
 */
function ingest(text, sourceId, store) {
  const fresh = extractFacts(text, sourceId);
  const existing = store.loadFacts();
  const added = [];
  const updated = [];

  for (const fact of fresh) {
    const old = existing.facts.find((f) => sameFact(f, fact));
    if (old) {
      Object.assign(old, { text: fact.text, ts: Date.now(), sourceId: fact.sourceId, confidence: fact.confidence });
      updated.push(old);
    } else {
      existing.seq += 1;
      const record = { id: existing.seq, ts: Date.now(), ...fact };
      existing.facts.push(record);
      added.push(record);
    }
  }

  if (added.length || updated.length) store.saveFacts(existing);

  return { added, updated };
}

module.exports = { extractFacts, ingest, tokens, normalizeSubject };
