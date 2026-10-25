# Aiko — an AI girlfriend who answers yes or no with a probability

Chat with her in the browser. Every time you ask something, she gives a
**yes/no verdict with a probability** and the **reasons behind it**, and she
**remembers what you told her before**: the full transcript, the facts she
extracted from your messages, and the answers she already gave.

On top of that:

- **Profiles** — several people can share the browser; each profile has its
  own personalities and its own memory.
- **Personalities** — Aiko, Yuki, Mira, Nova, or your own. Every personality
  has a separate memory, mood, voice, word lists and calibration.
- **A trainer** — paste a chat log and she learns *that* voice: her line
  templates, her vocabulary, her punctuation habits, and how often she says
  yes (which moves the decision model's bias).
- **A confidence chart** — every answer she gave, plotted over time.

No API keys, no external services, no dependencies — plain Node.js
(Node 20+).

## Quick start

```bash
npm start          # then open http://localhost:3000
```

```bash
npm test           # 66 unit + integration tests (node:test)
npm run eval       # score the decision model against eval/labeled.json
npm run eval -- --fit   # refit + save the Platt calibration by hand
```

### Give her a personality of your own

1. Open the panel (☰) and pick a preset under **Personality** → **+ New**.
2. Paste a chat log into **Train her personality** — a WhatsApp/iMessage
   export, a Discord log, anything with her lines labeled:

   ```
   Aiko: Hey, I was hoping you would text.
   Me: Can we get pizza tonight?
   Aiko: Of course! Pizza sounds perfect.
   ```

   Labels can be `Name:`, `Name |` or `Name -`. With no labels at all she
   assumes even lines are you and odd lines are her — and tells you so.
3. Hit **Train**. You get back what she learned: her yes-bias, her buckets of
   reply lines, her style numbers and her vocabulary.

That personality keeps its own memory, mood and calibration. **Forget
training** puts the preset back.

**Profiles** (top of the panel) give you a completely separate copy of all
that — separate personalities, separate memories — for each person using the
browser.
## How the decision model works

`message -> features -> logit -> sigmoid -> probability -> yes/no`

All hand-tuned, all inspectable. Features come from four groups
(`server/brain/features.js`):

| group | examples |
|---|---|
| linguistic | is it a question, negation, sentiment, politeness, urgency |
| persona-facing | affection toward her, hostility toward her, caring |
| request semantics | refusal cues ("flirt with your best friend"), risky asks, plans she likes |
| **memory** | facts you told her before, her previous verdict on similar questions, how often you have asked today, her current mood |

The weighted sum lives in `WEIGHTS`/`BIAS` in `server/brain/decision.js`.
`server/brain/calibrator.js` maps the logit to a calibrated probability
(Platt scaling).

**Calibration ships fitted.** Every personality gets its own
`calibration.json` written at creation time by fitting `eval/labeled.json`
(`a≈1.60, b≈0.57`). The fit is regularized (`l2=0.1`) on purpose: an
unregularized fit on a set of clear-cut examples sharpens everything to 0 or
1 and leaves the middle of the range — where real questions land — with no
signal. `npm run eval` prints both the raw and the fitted numbers.

Each personality also carries a **`biasOffset`**: its own agreeableness, set
by the trainer (or by the preset). It shifts `BIAS`, so two personalities
looking at the same question can honestly disagree.

Reasons shown in the chat are simply the largest-weight features that fired,
translated to sentences ("you asked so politely", "she has already said yes
to something like this").

### Where she keeps her memory

Every personality owns a directory, and inside it:

- `history.json` — every message with timestamp and the decision attached
- `facts.json` — extracted beliefs: name, likes, dislikes, promises, moods,
  home; replaced when you change your mind
- `state.json` — mood (affection / trust / patience), daily ask counts
- `persona.json` — voice, word lists, mood baseline, `biasOffset`
- `calibration.json` — fitted Platt parameters (written automatically)
- `trained.json` — everything a transcript taught her

Retrieval (`server/memory/recall.js`) ranks past lines by token overlap with
recency bias, and picks facts whose subject appears in your message. Those
results feed both the model's features and her replies
("You told me before that you hate crowded places...").

The memory panel (☰) shows everything she knows, with per-fact delete and a
full reset.

### Profiles, personalities and the trainer

Storage is scoped, and the scope is a directory:

```
data/
  index.json                 # profiles
  <profileId>/
    personalities.json       # that profile's personalities + which is active
    <personalityId>/
      history.json facts.json state.json      # her memory
      persona.json calibration.json trained.json
```

The browser sends `x-aiko-profile` / `x-aiko-personality` on every request;
anything missing or malformed falls back to the default, so plain `curl`
still works.

**Personalities** (`server/personalities.js`) ship as four presets — `aiko`,
`yuki` (tsundere), `mira` (sunshine), `nova` (deadpan). A preset is a voice
(`server/brain/voice.js`), word lists, a mood baseline and a `biasOffset`.
Creating one copies the preset into the profile's own directory, so its
memory is never shared.

**The trainer** (`server/brain/trainer.js`) reads a pasted chat log:

1. parses `Name:` / `Name |` / `Name -` labels (falls back to alternating
   lines, and says so),
2. measures her style — line length, exclamation/question/emoji rates,
   signature words,
3. lifts her lines into reply templates bucketed by intent
   (greeting / affection / agree / refuse / tease / memory / smalltalk),
4. learns polarity-pure words (only ever used in her warm or her sharp
   lines) for the personality's lexicon,
5. pairs every ask with her answer and turns the yes-rate into
   `agreeableness` → `biasOffset`, so training moves the probability, not
   just the wording.

Training needs at least 5 of her lines; the yes-bias only moves with at least
4 clear yes/no exchanges, and she says why not when there are fewer.

**The chart**: `/api/state` returns `series`, one point per question she
answered (`server/memory/series.js`), rendered as an SVG in the panel with a
dashed 50% line, green/red segments and a tooltip per point.

## API

| method | route | body | returns |
|---|---|---|---|
| GET | `/api/state` | – | persona, history, facts, mood, series, catalog |
| POST | `/api/chat` | `{text}` | `{reply, decision, mood, newFacts}` |
| DELETE | `/api/facts/:id` | – | `{ok}` |
| POST | `/api/reset` | – | wipes that personality's history, facts, mood |
| GET | `/api/profiles` | – | profiles + default |
| POST | `/api/profiles` | `{name}` | creates a profile with its own Aiko |
| DELETE | `/api/profiles/:id` | – | deletes profile and everything in it |
| POST | `/api/profiles/:id/activate` | – | sets the fallback profile |
| GET | `/api/personalities` | – | this profile's personalities |
| POST | `/api/personalities` | `{name, presetId}` | creates one from a preset |
| DELETE | `/api/personalities/:id` | – | refuses if it is the last one |
| POST | `/api/personalities/:id/activate` | – | makes it the active one |
| POST | `/api/personalities/:id/train` | `{text}` | training summary |
| DELETE | `/api/personalities/:id/trained` | – | back to the preset |

Scope is read from the `x-aiko-profile` and `x-aiko-personality` headers;
both default sensibly when absent.

`decision` is `{verdict: "yes"\|"no", probability: 0..1, reasons: []}` or
`null` for messages that are not a request or question.

## Tuning her personality

- **Weights / threshold** — `WEIGHTS`, `BIAS` in `server/brain/decision.js`
- **Which personalities exist** — `PRESETS` in `server/personalities.js`,
  their words in `server/brain/voice.js`
- **What she refuses / loves** — `REFUSE`, `RISK`, `ASK_YES` in `server/brain/features.js`
- **Voice** — reply templates in `server/brain/reply.js`, name/mood rules in `server/persona.js`
- **Ground truth for scoring** — `eval/labeled.json` (58 examples of what she
  would answer), then re-run `npm run eval`

Current numbers (`npm run eval`): 58/58 accuracy either way. Raw model
(`a=1, b=0`): Brier 0.10, log-loss 0.37. Shipped fitted calibration:
Brier 0.05, log-loss 0.24 (holdout 0.36 → 0.24).

## Layout

```
server/
  server.js            http server, static files, api
  scope.js             request -> profile/personality directory
  personalities.js     presets, profile + personality registry
  persona.js           mood rules
  brain/               voice -> features -> decision -> calibration -> reply
    trainer.js         learn a voice and a yes-bias from a chat log
  memory/              store (json), fact extraction, recall, series
public/                chat UI (no build step)
eval/                  labeled set + scoring script
test/                  node:test suites
```

## Example turn

```json
POST /api/chat  {"text": "Can we get pizza tonight?"}

{
  "decision": { "verdict": "yes", "probability": 0.78,
                "reasons": ["that is exactly her kind of plan"] },
  "reply": { "text": "Yes, yes, a thousand times yes. (that is exactly her kind of plan)" },
  "mood": { "affection": 55, "trust": 55, "patience": 55, "label": "content" }
}
```

## Limits

The model is linear over hand-built features: it has no world knowledge and
no real understanding of sarcasm, so novel phrasings land near the middle of
the range. The `decide()` interface is deliberately small — swapping in an
LLM later means replacing one function, not the memory or the UI.

The trainer learns style from a transcript, not truth: it never invents
labels, and it refuses to move the yes-bias when a log has too few clear
exchanges to say anything.

## License

MIT — see [LICENSE](LICENSE).
