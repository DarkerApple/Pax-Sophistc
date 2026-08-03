// What a country actually has to fight with.
//
// `military: 87` is a number on a sheet. It says nothing about whether that
// eighty-seven is nine hundred tanks or nine hundred missiles, whether the army
// can move at night, whether there is anything left after the third quarter of
// a war. Every operation in the War Room cost money and political capital and
// nothing else, so a country could mount an amphibious landing every quarter
// for a decade without ever running out of landing craft.
//
// The arsenal is that inventory. Ten arms of service, each with a count you can
// read, a quality set by technology, and a readiness that says how much of it is
// available this quarter. Fighting consumes it. Industry replaces it, at a rate
// set by the size of the economy and by whether the country has put itself on a
// war footing. A war you are losing is a war where the artillery park is empty
// and the replacement rate will not fill it before spring.
//
// Everything is derived from the country's own sheet on first use, so no data
// file has to carry an order of battle for fifty-six countries — and then it is
// stored, because from that point on it is history rather than a formula.

import { t } from '../i18n/index.js';
import { clamp, defOf } from './state.js';
import { hasCoast } from './territory.js';

/**
 * The arms of service.
 *
 * `role` is what the arm is *for*, and it is what the front tables read:
 *   break   — takes ground
 *   hold    — keeps it
 *   attrit  — grinds the other side down without taking anything
 *   strike  — reaches past the line
 *   deny    — stops them doing the same to you
 *   reach   — gets the army somewhere it could not otherwise go
 *   sustain — makes all of the above possible for more than a fortnight
 */
export const ARMS = [
  {
    id: 'infantry', name: 'Line infantry', short: 'infantry', icon: '🪖', role: 'hold',
    unit: 'brigades',
    blurb: 'The only arm that can actually hold ground, and the one every plan runs out of first.',
    scale: { military: 0.55, population: 0.45 }, base: 6,
    attrition: 0.09, replace: 0.11, cost: 0.6,
  },
  {
    id: 'armour', name: 'Armour', short: 'armour', icon: '🛡', role: 'break',
    unit: 'brigades',
    blurb: 'Breaks a line, or is broken on one. Almost worthless in a city or a mountain.',
    scale: { military: 0.8, gdp: 0.2 }, base: 2,
    attrition: 0.13, replace: 0.07, cost: 1.5,
  },
  {
    id: 'artillery', name: 'Artillery and rockets', short: 'guns', icon: '💥', role: 'attrit',
    unit: 'regiments',
    blurb: 'What actually kills people in this kind of war. Consumes shells faster than anybody plans for.',
    scale: { military: 0.7, gdp: 0.3 }, base: 4,
    attrition: 0.1, replace: 0.13, cost: 0.9,
  },
  {
    id: 'airpower', name: 'Air wings', short: 'air', icon: '✈', role: 'strike',
    unit: 'wings',
    blurb: 'Reaches anywhere the air defence does not, and nowhere it does.',
    scale: { military: 0.6, tech: 0.4 }, base: 1,
    attrition: 0.08, replace: 0.05, cost: 2.4,
  },
  {
    id: 'airDefence', name: 'Air and missile defence', short: 'air defence', icon: '◈', role: 'deny',
    unit: 'batteries',
    blurb: 'Nobody notices it until the quarter it runs out of interceptors.',
    scale: { military: 0.5, tech: 0.5 }, base: 2,
    attrition: 0.12, replace: 0.09, cost: 1.3,
  },
  {
    id: 'navy', name: 'Naval groups', short: 'navy', icon: '⚓', role: 'reach',
    unit: 'groups',
    blurb: 'The difference between a regional power and a global one, and it takes a decade to replace.',
    scale: { military: 0.55, gdp: 0.45 }, base: 0,
    attrition: 0.05, replace: 0.02, cost: 4,
  },
  {
    id: 'missiles', name: 'Long-range missiles', short: 'missiles', icon: '➤', role: 'strike',
    unit: 'salvos',
    blurb: 'Expensive, finite, and the only thing that reaches their capital in an afternoon.',
    scale: { military: 0.4, tech: 0.6 }, base: 2,
    attrition: 0.4, replace: 0.14, cost: 1.8,
  },
  {
    id: 'drones', name: 'Drones', short: 'drones', icon: '◇', role: 'attrit',
    unit: 'squadrons',
    blurb: 'Cheap, replaceable, and worth more than the aircraft they are not.',
    scale: { tech: 0.6, gdp: 0.4 }, base: 3,
    attrition: 0.28, replace: 0.3, cost: 0.3,
  },
  {
    id: 'special', name: 'Special forces', short: 'special', icon: '◆', role: 'break',
    unit: 'groups',
    blurb: 'Small, irreplaceable, and the only arm that can be spent in one night.',
    scale: { military: 0.4, readiness: 0.6 }, base: 1,
    attrition: 0.16, replace: 0.04, cost: 0.7,
  },
  {
    id: 'logistics', name: 'Logistics and lift', short: 'logistics', icon: '⛟', role: 'sustain',
    unit: 'formations',
    blurb: 'Nobody writes about it and every offensive that fails, fails on it.',
    scale: { gdp: 0.6, military: 0.4 }, base: 3,
    attrition: 0.07, replace: 0.12, cost: 0.5,
  },
];

