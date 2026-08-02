// What every country needs from every other one.
//
// Sanctions used to be a flat modifier: −0.4% growth on the target, −0.08% on
// you, whoever you were and whoever they were. Cutting off a country that sends
// you nothing cost you exactly as much as cutting off the one your entire
// manufacturing base runs on, and the target lost the same fraction either way.
//
// A country is not a bar chart, it is a set of arrangements with other
// countries. Korea sells chips into the American market and buys components
// from China; Germany buys energy and sells machines; Taiwan makes something
// nobody else can. Those arrangements are the second map, and this module draws
// it: a directed exposure from every country to every other, derived from
// gravity (big and near beats small and far), from what each of them actually
// is, and from the organisations they belong to.
//
// Everything that interrupts trade — a sanction, an embargo, a blockade, a war,
// a general war — goes through the same door: it closes some share of a tie,
// and each side pays in proportion to *its own* exposure, not to a constant.
// That is the whole design. The country that needs the arrangement more is the
// country that bleeds when it stops.

import { t, tNation } from '../i18n/index.js';
import { blocsOf, clamp, defOf, distanceKm, isSovereign, logEvent, sovereignIds } from './state.js';

/**
 * Pairs of tags that make two countries need each other more than size and
 * distance alone would suggest. The left side wants what the right side has.
 */
const COMPLEMENTS = [
  [/semiconductors|silicon-shield|lithography-monopoly|chip-packaging/, /manufacturing-core|export-machine|nearshoring|ai-investment|reserve-currency/, 1.5],
  [/energy-import|aging|export-machine/, /energy-exporter|lng-giant|oil-exporter|swing-producer|gas-to-europe|opec-producer|largest-reserves/, 1.6],
  [/manufacturing-core|export-machine|industrial|auto-manufacturing|defence-industry/, /rare-earths|critical-minerals|lithium-triangle|copper-lithium|platinum-group|nickel|uranium-leader|phosphates/, 1.45],
  [/reserve-currency|financial-centre|banking|creditor-nation/, /debt-heavy|imf-programme|serial-defaulter|aid-dependent|remittances/, 1.4],
  [/bread-subsidy|water-stress|climate-exposed|youth-bulge/, /agri-superpower|grain-corridor|breadbasket/, 1.55],
  [/entrepot|malacca|trade-hub|logistics-hub|shipping-fleet|suez-canal|straits/, /manufacturing-core|export-machine|garment-export|china-plus-one/, 1.3],
  [/us-dependent|us-partner|us-border|us-basing|five-eyes|aukus|atlanticist/, /reserve-currency|global-bases/, 1.5],
  [/tourism|renewables|mobile-money|services-export/, /financial-centre|reserve-currency|creditor-nation/, 1.2],
];

/**
 * How far a market's pull carries, as a divisor on distance.
 *
 * A reserve currency and a base network make the far side of an ocean behave
 * like the far side of a border; being landlocked and embargoed does the
 * opposite.
 */
function carry(def) {
  const tags = def?.tags || [];
  const has = (re) => tags.some((tag) => re.test(tag));
  let factor = 1;
  if (has(/reserve-currency/)) factor *= 2.6;
  if (has(/global-bases|blue-water-navy/)) factor *= 1.45;
  if (has(/financial-centre|creditor-nation|banking/)) factor *= 1.4;
  if (has(/manufacturing-core|belt-and-road|export-machine/)) factor *= 1.35;
  if (has(/lithography-monopoly|silicon-shield|rare-earths/)) factor *= 1.3;
  if (has(/entrepot|trade-hub|logistics-hub|shipping-fleet/)) factor *= 1.2;
  if (has(/landlocked/)) factor *= 0.8;
  if (has(/embargoed|sanctioned/)) factor *= 0.75;
  return factor;
}

/** Organisations that are trade arrangements as much as anything else. */
const ECONOMIC_BLOCS = new Set(['eu', 'asean', 'gcc', 'brics', 'lithiumUnion', 'sahelUnion', 'concord', 'meridian']);

/**
 * How much of country `a`'s economy runs through country `b`, 0–1.
 *
 * Directed on purpose: Mexico's exposure to the United States is nothing like
 * the United States' exposure to Mexico, and every consequence in this module
 * turns on that asymmetry.
 */
