'use strict';

const { extractFeatures } = require('../server/brain/features');
const { logitOf, topReasons, WEIGHTS, BIAS } = require('../server/brain/decision');
const { calibrate, fit, logLoss, brierScore, loadCalibration, saveCalibration } = require('../server/brain/calibrator');
const PERSONA = require('../server/persona');
const personalities = require('../server/personalities');
const { resolveScope } = require('../server/scope');
const path = require('node:path');

const labeled = require('./labeled.json');

const EMPTY_HISTORY = { seq: 0, messages: [] };

/** Logits + labels for the labeled set: what Platt scaling gets fitted to. */
function labeledVectors() {
  return labeled.map((ex) => {
    const { values } = extractFeatures({
      text: ex.text,
      history: EMPTY_HISTORY,
      facts: [],
      mood: PERSONA.baseMood(),
      asksToday: 0,
    });
    return { logit: logitOf(values, WEIGHTS, BIAS), label: ex.label };
  });
}

function evaluate(cal) {
  const rows = labeled.map((ex) => {
    const { values } = extractFeatures({
      text: ex.text,
      history: EMPTY_HISTORY,
      facts: [],
      mood: PERSONA.baseMood(),
      asksToday: 0,
    });
    const logit = logitOf(values, WEIGHTS, BIAS);
    const p = calibrate(logit, cal);
    return { ...ex, logit, p, correct: (p >= 0.5 ? 1 : 0) === ex.label, reasons: topReasons(values, WEIGHTS) };
  });

  const accuracy = rows.filter((r) => r.correct).length / rows.length;
  return {
    rows,
    accuracy,
    brier: brierScore(rows.map((r) => ({ logit: r.logit, label: r.label })), cal),
    logLoss: logLoss(rows.map((r) => ({ logit: r.logit, label: r.label })), cal),
  };
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function main() {
  const fitNow = process.argv.includes('--fit');
  personalities.ensureBootstrap();
  const scope = resolveScope({});
  const current = loadCalibration(scope.dir);
  const before = evaluate(current);

  const vectors = labeledVectors();

  const fitted = fit(vectors);
  const after = evaluate(fitted);

  const train = vectors.filter((_, i) => i % 3 !== 0);
  const test = vectors.filter((_, i) => i % 3 === 0);
  const holdoutCal = fit(train);
  const testBefore = logLoss(test, current);
  const testAfter = logLoss(test, holdoutCal);

  console.log(`examples: ${labeled.length}  (weights hand-set, calibration: a=${current.a.toFixed(3)} b=${current.b.toFixed(3)})`);
  console.log(`  accuracy  ${pct(before.accuracy)}   brier ${before.brier.toFixed(4)}   logloss ${before.logLoss.toFixed(4)}`);
  console.log(`  fit-all   ${pct(after.accuracy)}   brier ${after.brier.toFixed(4)}   logloss ${after.logLoss.toFixed(4)}   (a=${fitted.a.toFixed(3)} b=${fitted.b.toFixed(3)}) <- fits the same set it is scored on`);
  console.log(`  holdout   fit on ${train.length} / score on ${test.length}: logloss ${testBefore.toFixed(4)} -> ${testAfter.toFixed(4)} (a=${holdoutCal.a.toFixed(3)} b=${holdoutCal.b.toFixed(3)})`);

  const wrong = before.rows.filter((r) => !r.correct).sort((a, b) => Math.abs(b.p - 0.5) - Math.abs(a.p - 0.5));
  if (wrong.length) {
    console.log(`\n  wrong (${wrong.length}):`);
    for (const w of wrong.slice(0, 10)) {
      console.log(`   ${w.label ? 'NO ' : 'YES'} got ${(w.p * 100).toFixed(0)}%  "${w.text}"`);
    }
  }

  const near = before.rows.filter((r) => Math.abs(r.p - 0.5) < 0.08);
  if (near.length) {
    console.log(`\n  on the fence (${near.length}):`);
    for (const n of near) console.log(`   ${(n.p * 100).toFixed(0)}% (expects ${n.label ? 'yes' : 'no'})  "${n.text}"`);
  }

  if (fitNow) {
    saveCalibration(fitted, scope.dir);
    console.log(`\n  saved calibration -> ${path.relative(process.cwd(), path.join(scope.dir, 'calibration.json'))}`);
  } else if (current.fittedAt) {
    console.log('\n  kept the calibration already on disk; run with --fit to refit it');
  } else {
    console.log('\n  nothing fitted on disk yet (a=1, b=0); run with --fit to save one');
  }
}

module.exports = { evaluate, labeledVectors };

// Export first: booting the default scope fits a calibration, which lazy-requires
// this module for its labeled vectors.
if (require.main === module) main();