export const ARMS_BY_ID = Object.fromEntries(ARMS.map((a) => [a.id, a]));

/**
 * Country tags that mean an unusual order of battle.
 *
 * A country with an artillery wall has an artillery wall; one with a
 * lithography monopoly does not have a navy because of it. This is where the
 * roster's own descriptions of these countries turn into force structure.
 */
const SHAPES = [
  [/blue-water-navy|shipping-fleet/, { navy: 2.6, airpower: 1.3, logistics: 1.25 }],
  [/global-bases|expeditionary|aukus/, { logistics: 1.3, special: 1.4, navy: 1.2 }],
  [/artillery-wall|permanent-mobilisation/, { artillery: 2.2, infantry: 1.5, armour: 1.2 }],
  [/conscription|reservist-army|total-defence|militia-army|army-state/, { infantry: 1.8, artillery: 1.2, armour: 0.8 }],
  [/drone-exporter|drone-innovator/, { drones: 2.6, airpower: 0.9 }],
  [/cyber-tier|ai-investment|intelligence-tier|five-eyes/, { special: 1.5, drones: 1.3 }],
  [/nuclear-power|independent-deterrent|undeclared-deterrent|threshold-state|nuclear-blackmail/, { missiles: 1.7, airDefence: 1.3 }],
  [/defence-industry|industrial|ammunition-broker|auto-manufacturing/, { artillery: 1.4, armour: 1.4 }],
  [/rearming|rearmament|new-nato|frontline-state|at-war/, { infantry: 1.3, artillery: 1.4, airDefence: 1.5 }],
  [/landlocked/, { navy: 0, logistics: 0.8 }],
  [/archipelago|island|maritime|strait|straits|malacca|entrepot/, { navy: 1.6, airpower: 1.2, armour: 0.6 }],
  [/neutral|nuclear-free|non-aligned/, { infantry: 1.2, missiles: 0.5, navy: 0.7 }],
  [/aid-dependent|imf-programme|serial-defaulter|debt-stress|coup-prone/, { logistics: 0.6, airpower: 0.6, armour: 0.7 }],
  [/silicon-shield|semiconductors|lithography-monopoly/, { airDefence: 1.5, missiles: 1.2 }],
];

/**
 * Build a country's order of battle from its own sheet.
 *
 * The numbers are meant to be *read*: forty-one infantry brigades is a thing a
 * person can hold in their head, in a way that "military 87" is not.
 */
function deriveArsenal(game, id) {
  const state = game.nations[id];
  const def = defOf(game, id);
  if (!state) return {};

  // A rough size index, so a large poor country and a small rich one both come
  // out with plausible force structures.
  const weight = {
    military: state.military / 100,
    tech: state.tech / 100,
    readiness: state.readiness / 100,
    gdp: Math.min(1.6, Math.log10(Math.max(state.gdp, 0.02) * 1000) / 4.2),
    population: Math.min(1.5, Math.log10(Math.max(state.population, 0.5)) / 2.6),
  };

  const tags = def?.tags || [];
  const shape = {};
  for (const [pattern, mods] of SHAPES) {
    if (!tags.some((tag) => pattern.test(tag))) continue;
    for (const [arm, factor] of Object.entries(mods)) {
      shape[arm] = (shape[arm] ?? 1) * factor;
    }
  }

  const arsenal = {};
  for (const arm of ARMS) {
    let size = 0;
    for (const [stat, share] of Object.entries(arm.scale)) size += (weight[stat] ?? 0) * share;
    // Squared, so the gap between a great power and a middling one is a real
    // gap — and capped, or the largest economy ends up with three times
    // everybody's logistics rather than half again as much.
    size = Math.min(1.15, size);
    let count = Math.round(arm.base + size * size * 78 * (arm.id === 'navy' ? 0.34 : 1));
    // Shapes stack — a blue-water navy with a global base network is both — but
    // they are capped, or the country that ticks four boxes ends up with three
    // times everybody else's logistics rather than half again as much.
    count = Math.round(count * Math.max(0, Math.min(2.2, shape[arm.id] ?? 1)));
    // Nobody landlocked has a fleet, whatever their sheet says.
    if (arm.id === 'navy' && !hasCoast(game, id)) count = 0;
    arsenal[arm.id] = {
      // Stock on hand. This is the number the whole system moves.
      n: Math.max(arm.id === 'navy' ? 0 : 1, count),
      // What one formation of it is worth, set by technology and doctrine.
      quality: Math.round(clamp(38 + state.tech * 0.5 + state.military * 0.16, 20, 100)),
      // How much of it could actually move this quarter.
      ready: Math.round(clamp(state.readiness, 15, 100)),
      // Cumulative losses, for the panel to show a war's cost in materiel.
      lost: 0,
    };
  }
  return arsenal;
}

