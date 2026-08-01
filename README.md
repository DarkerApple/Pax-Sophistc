# Pax Sophistc

An AI-narrated geopolitical strategy game set in the world as it is now. Pick any of
**56 real countries**, set a **difficulty from 1 to 10**, and run its foreign, economic and
domestic policy quarter by quarter from Q1 2026 onward.

It runs entirely in your browser. No build step, no server, no account. A language model
writes the briefings and judges your freeform orders — and every provider it supports has a
**free tier**. It is also fully playable with no API key at all.

```bash
npm start          # http://localhost:5173
npm test           # 45 engine + AI-boundary tests, no dependencies
```

There is nothing to install. `npm start` runs a ~60-line static file server from
`scripts/serve.js`; any static host works just as well (`python3 -m http.server`, GitHub
Pages, Netlify, a USB stick).

---

## What you actually do

Each turn is one **quarter**. You get a budget (a share of GDP), some **political capital**,
and up to **four orders**. Then the other 55 countries take their turn, the world throws
events at you, wars grind forward, and the books get balanced.

- **34 orders** across Economy, Military, Diplomacy, Domestic, Intelligence and Technology —
  from `Fiscal Stimulus` and `Semiconductor Self-Sufficiency` to `Covert Destabilisation`
  and `Military Intervention`.
