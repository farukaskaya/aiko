'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DIR = process.env.AIKO_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DEFAULT = { a: 1, b: 0, fittedAt: null, n: 0 };

function fileIn(dir) {
  return path.join(dir || DEFAULT_DIR, 'calibration.json');
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function loadCalibration(dir) {
  try {
    return { ...DEFAULT, ...JSON.parse(fs.readFileSync(fileIn(dir), 'utf8')) };
  } catch {
    return { ...DEFAULT };
  }
}

function saveCalibration(cal, dir) {
  const target = path.dirname(fileIn(dir));
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  const tmp = fileIn(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cal, null, 2));
  fs.renameSync(tmp, fileIn(dir));
}

/**
 * Map the raw model logit to a calibrated probability.
 * a scales confidence, b shifts the decision threshold.
 * Result is clamped away from exactly 0 or 1 so the number stays honest.
 */
function calibrate(rawLogit, cal = loadCalibration()) {
  const v = sigmoid(cal.a * rawLogit + cal.b);
  return Math.min(1 - 1e-9, Math.max(1e-9, v));
}

/**
 * Fit Platt scaling on labeled examples by gradient descent on log-loss.
 *
 * l2 is deliberately not tiny: the labeled set only contains clear-cut cases,
 * so an unregularized fit sharpens everything to 0 or 1 and leaves the middle
 * of the range (where real questions land) with no signal. Shrinking a keeps
 * her confidence gradated while still beating the uncalibrated baseline.
 * @param {Array<{logit: number, label: 0|1}>} examples
 */
function fit(examples, { iterations = 400, rate = 0.5, l2 = 0.1 } = {}) {
  let a = 1;
  let b = 0;
  const n = examples.length;
  if (!n) return { ...DEFAULT };

  for (let i = 0; i < iterations; i += 1) {
    let ga = 0;
    let gb = 0;
    for (const ex of examples) {
      const p = Math.min(1 - 1e-7, Math.max(1e-7, sigmoid(a * ex.logit + b)));
      const err = p - ex.label;
      ga += err * ex.logit;
      gb += err;
    }
    a -= rate * (ga / n + l2 * a);
    b -= rate * (gb / n);
  }

  return { a, b, fittedAt: new Date().toISOString(), n };
}

function logLoss(examples, cal) {
  let total = 0;
  for (const ex of examples) {
    const p = Math.min(1 - 1e-7, Math.max(1e-7, calibrate(ex.logit, cal)));
    total -= ex.label * Math.log(p) + (1 - ex.label) * Math.log(1 - p);
  }
  return examples.length ? total / examples.length : 0;
}

function brierScore(examples, cal) {
  let total = 0;
  for (const ex of examples) {
    const p = calibrate(ex.logit, cal);
    total += (p - ex.label) ** 2;
  }
  return examples.length ? total / examples.length : 0;
}

module.exports = { sigmoid, calibrate, fit, logLoss, brierScore, loadCalibration, saveCalibration };