/**
 * This country's arsenal, built on first use and stored thereafter.
 *
 * Stored rather than recomputed because once a war has been fought the stocks
 * are a fact about what happened, not a function of the current statistics.
 */
export function arsenalOf(game, id) {
  const state = game.nations[id];
  if (!state) return {};
  if (!state.arsenal) state.arsenal = deriveArsenal(game, id);
  // A save from before the arsenal existed, or a state built by hand.
  for (const arm of ARMS) {
    if (!state.arsenal[arm.id]) state.arsenal[arm.id] = deriveArsenal(game, id)[arm.id];
  }
  return state.arsenal;
}

/**
 * The peacetime establishment, remembered from the first time it was worked out.
 *
 * It has to be remembered. Recomputing it from the current sheet meant a
 * country whose military rating had been ground down by four years of war also
 * had its *expected* order of battle ground down, so it always read as fully
 * stocked no matter how much of it was in a field somewhere.
 */
export function establishmentOf(game, id) {
  const state = game.nations[id];
  if (!state) return {};
  if (!state.establishment) {
    state.establishment = Object.fromEntries(
      Object.entries(deriveArsenal(game, id)).map(([armId, stock]) => [armId, stock.n]),
    );
  }
  return state.establishment;
}

/** How many of an arm are actually available to commit this quarter. */
export function available(game, id, armId) {
  const stock = arsenalOf(game, id)[armId];
  if (!stock) return 0;
  return Math.floor(stock.n * (stock.ready / 100));
}

/**
 * What a given commitment is worth in combat.
 *
 * Count × quality, with the count under a square root: two hundred brigades are
 * not twice as useful as a hundred on a front that only has room for forty.
 */
export function strengthOf(game, id, armId, count) {
  const stock = arsenalOf(game, id)[armId];
  if (!stock || count <= 0) return 0;
  return Math.sqrt(count) * (0.4 + stock.quality / 100) * 12;
}

/** Everything a country could bring, as one number, for the quick comparisons. */
export function totalStrength(game, id) {
  return ARMS.reduce((sum, arm) => sum + strengthOf(game, id, arm.id, available(game, id, arm.id)), 0);
}

/**
 * Spend materiel.
 *
 * @param {object} spec {armId: count} — what was committed
 * @param {number} intensity 0–2, how badly it went
 * @returns {object} {armId: lost}
 */
export function consume(game, id, spec, intensity = 1, rng = null) {
  const arsenal = arsenalOf(game, id);
  const losses = {};
  for (const [armId, count] of Object.entries(spec)) {
    const arm = ARMS_BY_ID[armId];
    const stock = arsenal[armId];
    if (!arm || !stock || count <= 0) continue;
    const rate = arm.attrition * intensity * (rng ? rng.float(0.7, 1.35) : 1);
    // Fractional losses have to accumulate rather than round away. Six brigades
    // losing nine per cent of themselves is 0.54 of a brigade, and rounding
    // that to zero every quarter meant no arsenal was ever consumed by an
    // ordinary war — only by an offensive big enough to round up.
    const exact = count * rate;
    let lost = Math.floor(exact);
    const remainder = exact - lost;
    if (remainder > 0 && (rng ? rng.next() < remainder : remainder >= 0.5)) lost += 1;
    lost = Math.min(stock.n, lost);
    if (lost <= 0) continue;
    stock.n -= lost;
    stock.lost += lost;
    losses[armId] = lost;
  }
  return losses;
}

/**
 * Industry replaces what the war ate.
 *
 * The rate is the economy, the war footing, and how much of the peacetime
 * establishment is left — a country rebuilding from nothing rebuilds slowly,
 * which is why losing an army is worse than losing a battle.
 */
