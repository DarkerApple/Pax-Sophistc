// Who your political capital actually comes from.
//
// Political capital used to be a number that refilled every quarter and was
// spent into nothing. It now has four creditors, and they disagree.
//
//   the general staff — force, readiness, and being taken seriously
//   capital          — growth, sound money, and not being expropriated
//   the street       — jobs, prices, and not being policed
//   the party        — the machine that keeps you in office
//
// Every order is read by all four, and the reading is *derived from the order's
// own shape* — what it costs, what it moves, whether it is covert, whether it
// starts a war — so all three hundred orders gained a second axis without a
// single new line of order data. A rearmament programme that thrills the staff
// takes money capital wanted and readiness the street will be conscripted into.
//
// Standing decays toward indifference on its own. Each faction also carries a
// standing demand with a deadline: meeting it buys you a quarter of goodwill,
// missing it costs more than the order would have.

import { clamp, logEvent } from './state.js';
import { activeWarsFor } from './state.js';
import { t } from '../i18n/index.js';

export const FACTIONS = [
  {
    id: 'staff',
    name: 'The general staff',
    blurb: 'The officer corps and everyone who depends on the defence budget.',
    // What a collapse in their standing means.
    peril: 'A hostile officer corps is how governments end suddenly.',
  },
  {
    id: 'capital',
    name: 'Capital',
    blurb: 'Banks, exporters, the bond desk, and anyone who can move money out.',
    peril: 'When capital gives up on you it leaves, and it takes the growth with it.',
  },
  {
    id: 'street',
    name: 'The street',
    blurb: 'Unions, the cities, and the people who pay for every adjustment.',
    peril: 'The street does not resign. It gathers.',
  },
  {
    id: 'party',
    name: 'The party',
    blurb: 'Your own coalition: whips, governors, and the people who count votes.',
    peril: 'A party that has stopped believing in you starts looking for a successor.',
  },
];

export const FACTION_IDS = FACTIONS.map((f) => f.id);

/** Neutral standing. Everything is measured as a departure from here. */
const NEUTRAL = 50;

// ── Reading an order ────────────────────────────────────────────────────────

const readings = new Map();

/**
 * How each faction reads one order, from the order's own data.
 *
 * Returns a number per faction, roughly −6..+6, where positive is approval.
 * Nothing here is hand-authored per order: it is the same arithmetic applied to
 * every entry in the catalogue, which is the only way this scales to three
 * hundred of them and stays consistent when more are added.
 *
 * @returns {{staff: number, capital: number, street: number, party: number}}
 */
