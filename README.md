# Pax Sophistc

An AI-narrated geopolitical strategy game set in the world as it is now. **English and Korean (한국어).** Pick any of
**56 real countries**, choose the **world you want to play in**, set a **difficulty from 1 to
10**, and run its foreign, economic and domestic policy quarter by quarter from Q1 2026 onward.

It runs entirely in your browser. No build step, no server, no account. A language model
writes the briefings and judges your freeform orders — and every provider it supports has a
**free tier**. It is also fully playable with no API key at all.

```bash
npm start          # http://localhost:5173
npm test           # 113 engine, territory, AI-boundary, world-mode, map and translation tests
```

There is nothing to install. `npm start` runs a ~60-line static file server from
`scripts/serve.js`; any static host works just as well (`python3 -m http.server`, GitHub
Pages, Netlify, a USB stick).

---

## What you actually do

Each turn is one **quarter**. You get a budget (a share of GDP), some **political capital**,
and up to **four orders**. Then the other 55 countries take their turn, the world throws
events at you, wars grind forward, and the books get balanced.

- **65 orders** across Quick, Economy, Military, Diplomacy, Domestic, Intelligence and
  Technology — from `Fiscal Stimulus` and `Semiconductor Self-Sufficiency` to
  `Covert Destabilisation` and `Military Intervention`.
- **A Quick tab that reads the room.** Eighteen one-capital quick orders, of which you are
  shown the ones that answer *what actually happened*: `Emergency Relief Operation` after a
  disaster, `Impose a Curfew` after a riot, `Reinforce the Front` in a war, `Draw on the
  Reserves` when the treasury is empty, `Recognise the New State` the quarter a country
  splits, `Open a Back Channel` when a ladder is climbing. It is a different shelf every
  quarter, and the ones with nothing to answer are not on it.
- **A War Room** that only appears while you are fighting: major offensives, holding
  actions, mobilisation, strikes on logistics, a total war economy. These move the front,
  the exhaustion and the casualty count directly, not just your national statistics.
- **Two budgets, and a credit line.** Orders are paid from cash plus borrowing headroom
  scaled to your GDP and institutional credibility. A deficit costs interest and unrest;
  at the ceiling an emergency programme imposes the adjustment for you. It is never a
  position with no legal move.