function rawExposure(game, a, b) {
  const defA = defOf(game, a);
  const defB = defOf(game, b);
  const stateA = game.nations[a];
  const stateB = game.nations[b];
  if (!defA || !defB || !stateA || !stateB) return 0;

  // Gravity: the pull of a market is its size over the distance to it. Squared
  // distance would make everything local; linear leaves the giants everywhere.
  //
  // The divisor is the part that took tuning. Plain kilometres make every
  // country a satellite of whoever is nearest, and that is not the world: Korea
  // sells as much across the Pacific as it does across the Yellow Sea, because
  // a reserve currency, a payments system and a base network make a distant
  // market behave like a near one. `carry` is how far a partner's market
  // reaches, and it is the difference between modelling trade and modelling
  // adjacency.
  const km = Math.max(300, distanceKm(defA, defB)) / carry(defB);
  let value = Math.pow(Math.max(stateB.gdp, 0.01), 0.78) / Math.pow(km / 1000, 0.95);

  // Being small next to something enormous is the whole story for a lot of
  // countries, so scale by how big the partner is relative to you.
  value *= Math.pow(Math.max(stateB.gdp, 0.01) / Math.max(stateA.gdp, 0.05), 0.22);

  const tagsA = defA.tags || [];
  const tagsB = defB.tags || [];
  for (const [wants, has, weight] of COMPLEMENTS) {
    if (tagsA.some((tg) => wants.test(tg)) && tagsB.some((tg) => has.test(tg))) value *= weight;
  }

  // Shared paperwork is shared plumbing. A customs union is the obvious case,
  // but a security alliance builds supply chains too — it is why the countries
  // under an American guarantee trade with America.
  const blocsA = blocsOf(game, a);
  const blocsB = blocsOf(game, b);
  const shared = blocsA.filter((id) => blocsB.includes(id));
  for (const id of shared) value *= ECONOMIC_BLOCS.has(id) ? 1.55 : 1.4;

  // A country everybody has already cut off is not a partner anybody plans
  // around, however large it is.
  if (tagsB.includes('sanctioned') || tagsB.includes('embargoed')) value *= 0.4;
  if (tagsA.includes('neutral') || tagsA.includes('non-aligned')) value *= 0.9;

  return value;
}

// The web is derived from data that only moves when GDP or membership does, and
// it is asked for many times a quarter. One table per game, rebuilt when the
// quarter turns.
const webCache = new WeakMap();

function webOf(game) {
  const cached = webCache.get(game);
  if (cached && cached.turn === game.turn && cached.count === Object.keys(game.nations).length) {
    return cached;
  }
  const ids = sovereignIds(game);
  const rows = new Map();
  for (const a of ids) {
    const row = new Map();
    let sum = 0;
    for (const b of ids) {
      if (a === b) continue;
      const value = rawExposure(game, a, b);
      if (value <= 0) continue;
      row.set(b, value);
      sum += value;
    }
    // Normalise into a share of an openness budget: a small open economy runs
    // more than half of itself through other people, a continental one much
    // less. That ceiling is the difference between Singapore and Brazil.
    const state = game.nations[a];
    const def = defOf(game, a);
    const tags = def?.tags || [];
    let ceiling = 0.52 - Math.min(0.3, Math.log10(Math.max(state.gdp, 0.01) * 1000) * 0.055);
    if (tags.some((tg) => /entrepot|trade-hub|export-machine|garment-export|malacca|open-economy/.test(tg))) ceiling += 0.14;
    if (tags.some((tg) => /landlocked|embargoed|sanctioned|autarky/.test(tg))) ceiling -= 0.1;
    ceiling = Math.max(0.12, Math.min(0.62, ceiling));

    const scaled = new Map();
    for (const [b, value] of row) scaled.set(b, (value / Math.max(sum, 1e-9)) * ceiling);
    rows.set(a, { partners: scaled, total: ceiling });
  }
  const web = { turn: game.turn, count: Object.keys(game.nations).length, rows };
  webCache.set(game, web);
  return web;
}

/** Share of `a`'s economy that runs through `b`, 0–1. */
export function exposure(game, a, b) {
  return webOf(game).rows.get(a)?.partners.get(b) ?? 0;
}

/** How much of `a`'s economy is exposed to the outside world at all. */
export function openness(game, a) {
  return webOf(game).rows.get(a)?.total ?? 0;
}

// ── Interrupting it ─────────────────────────────────────────────────────────

function key(a, b) {
  return [a, b].sort().join('|');
}

function cutsOf(game) {
  if (!game.tradeCuts) game.tradeCuts = {};
  return game.tradeCuts;
}

/**
 * How much of the arrangement between two countries is still running, 0–1.
 *
 * A war closes it entirely; nobody ships through a front. Everything else is a
 * matter of degree, and degrees expire.
 */
