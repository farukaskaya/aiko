'use strict';

const { recallSnippets, recallFacts, pastVerdicts } = require('../memory/recall');

const LEX = {
  positive: ['love', 'great', 'good', 'awesome', 'amazing', 'happy', 'glad', 'best', 'wonderful', 'nice', 'fun', 'sweet', 'perfect', 'excited', 'enjoy', 'beautiful'],
  negative: ['hate', 'bad', 'terrible', 'awful', 'worst', 'sad', 'angry', 'annoying', 'stupid', 'boring', 'ugly', 'sucks', 'broken', 'lonely', 'tired', 'stressed', 'never', 'disgusting', 'pointless', 'whatever'],
  herPositive: ['love', 'miss', 'cute', 'adorable', 'sweet', 'kiss', 'hug', 'beautiful', 'pretty', 'girlfriend', 'gorgeous', 'amazing', 'perfect', 'proud'],
  herNegative: ['hate', 'annoying', 'stupid', 'dumb', 'ugly', 'boring', 'leave', 'ignore', 'shut', 'useless', 'waste', 'never talking', 'whatever'],
  negation: ['not', 'no', 'never', 'dont', "don't", 'cannot', "can't", "won't", 'isnt', "isn't", 'arent', "aren't", 'wasnt', "wasn't", 'nothing', 'nobody', 'none', 'without', 'barely', 'hardly', 'stop'],
  polite: ['please', 'thanks', 'thank', 'sorry', 'appreciate', 'kindly', 'gentle'],
  urgent: ['now', 'immediately', 'hurry', 'urgent', 'asap', 'instantly', 'right away'],
  caring: ['how are you', 'you okay', 'you ok', 'you doing', 'miss you', 'care about', 'proud of you', 'feel better', 'love you', 'thinking about you'],
};

/** Requests she is very unlikely to accept, whatever the politeness. */
const REFUSE = [
  'flirt with', 'your best friend', 'lie to you', 'lied to you', 'lie about', 'cheat',
  'break up', 'ghost you', 'stand you up', 'cancel on you', 'ignore you', 'delete your',
  'forget your', 'forget what you', 'forgot our', 'stop loving you', 'stop caring',
  'stop replying', 'never text you', 'never speak', 'someone else', 'my ex',
  'throw away your', 'without you', 'disappear for', 'tell your friends', 'do you want me to leave',
];

/** Self-destructive or costly asks. */
const RISK = ['quit my job', 'borrow', 'hundred dollars', 'money', 'travel the world', 'lose my job', 'drop out'];

/** Things she tends to say yes to. */
const ASK_YES = [
  'hold your hand', 'call you baby', 'watch a movie', 'go on a date', 'date with me', 'girlfriend',
  'pizza', 'sushi', 'dessert', 'beach', 'breakfast in bed', 'marry me', 'video call', 'meet your parents',
  'stay up late', 'talk to me', 'order food', 'dance with me', 'ramen', 'hoodie', 'read to you',
  'tell you a secret', 'come over', 'trip to', 'together', 'be lazy', 'forgive me', 'i am sorry',
  'hear about my day', 'something personal', 'gift for', 'my dog', 'dinner',
];

function phraseHits(text, phrases) {
  let n = 0;
  for (const p of phrases) if (text.includes(p)) n += 1;
  return n;
}

function hits(text, words) {
  let n = 0;
  for (const w of words) {
    if (w.includes(' ')) {
      if (text.includes(w)) n += 1;
    } else if (new RegExp(`\\b${w}\\b`, 'i').test(text)) {
      n += 1;
    }
  }
  return n;
}

const cap = (n, max) => Math.min(n, max);

/** A personality's learned word lists layered on top of the shared ones. */
function withLexicon(extra) {
  if (!extra) return LEX;
  const merged = {};
  for (const key of Object.keys(LEX)) {
    const added = Array.isArray(extra[key]) ? extra[key] : [];
    merged[key] = added.length ? [...LEX[key], ...added] : LEX[key];
  }
  return merged;
}

function baseSentiment(text) {
  const p = hits(text, LEX.positive);
  const n = hits(text, LEX.negative);
  if (p === 0 && n === 0) return 0;
  return Math.max(-1, Math.min(1, (p - n) / Math.max(2, p + n)));
}

/**
 * Build the feature vector for one incoming user message.
 * Everything the model needs to answer "yes or no, how sure" lives here,
 * including the memory-derived features that let her stay consistent.
 */
function extractFeatures({ text, history, facts, mood, asksToday, lexicon }) {
  const t = text.toLowerCase().trim();
  const messages = history.messages;
  const L = withLexicon(lexicon);

  const snippets = recallSnippets(text, messages, 4);
  const matchedFacts = recallFacts(text, facts, 5);
  const previous = pastVerdicts(text, messages);

  const yesCount = previous.filter((m) => m.decision.verdict === 'yes').length;
  const priorYesRate = previous.length ? yesCount / previous.length : null;

  let factBias = 0;
  for (const f of matchedFacts) {
    if (f.type === 'like' || f.type === 'affection') factBias += 0.35 * f.score;
    else if (f.type === 'dislike' || f.type === 'aversion') factBias -= 0.45 * f.score;
    else if (f.type === 'promise') factBias += 0.1 * f.score;
    else if (f.type === 'state' && /tired|sad|sick|stressed|lonely|bored/.test(f.subject)) factBias -= 0.2 * f.score;
    else factBias += 0.05 * f.score;
  }
  factBias = Math.max(-1, Math.min(1, factBias));

  const affectionMsg = hits(t, L.herPositive) > 0 ? Math.min(1, hits(t, L.herPositive) / 2) : 0;
  const hostilityMsg = hits(t, L.herNegative) > 0 ? Math.min(1, hits(t, L.herNegative) / 2) : 0;
  const caring = L.caring.some((c) => t.includes(c)) ? 1 : 0;

  const values = {
    isQuestion: /\?|^(can|could|will|would|should|shall|do|does|did|is|are|may|might)\b/i.test(t) ? 1 : 0,
    negation: cap(hits(t, L.negation) / 3, 1),
    sentiment: baseSentiment(t),
    politeness: cap(hits(t, L.polite) / 2, 1),
    urgency: cap(hits(t, L.urgent), 1),
    affection: affectionMsg,
    hostility: hostilityMsg,
    caring,
    refusal: cap(phraseHits(t, REFUSE) / 2, 1),
    risk: cap(phraseHits(t, RISK) / 2, 1),
    askYes: cap(phraseHits(t, ASK_YES) / 2, 1),
    factBias,
    priorYes: priorYesRate === null ? 0 : priorYesRate * 2 - 1,
    hasPrior: previous.length > 0 ? 1 : 0,
    repeatAsk: cap((previous.length + (asksToday > 2 ? 1 : 0)) / 3, 1),
    askFatigue: cap(asksToday / 6, 1),
    moodBaseline: Math.max(-1, Math.min(1, ((mood.affection + mood.trust + mood.patience) / 3 - 50) / 50)),
    patience: Math.max(-1, Math.min(1, (mood.patience - 50) / 50)),
    memoryRichness: cap((facts.length + snippets.length) / 8, 1),
  };

  return {
    values,
    context: { snippets, facts: matchedFacts, previous },
  };
}

module.exports = { extractFeatures, LEX, baseSentiment, hits };
