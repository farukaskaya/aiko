'use strict';

const { extractFeatures } = require('./features');
const { sigmoid, calibrate, loadCalibration } = require('./calibrator');

const WEIGHTS = {
  isQuestion: 0.05,
  negation: -0.3,
  sentiment: 0.9,
  politeness: 0.7,
  urgency: -0.15,
  affection: 1.1,
  hostility: -1.6,
  caring: 0.5,
  refusal: -2.2,
  risk: -1.2,
  askYes: 0.8,
  factBias: 0.9,
  priorYes: 1.0,
  hasPrior: 0.15,
  repeatAsk: -0.5,
  askFatigue: -0.4,
  moodBaseline: 0.9,
  patience: 0.6,
  memoryRichness: 0.15,
};

const BIAS = -0.15;

const REASONS = {
  sentiment: {
    up: 'you are in a good mood and it shows',
    down: 'you sound down right now',
  },
  politeness: {
    up: 'you asked so politely',
    down: '',
  },
  affection: {
    up: 'you were sweet to her',
    down: '',
  },
  hostility: {
    up: '',
    down: 'you were harsh with her',
  },
  caring: {
    up: 'you actually checked on her',
    down: '',
  },
  refusal: {
    up: '',
    down: 'some lines she will not cross',
  },
  risk: {
    up: '',
    down: 'that would cost you more than it should',
  },
  askYes: {
    up: 'that is exactly her kind of plan',
    down: '',
  },
  factBias: {
    up: 'it matches things she remembers you love',
    down: 'it clashes with something you told her before',
  },
  priorYes: {
    up: 'she has already said yes to something like this',
    down: 'she has already said no to something like this',
  },
  repeatAsk: {
    up: '',
    down: 'you have pushed this one before',
  },
  askFatigue: {
    up: '',
    down: 'you have been asking a lot today',
  },
  moodBaseline: {
    up: 'her mood is good right now',
    down: 'her mood is low right now',
  },
  patience: {
    up: '',
    down: 'her patience is running thin',
  },
  urgency: {
    up: '',
    down: 'you are pushing for an answer right now',
  },
  negation: {
    up: '',
    down: 'there is a catch in how you phrased it',
  },
};

function logitOf(values, weights = WEIGHTS, bias = BIAS) {
  let z = bias;
  for (const [k, w] of Object.entries(weights)) {
    z += w * (values[k] || 0);
  }
  return z;
}

function topReasons(values, weights, limit = 3) {
  const contribs = Object.entries(weights)
    .map(([k, w]) => ({ key: k, amount: w * (values[k] || 0) }))
    .filter((c) => Math.abs(c.amount) >= 0.18)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, limit);

  const reasons = [];
  for (const c of contribs) {
    const tpl = REASONS[c.key];
    if (!tpl) continue;
    const text = c.amount > 0 ? tpl.up : tpl.down;
    if (text) reasons.push(text);
  }
  return reasons;
}

/**
 * Full decision: features -> logit -> calibrated probability -> yes/no.
 * `biasOffset` is the personality's own agreeableness; `lexicon` its words.
 */
function decide(input, { weights = WEIGHTS, calibration = loadCalibration(), biasOffset = 0, lexicon } = {}) {
  const { values, context } = extractFeatures({ ...input, lexicon });
  const z = logitOf(values, weights, BIAS + (biasOffset || 0));
  const raw = sigmoid(z);
  const probability = calibrate(z, calibration);
  const verdict = probability >= 0.5 ? 'yes' : 'no';

  const reasons = topReasons(values, weights);
  if (!reasons.length) {
    reasons.push(Math.abs(probability - 0.5) < 0.1 ? 'she is genuinely torn' : 'no strong reason, just her gut');
  }

  return {
    verdict,
    probability,
    rawProbability: raw,
    logit: z,
    reasons,
    features: values,
    context,
  };
}

module.exports = { decide, logitOf, topReasons, WEIGHTS, BIAS };
