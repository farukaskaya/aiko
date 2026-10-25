'use strict';

const { loadCalibration, saveCalibration, fit } = require('./calibrator');

let cachedVectors;
let cachedError;

/**
 * The labeled set gives us logits to fit against. Fitted on first use and
 * memoized, so boot costs one require + one small gradient descent.
 */
function labeledVectors() {
  if (cachedVectors) return cachedVectors;
  if (cachedError) return null;
  try {
    // eslint-disable-next-line global-require
    const { labeledVectors: build } = require('../../eval/run-eval');
    cachedVectors = build();
  } catch (err) {
    cachedError = err;
    return null;
  }
  return cachedVectors;
}

/**
 * Every personality ships with a fitted calibration instead of the raw
 * a=1,b=0 default. Idempotent: only fits when nothing has been saved yet.
 */
function ensureCalibration(dir) {
  const current = loadCalibration(dir);
  if (current.fittedAt && current.n > 0) return current;

  const vectors = labeledVectors();
  if (!vectors || !vectors.length) return current;

  const fitted = fit(vectors);
  saveCalibration(fitted, dir);
  return { ...current, ...fitted };
}

module.exports = { ensureCalibration, labeledVectors };