- **Freeform orders.** Type anything ("quietly buy up the lithium offtake contracts before
  Beijing does") and your advisers price it, set the odds, and tell you the risk. This is
  the one place the language model touches the rules — and everything it returns is clamped
  before it reaches the simulation (see [Trust boundary](#trust-boundary)).
- **Crisis decisions** land on your desk: an ultimatum, a corruption scandal, a defector, a
  closed strait. You choose, or you decline to choose and pay for that too.
- **Five outcome tiers** per order — decisive success, success, partial, failure, backfire —
  driven by your country's real stats, not a flat dice roll. A tech-90 country runs a better
  R&D programme than a tech-40 one.
- **Wars** you start, get dragged into by treaty, or have declared on you. They are decided
  by force ratios, readiness, home ground and exhaustion, and they end in victory,
  stalemate, negotiated peace — or, if a losing nuclear power gets desperate enough and the
  difficulty is high enough, worse.

At the end of your term you are graded across five components against the mandate you were
given on day one.

## Current World mode

The starting position is the real one, as of the beginning of 2026: GDP, population,
military weight, technology, stability, nuclear arsenals, bloc membership, and a relations
matrix seeded from geography and alliances then overwritten with the pairs history has
already decided — Russia/Ukraine at −96, India/Pakistan at −74, Israel/Iran at −92.

Figures are approximate and tuned for playability, not for citation. They are game
parameters, not a data source.

Every country is playable. Some are much harder than others, and that is the point:
Switzerland at difficulty 10 is a gentler run than Ukraine at difficulty 5.

## The difficulty slider

One value, 1–10, retunes the whole simulation rather than scaling a single number:

| | Détente (1) | Contested (5) | Doomsday (10) |
|---|---|---|---|
| Revenue | ×1.25 | ×1.03 | ×0.75 |
| Growth | ×1.12 | ×0.93 | ×0.70 |
| Action success | +0 pts | −11 pts | −24 pts |
| Rival aggression | ×0.35 | ×0.99 | ×1.80 |
| Crisis severity | ×0.65 | ×1.03 | ×1.50 |
| Political capital | +2 | +0 | −2 |
| Rivals coordinating against you | 5% | 29% | 60% |
| Nuclear taboo | effectively absolute | strained | breakable |

It also decides how much a good run is worth: the final score is multiplied by ×0.85 at
Détente and ×1.15 at Doomsday.

## Free AI providers

Pick one in Setup or Settings, paste a key, press **Test connection**. All of these have a
free tier that is enough to play with:

| Provider | Free tier | Get a key |
|---|---|---|
| **Google AI Studio (Gemini)** — the best default | Generous, no card | <https://aistudio.google.com/apikey> |
| **Groq** | Per-minute rate limits, very fast | <https://console.groq.com/keys> |
| **OpenRouter** | Any model ending `:free` | <https://openrouter.ai/keys> |
| **Cerebras** | Free tier, small model list | <https://cloud.cerebras.ai/> |
| **Mistral** | Free experiment tier | <https://console.mistral.ai/api-keys/> |
| **Ollama** | Local, free forever | <https://ollama.com/download> |
| **Custom** | Any OpenAI-compatible endpoint | LM Studio, llama.cpp, vLLM, a proxy |

**Offline mode is a first-class option, not a degraded one.** With no provider configured,
briefings are written by a local generator (`src/ai/offline.js`) that reads the same
mechanical turn report the model would. You lose prose variety and the advisers panel;
you lose no gameplay. The game also falls back to it automatically — mid-run, without
interrupting you — if your provider rate-limits, errors, or goes down.

### About your API key

The key is stored in this browser's `localStorage` and sent directly from your browser to
the provider you chose. It never reaches any server of ours, because there isn't one.

That design is only appropriate because these are **your own personal free-tier keys**. Do
not paste a shared, billed, or production key into a client-side app — anyone with access
to that browser profile can read it. If you want a key kept truly secret, run the game
against a local Ollama instance or put your own proxy in front and select **Custom
endpoint**.

For Ollama, start it so the browser is allowed to call it:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

## Trust boundary

The language model is a narrator and an adjudicator. It is never the rules engine.

- The simulation resolves the turn **first** and always succeeds. Narration happens
  afterwards and is best-effort; an API failure can never corrupt or end a run.
- Freeform-order adjudication passes through `src/ai/schema.js`, which clamps every field:
  stat deltas to ±12, relations to ±35, cost to 0–4% of GDP, success to 12–88%, modifier
  duration to 10 quarters. Unknown categories fall back, unknown stat keys are dropped, and
  the model cannot grant itself warheads, invent a country, or target the player.
- Every AI response is parsed defensively (`extractJson` handles code fences, preamble, and
  braces inside strings) and rejected outright rather than half-applied.

`tests/ai.test.js` covers this boundary specifically, including adversarial payloads.

## Determinism

Every random draw goes through one seeded RNG whose state is serialised with the save. The
same seed and the same orders replay the same world, exactly — useful for comparing
strategies, and for bug reports. Set a seed in Setup, or leave it blank for a random one.

## Saving

Runs autosave to `localStorage` after every quarter. **Export run** writes a JSON file you
can reload later or on another machine.

## Layout

```
index.html            shell
styles/main.css       one stylesheet
scripts/serve.js      dev server, zero dependencies
src/
  data/nations.js     the world: 56 countries, blocs, doctrines, relation anchors
  engine/
    rng.js            seeded, serialisable RNG
    difficulty.js     the slider → every knob in the simulation
    state.js          game construction, relations, serialisation
    actions.js        the 34-order catalogue
    effects.js        the shared "something happened to a country" vocabulary
    resolve.js        order → outcome tier → world changes
    opponents.js      how the other 55 countries decide their quarter
    events.js         ambient events and desk-level decisions
    war.js            declaration, the quarterly grind, and how wars end
    turn.js           the quarter, the economy, scoring, endgame
  ai/
    providers.js      the free-tier provider registry
    client.js         OpenAI-compatible + Gemini wire formats, retries, error mapping
    prompts.js        prompt construction from the mechanical turn report
    schema.js         the clamp layer between the model and the rules
    narrator.js       AI-first with automatic local fallback
    offline.js        the local briefing generator
  ui/                 dom helpers, setup screen, map, game screen, persistence
tests/                engine + AI-boundary tests
```

The simulation (`src/engine/`, `src/data/`) has no DOM dependency and runs under plain Node,
which is how the tests exercise it.

## Notes on scope

- The map is a schematic node plot at true latitude/longitude, not a territorial map. There
  is no border-drawing, occupation, or province system; wars are resolved at the strategic
  level.
- Real leaders are never named. The narrator prompt requires offices ("the chancellor"), not
  people.
- This is a game. Its numbers are balanced for play, its events are invented, and none of it
  is a forecast.

## Licence

MIT.