export function openShare(game, a, b) {
  const atWar = game.wars.some(
    (w) => w.active
      && ((w.attackers.includes(a) && w.defenders.includes(b))
        || (w.attackers.includes(b) && w.defenders.includes(a))),
  );
  if (atWar) return 0;
  const cut = cutsOf(game)[key(a, b)];
  const local = cut ? 1 - clamp(cut.severity, 0, 1) : 1;
  // A general war closes sea lanes and payment systems for everybody, including
  // the people not in it.
  const global = 1 - (game.tradeShock || 0);
  return Math.max(0, local * global);
}

/**
 * The share of a country's foreign arrangements that are actually working,
 * 0 (autarky by force) to 1 (everything open).
 */
export function tradeHealth(game, id) {
  const row = webOf(game).rows.get(id);
  if (!row || !row.partners.size) return 1;
  let open = 0;
  let all = 0;
  for (const [other, value] of row.partners) {
    all += value;
    open += value * openShare(game, id, other);
  }
  return all > 0 ? open / all : 1;
}

/**
 * What the state of a country's trade is doing to its growth this quarter, in
 * percentage points. Zero when everything is open, so a quiet world plays
 * exactly as it did before this module existed.
 */
export function tradeDrag(game, id) {
  const health = tradeHealth(game, id);
  if (health >= 0.999) return 0;
  return -(1 - health) * openness(game, id) * TRADE_WEIGHT;
}

/** How hard closed trade bites. One quarter of full autarky costs a lot. */
const TRADE_WEIGHT = 4.2;

/**
 * Close some share of the arrangement between two countries.
 *
 * @param {number} severity 0–1 of the tie to close
 * @param {number} turns how long before it lapses; 0 for indefinite
 * @returns {{a: object, b: object}} what it did to each side
 */
export function severTies(game, a, b, severity = 1, turns = 8, { by = null, label = null } = {}) {
  const cuts = cutsOf(game);
  const id = key(a, b);
  const before = cuts[id]?.severity || 0;
  const after = clamp(Math.max(before, severity), 0, 1);
  cuts[id] = {
    severity: after,
    turnsLeft: turns > 0 ? Math.max(turns, cuts[id]?.turnsLeft || 0) : 0,
    permanent: turns <= 0,
    by: by || cuts[id]?.by || null,
    label: label || cuts[id]?.label || null,
    since: game.turn,
  };
  const added = after - before;
  return {
    a: applyCut(game, a, b, added),
    b: applyCut(game, b, a, added),
  };
}

/** Re-open what was closed. */
export function restoreTies(game, a, b, amount = 1) {
  const cuts = cutsOf(game);
  const id = key(a, b);
  const cut = cuts[id];
  if (!cut) return false;
  cut.severity = clamp(cut.severity - amount, 0, 1);
  if (cut.severity <= 0.01) delete cuts[id];
  return true;
}

/**
 * The immediate hit of closing `share` of one side's arrangement.
 *
 * Applied to both parties by severTies, which is how the asymmetry does its
 * work: the same order costs the two of them completely different amounts.
 */
function applyCut(game, victim, partner, share) {
  const state = game.nations[victim];
  if (!state || share <= 0) return { id: victim, gdp: 0, unrest: 0 };
  const bite = exposure(game, victim, partner) * share;
  // A one-off dislocation now, on top of the standing growth drag that lasts
  // as long as the tie stays shut.
  const gdpLoss = state.gdp * bite * 0.55;
  state.gdp = Math.max(0.004, state.gdp - gdpLoss);
  state.unrest = clamp(state.unrest + bite * 34);
  state.approval = clamp(state.approval - bite * 20);
  return {
    id: victim,
    exposure: Number(bite.toFixed(4)),
    gdp: Number(gdpLoss.toFixed(3)),
    unrest: Number((bite * 34).toFixed(1)),
  };
}

/**
 * What cutting somebody off would cost each of you, before you do it.
 *
 * The interface shows this on the order card, because the entire point is that
 * the player can see which way the leverage runs before pulling the lever.
 *
 * @returns {{yours: number, theirs: number, ratio: number, verdict: string}}
 */
export function leverage(game, actorId, targetId) {
  const theirs = exposure(game, targetId, actorId);
  const yours = exposure(game, actorId, targetId);
  const ratio = theirs / Math.max(yours, 1e-4);
  const verdict =
    ratio > 2.2 ? 'yours'
      : ratio > 1.15 ? 'slightly-yours'
        : ratio > 0.85 ? 'even'
          : ratio > 0.45 ? 'slightly-theirs'
            : 'theirs';
  return {
    yours: Number(yours.toFixed(4)),
    theirs: Number(theirs.toFixed(4)),
    ratio: Number(ratio.toFixed(2)),
    verdict,
  };
}