export function readingOf(action) {
  if (!action) return { staff: 0, capital: 0, street: 0, party: 0 };
  const cached = readings.get(action.id);
  if (cached && action.id !== 'custom-order') return cached;

  const win = action.effects?.success || {};
  const self = win.self || {};
  const mod = win.modifier || {};

  const spend = action.cost?.pctGdp || 0;
  const force = (self.military || 0) + (self.readiness || 0) * 0.8 + (mod.readiness || 0) * 4;
  const growth = (mod.growth || 0) * 6 + (self.gdpPct || 0) * 0.5;
  const purse = (self.treasuryPctGdp || 0);
  const approvalDelta = self.approval || 0;
  const unrestDelta = (self.unrest || 0) + (mod.unrest || 0) * 4;
  const popular = approvalDelta - unrestDelta;

  // Unrest falling is not the same thing as people being happier. An order that
  // takes unrest down while approval goes with it took it down by force, and the
  // street reads that as what it is. Splitting the two is what stops a crackdown
  // registering as a gift to the people it is aimed at.
  const relief = unrestDelta < 0 && approvalDelta >= 0 ? -unrestDelta : 0;
  const coercion = unrestDelta < 0 && approvalDelta < 0 ? -unrestDelta : 0;
  const order = (self.stability || 0) + (mod.stability || 0) * 4;
  const reach = (self.influence || 0) + (self.tech || 0) * 0.5;

  const martial = Boolean(action.declaresWar || action.warCommand || action.warEffect);
  const covert = Boolean(action.covert);
  const irreversible = Boolean(action.confirm);
  const risky = action.risk === 'high';

  const reading = {
    // Guns, and the budget that buys them. Anything that spends heavily on
    // something else is money they were promised.
    staff:
      force * 0.55 +
      (action.category === 'military' ? 2.2 : 0) +
      (action.category === 'war' ? 1.8 : 0) +
      (martial ? 2 : 0) +
      (action.category !== 'military' && action.category !== 'war' ? -spend * 0.5 : 0) +
      (action.seeksPeace ? -2.5 : 0),

    // Growth and sound money. Deficits, expropriation and war are all costs.
    capital:
      growth * 0.7 +
      purse * 0.25 +
      (self.tech || 0) * 0.25 +
      -spend * 0.85 +
      (martial ? -2.5 : 0) +
      (self.unrest || 0) * -0.35 +
      (irreversible ? -1 : 0) +
      (action.category === 'economy' ? 1 : 0) +
      (action.category === 'technology' ? 0.8 : 0),

    // Jobs, prices, and not being policed. Money spent on people is money spent
    // well; money taken from them is not.
    street:
      approvalDelta * 0.75 +
      relief * 0.4 -
      coercion * 0.6 -
      Math.max(0, unrestDelta) * 0.4 +
      (action.category === 'domestic' ? 1.4 : 0) +
      (spend > 1 ? spend * 0.35 : 0) +
      (purse > 0 ? -purse * 0.5 : 0) +
      (martial ? -2 : 0) +
      (covert ? -1.2 : 0) +
      (action.seeksPeace ? 2.5 : 0) +
      (order > 0 && approvalDelta < 0 ? -order * 0.4 : 0),

    // The machine. It wants a government that survives: institutions that work,
    // standing abroad, and no unforced errors.
    party:
      order * 0.4 +
      reach * 0.3 +
      popular * 0.2 +
      (risky ? -1.6 : 0) +
      (irreversible ? -1.4 : 0) +
      (covert ? 0.6 : 0) +
      (action.category === 'diplomacy' ? 0.8 : 0),
  };

  for (const key of FACTION_IDS) {
    reading[key] = Number(clamp(reading[key], -6, 6).toFixed(2));
  }
  if (action.id !== 'custom-order') readings.set(action.id, reading);
  return reading;
}

/** The faction that will like this order most, and the one that will like it least. */
export function poles(action) {
  const reading = readingOf(action);
  const sorted = FACTION_IDS.slice().sort((a, b) => reading[b] - reading[a]);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return {
    reading,
    champion: reading[best] >= 1 ? best : null,
    objector: reading[worst] <= -1 ? worst : null,
  };
}

// ── Demands ─────────────────────────────────────────────────────────────────

/**
 * What each faction wants from you, and how long it will wait.
 *
 * A demand is a condition on the country's own state, so meeting one is a
 * matter of governing rather than of finding the right button.
 */
const DEMANDS = {
  staff: [
    { id: 'readiness', text: 'Get readiness above 70 and keep it there.', check: (g, s) => s.readiness >= 70 },
    { id: 'budget', text: 'Take the army above 60 on the index.', check: (g, s) => s.military >= 60 },
    { id: 'no-cuts', text: 'Stop cutting. Readiness must not fall this year.', check: (g, s, start) => s.readiness >= start.readiness },
    { id: 'finish-it', text: 'Finish the war you started, one way or the other.', check: (g) => activeWarsFor(g, g.playerId).length === 0 },
  ],
  capital: [
    { id: 'growth', text: 'Get the economy growing again — no negative quarters.', check: (g, s) => s.baseGrowth > 0 && g.turnReports.slice(-1)[0]?.growth !== undefined ? (g.turnReports.slice(-1)[0].growth ?? 1) > 0 : true },
    { id: 'solvency', text: 'Get the treasury back above water.', check: (g, s) => s.treasury >= 0 },
    { id: 'calm', text: 'Bring unrest below 40. Nobody invests into a riot.', check: (g, s) => s.unrest < 40 },
    { id: 'openness', text: 'Do not add another sanctions regime against us.', check: (g, s) => (s.sanctionedBy || []).length === 0 },
  ],
  street: [
    { id: 'unrest', text: 'Bring unrest below 35.', check: (g, s) => s.unrest < 35 },
    { id: 'approval', text: 'Get approval back above 55.', check: (g, s) => s.approval >= 55 },
    { id: 'no-war', text: 'No new wars. We have buried enough.', check: (g, s, start, opened) => opened === 0 },
    { id: 'spend', text: 'Spend on us, not on them.', check: (g, s, start) => s.approval > start.approval },
  ],
  party: [
    { id: 'stability', text: 'Hold stability above 60. We cannot campaign on chaos.', check: (g, s) => s.stability >= 60 },
    { id: 'standing', text: 'Do not let our standing abroad slip further.', check: (g, s, start) => s.influence >= start.influence },
    { id: 'approval', text: 'Approval above 50 by the review, or we start counting.', check: (g, s) => s.approval >= 50 },
    { id: 'no-scandal', text: 'No more backfires. Every one of them is our seat.', check: (g, s, start, opened, backfires) => backfires === 0 },
  ],
};