export function produce(game, id, { footing = 1 } = {}) {
  const state = game.nations[id];
  if (!state) return {};
  const arsenal = arsenalOf(game, id);
  const peace = establishmentOf(game, id);
  const industry = clamp(
    0.5 + Math.log10(Math.max(state.gdp, 0.02) * 1000) / 5 + state.tech / 400 - Math.max(0, state.unrest - 50) / 200,
    0.25,
    2,
  );

  const made = {};
  for (const arm of ARMS) {
    const stock = arsenal[arm.id];
    const establishment = peace[arm.id] ?? 0;
    if (!stock) continue;
    // Nobody builds past their own establishment in peacetime; a war footing
    // raises the ceiling as well as the rate.
    const ceiling = Math.round(establishment * (footing > 1 ? 1.25 : 1));
    if (stock.n >= ceiling) continue;
    // A fraction of what is *missing*, not of the establishment: replacing an
    // army is slow, and it gets slower as the gap closes. A flat share of the
    // establishment meant production always outran attrition and no arsenal
    // ever visibly ran down, which defeated the point of having one.
    const shortfall = Math.max(0, ceiling - stock.n);
    const built = Math.max(
      arm.id === 'navy' ? 0 : (footing > 1 ? 1 : 0),
      Math.round(shortfall * arm.replace * industry * footing),
    );
    const before = stock.n;
    stock.n = Math.min(ceiling, stock.n + built);
    if (stock.n !== before) made[arm.id] = stock.n - before;
  }

  // Readiness drifts toward the national figure, which is what training and
  // maintenance actually are.
  for (const arm of ARMS) {
    const stock = arsenal[arm.id];
    if (!stock) continue;
    stock.ready = Math.round(clamp(stock.ready + (state.readiness - stock.ready) * 0.25, 10, 100));
    stock.quality = Math.round(clamp(
      stock.quality + ((38 + state.tech * 0.5 + state.military * 0.16) - stock.quality) * 0.08, 20, 100,
    ));
  }
  return made;
}

/**
 * How depleted a country is, 0 (fresh) to 1 (nothing left).
 *
 * The one number the interface needs to say "your army is running out", and the
 * one the AI reads before deciding whether to keep attacking.
 */
export function depletion(game, id) {
  const arsenal = arsenalOf(game, id);
  const peace = establishmentOf(game, id);
  let have = 0;
  let should = 0;
  for (const arm of ARMS) {
    const weight = arm.cost;
    have += (arsenal[arm.id]?.n ?? 0) * weight;
    should += (peace[arm.id] ?? 0) * weight;
  }
  return should > 0 ? clamp(1 - have / should, 0, 1) : 0;
}

/**
 * A sensible default mix for a given job, so the planner opens on something
 * that would work rather than on nothing.
 *
 * @param {string} intent 'break' | 'hold' | 'attrit' | 'strike' | 'reach'
 */
export function defaultMix(game, id, intent = 'break', share = 0.5) {
  const wanted = {
    break: { armour: 1, infantry: 0.8, artillery: 0.7, special: 0.4, logistics: 0.6 },
    hold: { infantry: 1, artillery: 0.7, airDefence: 0.5, logistics: 0.4 },
    attrit: { artillery: 1, drones: 0.9, airpower: 0.4, infantry: 0.4 },
    strike: { missiles: 1, airpower: 0.9, drones: 0.6, special: 0.3 },
    reach: { navy: 1, airpower: 0.6, infantry: 0.5, logistics: 0.8 },
  }[intent] || {};

  const mix = {};
  for (const [armId, weight] of Object.entries(wanted)) {
    const pool = available(game, id, armId);
    const count = Math.floor(pool * share * weight);
    if (count > 0) mix[armId] = count;
  }
  return mix;
}

/** Money and materiel: what committing this mix costs to move and sustain. */
export function commitmentCost(game, id, mix) {
  const state = game.nations[id];
  if (!state) return 0;
  let units = 0;
  for (const [armId, count] of Object.entries(mix)) {
    units += (ARMS_BY_ID[armId]?.cost ?? 1) * count;
  }
  return Math.round(state.gdp * 1000 * 0.00042 * units);
}

// ── For the interface ───────────────────────────────────────────────────────

/**
 * The whole order of battle, ready to render: every arm with its stock, what is
 * available now, what it is worth, and what has been lost so far.
 */
export function arsenalReport(game, id) {
  const arsenal = arsenalOf(game, id);
  const peace = establishmentOf(game, id);
  return {
    arms: ARMS.map((arm) => {
      const stock = arsenal[arm.id] || { n: 0, quality: 0, ready: 0, lost: 0 };
      const establishment = peace[arm.id] ?? 0;
      return {
        ...arm,
        n: stock.n,
        ready: stock.ready,
        quality: stock.quality,
        lost: stock.lost,
        available: available(game, id, arm.id),
        establishment,
        // Under strength is the reading that matters in the fourth quarter of a
        // war; above it means an expansion, which is also worth seeing.
        share: establishment > 0 ? stock.n / establishment : 1,
        strength: Math.round(strengthOf(game, id, arm.id, available(game, id, arm.id))),
      };
    }),
    depletion: Number(depletion(game, id).toFixed(2)),
    total: Math.round(totalStrength(game, id)),
  };
}

/** The name of an arm in the player's language. */
export function armName(arm) {
  return t(`arm.${arm.id}`, arm.name);
}

export { deriveArsenal };
