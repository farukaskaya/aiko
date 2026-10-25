'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DATA_ROOT = process.env.AIKO_DATA_DIR || path.join(__dirname, '..', '..', 'data');

const DEFAULTS = {
  history: { seq: 0, messages: [] },
  facts: { seq: 0, facts: [] },
  state: { mood: null, askCounts: {}, lastDay: null },
};

/**
 * A store bound to one directory: one profile + one personality.
 * Everything she remembers lives under that directory and nowhere else.
 */
function makeStore(dir) {
  const FILES = {
    history: path.join(dir, 'history.json'),
    facts: path.join(dir, 'facts.json'),
    state: path.join(dir, 'state.json'),
  };

  function ensureDir() {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function load(name) {
    ensureDir();
    try {
      const raw = fs.readFileSync(FILES[name], 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS[name], ...parsed };
    } catch {
      return structuredClone(DEFAULTS[name]);
    }
  }

  function save(name, data) {
    ensureDir();
    const tmp = FILES[name] + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILES[name]);
  }

  function loadHistory() {
    return load('history');
  }

  function appendMessage(role, text, decision) {
    const history = load('history');
    history.seq += 1;
    const msg = { id: history.seq, ts: Date.now(), role, text };
    if (decision) msg.decision = decision;
    history.messages.push(msg);
    save('history', history);
    return msg;
  }

  function deleteMessage(id) {
    const history = load('history');
    history.messages = history.messages.filter((m) => m.id !== id);
    save('history', history);
  }

  function setDecision(id, decision) {
    const history = load('history');
    const msg = history.messages.find((m) => m.id === id);
    if (msg) {
      msg.decision = decision;
      save('history', history);
    }
    return msg;
  }

  function loadFacts() {
    return load('facts');
  }

  function saveFacts(facts) {
    save('facts', facts);
  }

  function deleteFact(id) {
    const facts = load('facts');
    facts.facts = facts.facts.filter((f) => f.id !== id);
    save('facts', facts);
  }

  function loadState() {
    return load('state');
  }

  function saveState(state) {
    save('state', state);
  }

  function resetAll() {
    save('history', structuredClone(DEFAULTS.history));
    save('facts', structuredClone(DEFAULTS.facts));
    save('state', structuredClone(DEFAULTS.state));
  }

  return {
    dir,
    loadHistory,
    appendMessage,
    deleteMessage,
    setDecision,
    loadFacts,
    saveFacts,
    deleteFact,
    loadState,
    saveState,
    resetAll,
  };
}

function dataRoot() {
  return DATA_ROOT;
}

module.exports = { makeStore, dataRoot, DATA_ROOT };