/** How long a faction waits before it decides you were not listening. */
const DEMAND_TURNS = 6;

// ── State ───────────────────────────────────────────────────────────────────

/** Create the four standings at the start of a run (or a new term). */
export function createFactions(game, rng, { carryOver = null } = {}) {
  const state = game.nations[game.playerId];
  const factions = {};
  for (const faction of FACTIONS) {
    const inherited = carryOver?.[faction.id];
    factions[faction.id] = {
      id: faction.id,
      // A new government starts with the benefit of the doubt; a re-elected one
      // starts with whatever it earned.
      mood: inherited
        ? clamp(inherited.mood * 0.7 + NEUTRAL * 0.3)
        : clamp(NEUTRAL + (rng ? rng.normal(0, 8) : 0) + startingBias(faction.id, state)),
      demand: null,
      pressed: 0,
    };
  }
  return factions;
}

/** A country's own shape tilts who starts on your side. */
function startingBias(id, state) {
  switch (id) {
    case 'staff': return (state.military - 50) / 8;
    case 'capital': return (state.tech - 50) / 10 - (state.unrest - 40) / 10;
    case 'street': return (state.approval - 50) / 6 - (state.unrest - 40) / 8;
    case 'party': return (state.stability - 50) / 7;
    default: return 0;
  }
}

export function factionsOf(game) {
  if (!game.factions) game.factions = createFactions(game, null);
  return game.factions;
}

export function moodOf(game, id) {
  return factionsOf(game)[id]?.mood ?? NEUTRAL;
}

/** A word for a standing, so the interface never shows a bare 0-100. */
export function standingBand(mood) {
  if (mood >= 78) return { id: 'devoted', label: 'behind you' };
  if (mood >= 62) return { id: 'supportive', label: 'supportive' };
  if (mood >= 45) return { id: 'watchful', label: 'watchful' };
  if (mood >= 28) return { id: 'restive', label: 'restive' };
  return { id: 'hostile', label: 'against you' };
}

// ── The quarter ─────────────────────────────────────────────────────────────

/**
 * Apply one resolved order to the four standings.
 *
 * A backfire is read as harshly as the order was read favourably: the faction
 * that wanted it is the faction that is now embarrassed.
 */
export function recordOrder(game, outcome, action) {
  if (outcome.actorId !== game.playerId) return null;
  const factions = factionsOf(game);
  const reading = readingOf(action);
  const scale = outcome.tier === 'critical' ? 1.4
    : outcome.tier === 'success' ? 1
      : outcome.tier === 'partial' ? 0.5
        : outcome.tier === 'failure' ? -0.35
          : -0.8;

  const moved = {};
  for (const id of FACTION_IDS) {
    // Approval of an order that then failed is not approval. Disapproval of one
    // that failed is vindication, so the sign flips rather than vanishing.
    const delta = reading[id] * (reading[id] >= 0 ? scale : Math.abs(scale) * Math.sign(scale) || scale);
    const before = factions[id].mood;
    factions[id].mood = clamp(before + delta * 0.9);
    moved[id] = Number((factions[id].mood - before).toFixed(2));
  }
  return moved;
}

