'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PERSONA = require('./persona');
const personalities = require('./personalities');
const { resolveScope } = require('./scope');
const { processMessage } = require('./brain/agent');
const { train } = require('./brain/trainer');
const { ensureCalibration } = require('./brain/default-calibration');
const { decisionSeries } = require('./memory/series');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/** Compact view of a personality: enough for the UI, none of the bulk. */
function personaSummary(p, trained, personality) {
  return {
    id: personality.id,
    name: p.name,
    tagline: p.tagline,
    presetId: p.presetId,
    trainedAt: p.trainedAt,
    agreeableness: p.traits.agreeableness,
    warmth: p.traits.warmth,
    biasOffset: p.biasOffset,
    fillers: (p.voice.filler || []).slice(0, 8),
    lexicon: {
      positive: p.lexicon.positive,
      negative: p.lexicon.negative,
      herPositive: p.lexicon.herPositive,
      herNegative: p.lexicon.herNegative,
    },
    trained: trained
      ? {
          trainedAt: trained.trainedAt,
          mode: trained.mode,
          lines: trained.lines,
          buckets: trained.buckets,
          agrees: trained.agrees,
          refuses: trained.refuses,
          pairs: trained.pairs,
          agreeableness: trained.agreeableness,
          style: trained.style,
          warnings: trained.warnings,
        }
      : null,
  };
}

function statePayload(scope) {
  const history = scope.store.loadHistory();
  const factBag = scope.store.loadFacts();
  const state = scope.store.loadState();
  const mood = state.mood || { ...scope.persona.baseMood };
  const list = personalities.loadPersonalityList(scope.profile.id);

  return {
    persona: personaSummary(scope.persona, scope.trained, scope.personality),
    history: history.messages,
    facts: factBag.facts,
    mood: { ...mood, label: PERSONA.moodLabel(mood) },
    series: decisionSeries(history.messages),
    profile: { id: scope.profile.id, name: scope.profile.name },
    profiles: scope.index.profiles.map((p) => ({ id: p.id, name: p.name })),
    personalities: list.personalities,
    activePersonality: list.activeId,
    presets: personalities.PRESET_LIST,
  };
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const scope = resolveScope(req.headers);
  const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
  const segments = pathname.split('/').filter(Boolean); // ['api', ...]

  if (req.method === 'GET' && pathname === '/api/state') {
    sendJson(res, 200, statePayload(scope));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    const text = String(body.text || '').trim();
    if (!text) {
      sendJson(res, 400, { error: 'text required' });
      return true;
    }
    if (text.length > 2000) {
      sendJson(res, 400, { error: 'message too long' });
      return true;
    }
    sendJson(res, 200, processMessage(text, scope));
    return true;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/facts/')) {
    const id = Number(pathname.split('/').pop());
    if (!Number.isFinite(id)) {
      sendJson(res, 400, { error: 'bad id' });
      return true;
    }
    scope.store.deleteFact(id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/reset') {
    scope.store.resetAll();
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- profiles -----------------------------------------------------------

  if (req.method === 'GET' && pathname === '/api/profiles') {
    const index = personalities.loadIndex();
    sendJson(res, 200, {
      profiles: index.profiles.map((p) => ({ id: p.id, name: p.name })),
      defaultProfileId: index.defaultProfileId,
      activeProfile: scope.profile.id,
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/profiles') {
    const name = String(body.name || '').trim();
    if (!name) {
      sendJson(res, 400, { error: 'name required' });
      return true;
    }
    const profile = personalities.createProfile(name);
    sendJson(res, 200, { ok: true, profile: { id: profile.id, name: profile.name } });
    return true;
  }

  if (segments.length === 4 && segments[1] === 'profiles' && segments[3] === 'activate' && req.method === 'POST') {
    personalities.setActiveProfile(segments[2]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'DELETE' && segments.length === 3 && segments[1] === 'profiles') {
    personalities.deleteProfile(segments[2]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- personalities ------------------------------------------------------

  if (req.method === 'GET' && pathname === '/api/personalities') {
    sendJson(res, 200, {
      ...personalities.personasSummary(scope.profile.id),
      profile: { id: scope.profile.id, name: scope.profile.name },
      presets: personalities.PRESET_LIST,
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/personalities') {
    const name = String(body.name || '').trim();
    const presetId = String(body.presetId || '').trim() || 'aiko';
    if (!name) {
      sendJson(res, 400, { error: 'name required' });
      return true;
    }
    if (!personalities.PRESETS[presetId]) {
      sendJson(res, 400, { error: 'unknown preset' });
      return true;
    }
    const created = personalities.createPersonality(scope.profile.id, { name, presetId });
    personalities.setActivePersonality(scope.profile.id, created.id);
    sendJson(res, 200, { ok: true, personality: { id: created.id, name: created.persona.name, presetId } });
    return true;
  }

  if (segments.length === 4 && segments[1] === 'personalities' && segments[3] === 'activate' && req.method === 'POST') {
    personalities.setActivePersonality(scope.profile.id, segments[2]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'DELETE' && segments.length === 3 && segments[1] === 'personalities') {
    personalities.deletePersonality(scope.profile.id, segments[2]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- trainer ------------------------------------------------------------

  if (segments.length === 4 && segments[1] === 'personalities' && segments[3] === 'train' && req.method === 'POST') {
    const target = requirePersonality(scope.profile.id, segments[2]);
    const text = String(body.text || '');
    if (!text.trim()) {
      sendJson(res, 400, { error: 'paste a chat log to train from' });
      return true;
    }
    const dir = personalities.personalityDir(scope.profile.id, segments[2]);
    const persona = personalities.loadPersona(dir);
    const result = train({ text, persona });
    personalities.savePersona(dir, result.persona);
    fs.writeFileSync(path.join(dir, 'trained.json'), JSON.stringify(result.trained, null, 2));
    ensureCalibration(dir);
    const { templates, ...summary } = result.trained;
    sendJson(res, 200, {
      ok: true,
      personalityId: target.id,
      summary: {
        ...summary,
        sample: (templates.agree || templates.smalltalk || templates.affection || [])[0] || null,
      },
      persona: personaSummary(result.persona, result.trained, target),
    });
    return true;
  }

  if (segments.length === 4 && segments[1] === 'personalities' && segments[3] === 'trained' && req.method === 'DELETE') {
    const target = requirePersonality(scope.profile.id, segments[2]);
    personalities.resetToPreset(scope.profile.id, segments[2]);
    sendJson(res, 200, { ok: true, personality: { id: target.id } });
    return true;
  }

  return false;
}

function requirePersonality(profileId, personalityId) {
  const list = personalities.loadPersonalityList(profileId);
  const found = list.personalities.find((p) => p.id === personalityId);
  if (!found) throw Object.assign(new Error('personality not found'), { status: 404 });
  return found;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: 'unknown endpoint' });
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (err) {
    sendJson(res, err.status || 500, { error: String(err.message || err) });
  }
});

/** First run: default profile/personality, legacy data moved, calibration fitted. */
function boot() {
  personalities.ensureBootstrap();
  personalities.migrateLegacyData();
  const index = personalities.loadIndex();
  for (const profile of index.profiles) {
    const list = personalities.loadPersonalityList(profile.id);
    for (const p of list.personalities) {
      ensureCalibration(personalities.personalityDir(profile.id, p.id));
    }
  }
}

function start(port = PORT) {
  boot();
  server.listen(port, () => {
    const actual = server.address().port;
    console.log(`Aiko is online at http://localhost:${actual}`);
    return actual;
  });
  return server;
}

if (require.main === module) start(PORT);

module.exports = { start, server, boot };