- **Freeform orders.** Type anything ("quietly buy up the lithium offtake contracts before
  Beijing does") and your advisers price it, set the odds, and tell you the risk. This is
  the one place the language model touches the rules — and everything it returns is clamped
  before it reaches the simulation (see [Trust boundary](#trust-boundary)).
- **Crisis decisions** land on your desk: an ultimatum, a corruption scandal, a defector, a
  closed strait. You choose, or you decline to choose and pay for that too.
- **Things that were nobody's plan.** Riots, epidemics, power-plant failures, industrial
  disasters, earthquakes, harvest failures, currency crises, general strikes, assassinations,
  coups at home and coups next door. Each carries **a stated cause drawn from your own
  state** — a grid failure under sanctions blames spare parts; the same failure in a solvent
  country blames a maintenance backlog nobody funded — and each reports real figures rather
  than a shrug.
- **Five outcome tiers** per order — decisive success, success, partial, failure, backfire —
  driven by your country's real stats, not a flat dice roll. A tech-90 country runs a better
  R&D programme than a tech-40 one.
- **Dominance is dominant.** An order aimed at somebody else is a contest, and it is decided
  by the *ratio* of the capability it turns on, not the difference. A superpower's cyber
  operation against a small state is a formality; the same operation the other way round is
  close to hopeless; between peers it is a real roll. War works the same way — force ratios
  are logarithmic, so an overwhelming advantage overwhelms in two or three quarters while
  near-peers grind for eight.
- **Wars** you start, get dragged into by treaty, or have declared on you. They are decided
  by force ratios, readiness, home ground and exhaustion, and they end in victory,
  stalemate, negotiated peace — or, if a losing nuclear power gets desperate enough and the
  difficulty is high enough, worse. Whoever is winning **takes ground quarter by quarter**;
  a decisive peace keeps it, an exhausted one hands every acre back.
- **Conquest.** A war that is being won by an overwhelming margin does not stop at
  "decisive" — the front keeps moving until the country is taken. An absorbed state
  drops out of the world (it stops acting, ranking and being acted on) but stays on
  the books, so the run can say what became of it — and if somebody takes the ground
  back, it is on the map again. Two war-room orders put this in your hands directly:
  **Annex the Occupied Territory** makes what you hold permanent before any peace can
  return it, and **Demand Unconditional Surrender** refuses the negotiated end.
  Occupation is not free: it costs growth, stability and readiness for years, and
  every other government marks you down for it.
- **Countries come apart.** A coup in a fragile state, or a separatist uprising in a big
  unhappy one, can carve a province off into a **new country** — with a generated name in
  both languages, a government, a doctrine, and statistics derived from the parent in
  proportion to the land it took. It then sits on the map with its own colour and its own
  very large grievance.
- **Sides are not fixed.** Governments join and leave NATO, the EU, BRICS+, the CSTO, the
  SCO, the GCC, ASEAN and the African Union during a run — sometimes by event, sometimes
  because their friendships have drifted far enough from their formal commitments that the
  paperwork finally catches up.

At the end of your term you are graded across five components against the mandate you were
given on day one.

## World modes

The world mode sets the *character* of the world; the difficulty slider sets how hard it
pushes back. They compose — Chaotic at difficulty 2 is a wild but survivable ride, Chaotic
at 10 is a shredder.

| | 🕊 Stable World | 🌍 Current World | 🎲 Chaotic World |
|---|---|---|---|
| Crisis frequency | ×0.55 | ×1 | ×2.3 |
| Crisis severity | ×0.7 | ×1 | ×1.55 |
| War risk | ×0.35 | ×1 | ×2.4 |
| Relation swings | ×0.6 | ×1 | ×3.4 |
| Starting alliances | real | real | **scrambled** |
| Black-swan events | — | — | **yes** |
| Surprise wars on you | never | possible | frequent |

**Stable World** is the one to learn on: institutions hold, nobody declares war on you out of
nowhere, and money is easier to find.

**Chaotic World** shakes the alignment map at the start — old friends are not reliably
friends — then keeps it moving. It adds a pool of black-swan events that exist nowhere else:
alignment reversals, market dislocations, technological discontinuities, outright state
failure, improbable windfalls. Same rules, no stability.

## Current World

The starting position is the real one, as of the beginning of 2026: GDP, population,
military weight, technology, stability, nuclear arsenals, bloc membership, and a relations
matrix seeded from geography and alliances then overwritten with the pairs history has
already decided — Russia/Ukraine at −96, India/Pakistan at −74, Israel/Iran at −92.

Figures are approximate and tuned for playability, not for citation. They are game
parameters, not a data source.

Every country is playable, and each card tells you up front whether it is a *gentle start*,
*moderate*, or a *hard start*. Some are much harder than others, and that is the point:
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

## Escalation

Provocative orders — sanctions, cyber operations, forward deployments, covert
destabilisation — climb a shared escalation ladder with the country you aim them at, and
the ladder decides how hard the world answers back.

Low on the ladder a sanction draws a protest note. High on it, the same sanction sets off
counter-sanctions, an allied boycott, a covert reprisal and a general mobilisation in the
same quarter — because the ladder controls how many links the chain runs for, how high the
rungs go, and whether their friends join in. Past the last rung, somebody stops writing
notes.

Ladders taper near the top and cool over about seven quiet quarters, so the top of the
scale has to be held rather than parked on. The sidebar shows every ladder you are
standing on.

## The map

A schematic world map — continent outlines with every country plotted at its true latitude
and longitude, sized by live national power. The coastlines carry about a degree of detail,
the significant islands are there, and the inland seas (the Caspian, the Black Sea, the
Great Lakes, Baikal, the Aral) are cut out as holes rather than handed to the countries
around them as territory.

- **Zoom and pan.** Scroll or pinch to zoom, drag to pan, `+` / `−` / `0` on the keyboard, or
  jump straight to Europe, East Asia, the Middle East, the Americas or Africa. Marks keep a
  constant on-screen size as you zoom, so zooming genuinely separates crowded regions rather
  than magnifying a blob — and every country gets a name label once you are close enough to
  read it.
- **Five view modes**, each with its own legend: Relations, Power, Stability, Alignment and
  Conflict.
- **Filled territory with real borders.** Every country holds actual ground, not just a dot.
  The land is rasterised from the continent outlines into one-degree cells and assigned to
  capitals by a fit tuned so each country's claim lands close to its real land area; land no
  country on the roster can reach stays unclaimed. Those cells are then *traced* into closed
  rings, nudged off the lattice by a hash of each corner, and corner-cut — so a border reads
  as a frontier rather than as graph paper, and neighbours still meet exactly. Wars,
  secessions, conquests and land sales move the cells, so what you are looking at is the live
  state of the world. `T` turns the fill off.
- **Drag to pan, pinch to zoom.** Dragging pans rather than sweeping a text selection across
  every label, and two fingers zoom on a touch screen.
- **Hover goes to the sidebar, not over the map.** Pointing at a country fills the *Country
  inspector* panel on the left; clicking pins it there, clicking again opens its full file.
  Nothing ever draws on top of the map.

Colour follows one rule per mode: relations are **diverging** (blue ↔ neutral grey ↔ red),
power and stability are **sequential** (one hue, five steps), alignment is **categorical**
(three validated slots plus non-aligned), and conflict uses the **reserved status scale**
paired with a ring so "at war" is never carried by colour alone. Both the light and dark data
palettes are validated for colour-vision deficiency and surface contrast rather than
eyeballed.

The map is scenery, not cartography: bays, straits and small islands are absent, and no line
on it should be read as a claim about a real border.

## On a phone

The three-column command screen collapses to one pane at a time with a switcher across the
top — **Nation**, **Map**, **Briefing**, **Orders** — with the order count and any waiting
decision badged on the tabs. The top bar becomes three scrolling strips instead of a wall of
wrapped buttons, the map fills its box rather than letterboxing into a strip, modals become
bottom sheets, and everything you tap is at least a finger wide. No horizontal page scroll at
any width down to 320px.

## Themes and readability

Five themes, switchable in Setup or Settings and remembered between runs:

| Theme | |
|---|---|
| **Situation Room** | Deep navy command console. The default. |
| **Graphite** | Neutral dark grey, less blue light. |
| **Daylight** | Light paper theme for bright rooms and projectors. |
| **High Contrast** | Pure black, maximum contrast, heavier outlines. |
| **Amber Terminal** | Monochrome CRT with amber phosphor. |

Text size has four settings (compact through extra-large) which scale the entire interface,
not just the body copy.

## Learning the game

- A **How it works** panel on the setup screen explains the loop before you commit to anything.
- The **How to play** dialog opens automatically on your first run and is available from the
  top bar or by pressing `?` at any time.
- Every order card shows **what it actually does** in plain language — `Approval +4`,
  `Growth +0.35/q for 4q`, `Their relations +14` — alongside its cost and success chance.
- Orders that address a problem you currently have are marked **suggested**; ones that can end
  up worse than doing nothing are marked **can backfire**. Blocked orders say exactly what
  they are short of.
- The bottom bar tells you when you are about to end a quarter with money and political
  capital still unspent, which is the commonest beginner mistake.

- **Every figure carries context.** A statistic shows which way it moved this quarter, where
  it puts you in the world, and a plain word for it — `Stability 58 ▲2 · holding · #17 of 56`.
  GDP carries per-head and rank, the treasury carries its share of GDP, and land carries how
  far it has drifted since the day you took office.
- **Your grip** on the left panel reads how much of the quarter is actually yours to shape —
  political capital, public consent, institutional capacity and money, minus everything
  already running without you. It also names what that is.

**Keyboard**

| | |
|---|---|
| `Enter` | End the quarter |
| `1`–`9` | Jump to an order category |
| `Backspace` / `X` | Remove the last order / clear the queue |
| `F` | Write a freeform order |
| `S` | Save the run |
| `V` | Cycle what the map colours by |
| `T` | Show or hide filled territory |
| `G` | Centre the map on your country |
| `P` | Pin or unpin the inspected country |
| `+` `−` `0` | Zoom in, out, reset |
| arrows | Pan the map |
| `,` `.` | Previous / next briefing tab |
| `?` / `Esc` | Help / close whatever is open |

The same table is in the game, generated from `src/ui/keys.js` — a shortcut cannot exist
without being documented and cannot be documented without existing.

## Language

The whole interface ships in **English and Korean**, switchable from **the header on the
setup screen and the top bar in game** — one click, no menus — and remembered between runs. That covers the chrome, all 56 country names and one-line briefs,
all 51 order names and descriptions, the world modes, difficulty tiers, themes, help,
events, decisions, escalation and war text — and the locally generated quarterly briefing,
which is composed from translated fragments rather than translated after the fact.

When an AI provider is configured, the prompts carry the player's language, so the model
writes its briefings, adjudications and adviser replies in Korean too. The world state it
is given stays English for precision.

Typography is **Jua** for headings and large figures and **Gowun Dodum** for body text —
both self-hosted under `assets/fonts/`, both covering Hangul and Latin, so nothing is
fetched at runtime.

Adding a third language means one file: copy `src/i18n/ko.js`, translate the values, and
register it in `src/i18n/index.js`. Anything left untranslated falls back to English rather
than showing a raw key.

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
mechanical turn report the model would — and it is specific rather than atmospheric: what
moved growth and by how much, what each order actually changed, and the chain of
consequences it set off. Freeform orders are matched against the catalogue by intent, with
country detection and ambition scaling, so "quietly buy up the lithium offtake contracts in
Chile" is priced as a small targeted trade agreement rather than as a generic initiative.

You lose prose variety and the advisers panel; you lose no gameplay. The game also falls
back to it automatically — mid-run, without interrupting you — if your provider
rate-limits, errors, or goes down.

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
styles/main.css       one stylesheet: theme tokens, then components
styles/fonts.css      self-hosted Jua + Gowun Dodum (SIL OFL 1.1)
assets/fonts/         the font subsets those two faces need
scripts/serve.js      dev server, zero dependencies
src/
  data/
    nations.js        the world: 56 countries, blocs, doctrines, relation anchors
    geography.js      hand-digitised continent outlines for the map
    scenarios.js      the era registry — a second era is a data file, not a rewrite
  engine/
    rng.js            seeded, serialisable RNG
    difficulty.js     the slider → every knob in the simulation
    worldmodes.js     Stable / Current / Chaotic, composed with difficulty
    consequences.js   escalation ladders and chain reactions
    territory.js      the land grid, and the outlines traced out of it
    statecraft.js     secession, conquest, land sales, and changing sides
    causes.js         why an event happened, scored against live state
    finance.js        borrowing, interest, and the emergency programme
    state.js          game construction, relations, serialisation
    actions.js        the 51-order catalogue
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
  i18n/
    index.js          the translation layer, English-fallback by design
    ko.js             the Korean language pack
  ui/
    theme.js          the theme + text-size registry
    context.js        the framing that turns a bare figure into a position
    keys.js           the keyboard table the handler and the help card share
    map.js            projection, zoom/pan camera, view modes, legends
    setup.js          new-game screen
    game.js           command screen: dashboard, inspector, feed, planner
    dom.js, store.js  helpers and persistence
tests/                engine, territory, AI-boundary, world and translation tests
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