/**
 * Standings drift, demands come due, and the political capital for next quarter
 * is worked out from who is still willing to spend theirs on you.
 *
 * @returns {object} what the briefing needs to explain the number
 */
export function tickFactions(game, rng, mods, report) {
  const factions = factionsOf(game);
  const state = game.nations[game.playerId];
  const notes = [];
  const opened = (report?.playerOutcomes || []).filter((o) => o.startedWar).length;
  const backfires = (report?.playerOutcomes || []).filter((o) => o.tier === 'backfire').length;

  for (const faction of FACTIONS) {
    const entry = factions[faction.id];

    // ── Demands ───────────────────────────────────────────────────────────
    if (entry.demand) {
      const spec = DEMANDS[faction.id].find((d) => d.id === entry.demand.id);
      const met = spec ? spec.check(game, state, entry.demand.snapshot, opened, backfires) : true;
      if (met) {
        entry.mood = clamp(entry.mood + rng.float(7, 12));
        notes.push({ factionId: faction.id, kind: 'met', text: entry.demand.text });
        entry.demand = null;
      } else if (game.turn >= entry.demand.dueTurn) {
        entry.mood = clamp(entry.mood - rng.float(11, 18));
        notes.push({ factionId: faction.id, kind: 'failed', text: entry.demand.text });
        entry.demand = null;
      }
    }

    // A faction with nothing to ask for asks for something, sooner if it is
    // unhappy. Contented factions leave you alone, which is the reward.
    if (!entry.demand && rng.bool(entry.mood >= 70 ? 0.12 : entry.mood >= 45 ? 0.3 : 0.5)) {
      const options = DEMANDS[faction.id].filter((d) => !d.check(game, state, snapshotOf(state), opened, backfires));
      const spec = options.length ? rng.pick(options) : null;
      if (spec) {
        entry.demand = {
          id: spec.id,
          text: spec.text,
          dueTurn: game.turn + DEMAND_TURNS,
          snapshot: snapshotOf(state),
        };
        notes.push({ factionId: faction.id, kind: 'new', text: spec.text });
      }
    }

    // ── Drift ─────────────────────────────────────────────────────────────
    // Standing is rented, never owned: everything reverts toward indifference.
    // On top of that, the state of the country moves all four together — a
    // government presiding over a calm, solvent, functioning state keeps its
    // creditors without doing anything for them, and one presiding over a mess
    // loses them without doing anything to them. Signed, so competence is
    // rewarded rather than merely not punished.
    const health = (48 - state.unrest) / 40 + (state.stability - 52) / 42;
    entry.mood = clamp(
      entry.mood + (NEUTRAL - entry.mood) * 0.06 + Math.max(-2.4, Math.min(1.4, health)) * 0.8,
    );
  }

  const consequences = factionConsequences(game, rng, mods);
  const capital = politicalCapitalFrom(game, mods);

  return { notes, consequences, capital, standings: snapshotStandings(game) };
}

function snapshotOf(state) {
  return {
    readiness: state.readiness,
    approval: state.approval,
    influence: state.influence,
    stability: state.stability,
  };
}

export function snapshotStandings(game) {
  const factions = factionsOf(game);
  return FACTIONS.map((f) => ({
    id: f.id,
    mood: Math.round(factions[f.id].mood),
    band: standingBand(factions[f.id].mood),
    demand: factions[f.id].demand ? { ...factions[f.id].demand } : null,
  }));
}

/**
 * Next quarter's political capital, and where every point of it came from.
 *
 * Four supporters at fifty give you roughly what the old flat formula did. Four
 * at eighty give you room to govern; four at twenty leave you unable to pass
 * anything, which is the point.
 */