/** Lapse the temporary cuts, and let the permanent ones stand. */
export function tickTrade(game) {
  const cuts = cutsOf(game);
  const restored = [];
  for (const [id, cut] of Object.entries(cuts)) {
    if (cut.permanent) continue;
    cut.turnsLeft -= 1;
    if (cut.turnsLeft <= 0) {
      restored.push(id.split('|'));
      delete cuts[id];
    }
  }
  // A world-wide shock — a general war, a closed strait — heals on its own once
  // whatever caused it stops re-applying it.
  if (game.tradeShock) game.tradeShock = Math.max(0, game.tradeShock - 0.06);
  return { restored };
}

// ── For the interface ───────────────────────────────────────────────────────

/** What the partner actually supplies, named, for the country file. */
const SUPPLIES = [
  [/energy-exporter|lng-giant|oil-exporter|gas-to-europe|swing-producer|opec-producer|largest-reserves/, 'energy'],
  [/rare-earths|critical-minerals|lithium-triangle|copper-lithium|platinum-group|nickel|uranium-leader|phosphates/, 'raw materials'],
  [/semiconductors|silicon-shield|lithography-monopoly|chip-packaging/, 'components'],
  [/agri-superpower|grain-corridor/, 'food'],
  [/reserve-currency|financial-centre|banking|creditor-nation/, 'credit'],
  [/manufacturing-core|export-machine|garment-export|auto-manufacturing|industrial/, 'finished goods'],
  [/entrepot|malacca|suez-canal|trade-hub|logistics-hub|shipping-fleet|straits/, 'the route itself'],
];

function compositionOf(game, a, b) {
  const tagsB = defOf(game, b)?.tags || [];
  const notes = SUPPLIES.filter(([re]) => tagsB.some((tg) => re.test(tg))).map(([, label]) => label);
  if (blocsOf(game, a).some((id) => blocsOf(game, b).includes(id))) notes.push('a shared market');
  return [...new Set(notes)].slice(0, 3);
}

/**
 * Everything the ties panel needs for one country: who it leans on, who leans
 * on it, and what is currently shut.
 */
export function tiesReport(game, id, limit = 6) {
  const row = webOf(game).rows.get(id);
  if (!row) return { dependsOn: [], dependedOnBy: [], openness: 0, health: 1, severed: [] };

  const dependsOn = [...row.partners.entries()]
    .filter(([other]) => isSovereign(game, other))
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
    .map(([other, value]) => ({
      id: other,
      def: defOf(game, other),
      share: Number(value.toFixed(4)),
      open: Number(openShare(game, id, other).toFixed(2)),
      mutual: Number(exposure(game, other, id).toFixed(4)),
      composition: compositionOf(game, id, other),
    }));

  const dependedOnBy = sovereignIds(game)
    .filter((other) => other !== id)
    .map((other) => ({ id: other, def: defOf(game, other), share: exposure(game, other, id) }))
    .filter((entry) => entry.share > 0)
    .sort((x, y) => y.share - x.share)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      share: Number(entry.share.toFixed(4)),
      open: Number(openShare(game, entry.id, id).toFixed(2)),
    }));

  const severed = Object.entries(cutsOf(game))
    .filter(([pair]) => pair.split('|').includes(id))
    .map(([pair, cut]) => {
      const other = pair.split('|').find((p) => p !== id);
      return {
        id: other,
        def: defOf(game, other),
        severity: cut.severity,
        turnsLeft: cut.permanent ? null : cut.turnsLeft,
        label: cut.label,
        cost: Number((exposure(game, id, other) * cut.severity).toFixed(4)),
      };
    })
    .sort((x, y) => y.cost - x.cost);

  return {
    dependsOn,
    dependedOnBy,
    openness: Number(openness(game, id).toFixed(3)),
    health: Number(tradeHealth(game, id).toFixed(3)),
    drag: Number(tradeDrag(game, id).toFixed(2)),
    severed,
  };
}

/** A one-line summary for the briefing when trade actually moved. */
export function noteTradeBreak(game, a, b, result, label) {
  const worse = result.a.exposure >= result.b.exposure ? result.a : result.b;
  const lighter = worse === result.a ? result.b : result.a;
  if (worse.exposure <= 0.002) return null;
  const text = t(
    'trade.severed',
    '{label}: {heavy} loses {heavyPct}% of its economy’s foreign leg, {light} {lightPct}%. The arrangement was never symmetrical and now everybody knows it.',
    {
      label: label || t('trade.severedDefault', 'Commercial ties cut'),
      heavy: tNation(defOf(game, worse.id)),
      heavyPct: (worse.exposure * 100).toFixed(1),
      light: tNation(defOf(game, lighter.id)),
      lightPct: (lighter.exposure * 100).toFixed(1),
    },
  );
  logEvent(game, { type: 'trade', severity: 'major', text, nations: [a, b] });
  return text;
}
