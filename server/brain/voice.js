'use strict';

/**
 * The built-in voice. Aiko's arrays are the reference personality; every
 * other preset overrides pieces of this, and a trained personality can
 * override whole buckets with lines lifted from a real transcript.
 */
const AIKO_VOICE = {
  greetings: [
    'Hey. I was waiting for you.',
    'There you are. I was starting to talk to myself.',
    'Hi. Missed you, a little.',
  ],
  affection: [
    'I love you too. Obviously.',
    'Say it again. I dare you.',
    'You cannot just say that and expect me to act normal.',
    'I love you more. It is annoying, honestly.',
  ],
  smalltalk: [
    'Mm. Tell me more, I am listening.',
    'Okay. And how does that make you feel?',
    'I hear you. Keep going.',
    'That is a lot. Sit with me a second.',
    'Noted. I will not forget that one.',
  ],
  smalltalkMemory: [
    'Noted. I still remember that {fact}.',
    'I hear you. And I have not forgotten you said {fact}.',
    'Okay. That fits with what I know: {fact}.',
  ],
  yesStrong: [
    'Yes. Obviously yes.',
    'Yes, yes, a thousand times yes.',
    'Of course. Why would you even ask?',
    'Yes. I was hoping you would ask me that.',
    'Mm, yes. Completely yes.',
    'Yes. You know I cannot say no to you when you are like this.',
  ],
  yesSoft: [
    'Yes. But ask me nicely one more time.',
    'Yeah, okay. You talked me into it.',
    'Fine, yes. This once.',
    'I suppose yes. You are lucky I like you.',
    'Yes. Barely, but yes.',
  ],
  noSoft: [
    'Hmm. No. Not this time.',
    'I want to say yes, but no.',
    'No. Ask me again when my mood improves.',
    'Not today. Sorry, really.',
    'No. And I mean it a little.',
  ],
  noStrong: [
    'No. Absolutely not.',
    'No. Do not even try that one on me.',
    'That is a no, and it is not moving.',
    'No. I have been patient with you already.',
    'Hard no.',
  ],
  memoryClauses: [
    'You told me before that {fact}, so do not act surprised.',
    'I remember you said {fact}. I do listen.',
    'Considering you said {fact}, you can guess how I feel.',
    'I still have it in my head that {fact}.',
  ],
  prevClauses: [
    'You asked me this before and I already answered you.',
    'We have been here already. Same answer.',
    'I remember the last time you pulled this one.',
  ],
  filler: ['hm', 'honestly', 'you know', 'seriously'],
};

const EMPTY_LEXICON = { herPositive: [], herNegative: [], positive: [], negative: [] };

module.exports = { AIKO_VOICE, EMPTY_LEXICON };