export function politicalCapitalFrom(game, mods) {
  const factions = factionsOf(game);
  const state = game.nations[game.playerId];
  const sources = [];

  // The office itself is worth something, whoever hates you.
  sources.push({ id: 'office', label: 'the office', value: 2 });

  for (const faction of FACTIONS) {
    const mood = factions[faction.id].mood;
    // −1 at rock bottom, +2 at devoted. A hostile faction is not neutral: it
    // spends its own capital against you.
    const value = Number(((mood - 42) / 22).toFixed(2));
    sources.push({ id: faction.id, label: faction.name, value: Math.max(-1.2, Math.min(2.2, value)) });
  }

  sources.push({
    id: 'difficulty',
    label: 'the times',
    value: mods.politicalCapitalBonus + (state.approval - 50) / 50,
  });

  const raw = sources.reduce((sum, s) => sum + s.value, 0);
  return {
    total: Math.max(1, Math.min(12, Math.round(raw))),
    sources: sources.map((s) => ({ ...s, value: Number(s.value.toFixed(2)) })),
  };
}

/**
 * What happens when a faction gives up on you.
 *
 * Each has its own way of withdrawing consent, and each is something the player
 * can see coming for several quarters — the standing is on the dashboard long
 * before the consequence lands.
 */
function factionConsequences(game, rng, mods) {
  const factions = factionsOf(game);
  const state = game.nations[game.playerId];
  const out = [];

  const fire = (id, chance) => {
    const mood = factions[id].mood;
    if (mood >= 26) {
      factions[id].pressed = 0;
      return false;
    }
    factions[id].pressed += 1;
    // The first quarter below the line is a warning; it takes sustained
    // hostility to produce the event itself.
    return factions[id].pressed >= 2 && rng.bool(chance * (1 + (26 - mood) / 26));
  };

  if (fire('staff', 0.16 * mods.aiAggression)) {
    const loyal = state.stability > 55 && state.approval > 45;
    state.readiness = clamp(state.readiness - rng.float(6, 14));
    state.stability = clamp(state.stability - rng.float(4, 11));
    if (!loyal && rng.bool(0.3)) {
      state.stability = clamp(state.stability - rng.float(12, 22));
      state.unrest = clamp(state.unrest + rng.float(10, 20));
      out.push(entry(game, 'staff', 'critical',
        t('faction.staffCoup', 'Elements of the officer corps move against the government. The attempt fails, but the garrisons are no longer taking your calls.')));
    } else {
      out.push(entry(game, 'staff', 'major',
        t('faction.staffSulk', 'The general staff briefs against you. Deployments slip, exercises are cancelled, and the readiness figures stop improving.')));
    }
  }

  if (fire('capital', 0.3)) {
    state.modifiers.push({
      id: 'capital-flight', label: 'Capital flight', turnsLeft: 6,
      growth: -rng.float(0.3, 0.55), stability: -0.1, unrest: 0.3,
      influence: 0, readiness: 0, tech: 0, revenue: -(state.gdp * 1000 * 0.004),
      source: 'faction',
    });
    out.push(entry(game, 'capital', 'major',
      t('faction.capitalFlight', 'Money leaves. The currency slips, the bond desk stops bidding, and every project you have not yet paid for gets more expensive.')));
  }

  if (fire('street', 0.34 * mods.unrestMultiplier)) {
    state.unrest = clamp(state.unrest + rng.float(9, 18) * mods.unrestMultiplier);
    state.approval = clamp(state.approval - rng.float(4, 9));
    state.modifiers.push({
      id: 'general-strike', label: 'General strike', turnsLeft: 4,
      growth: -rng.float(0.25, 0.5), unrest: 0.6, stability: -0.2,
      influence: 0, readiness: 0, tech: 0, revenue: 0, source: 'faction',
    });
    out.push(entry(game, 'street', 'major',
      t('faction.streetStrike', 'The unions call a general strike and the cities answer. Nothing moves for a fortnight and the pictures go everywhere.')));
  }

  if (fire('party', 0.26)) {
    state.stability = clamp(state.stability - rng.float(5, 12));
    state.approval = clamp(state.approval - rng.float(3, 8));
    game.politicalCapital = Math.max(1, game.politicalCapital - 2);
    out.push(entry(game, 'party', 'major',
      t('faction.partyChallenge', 'Your own side tables a leadership challenge. You survive it, and spend the next three months paying for the votes.')));
  }

  return out;
}

function entry(game, factionId, severity, text) {
  logEvent(game, { type: 'faction', severity, text, nations: [game.playerId] });
  return { factionId, severity, text };
}
