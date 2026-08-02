// The quarter. Orders resolve, the world answers, the books get balanced.

import { NATIONS_BY_ID } from '../data/nations.js';
import { ACTIONS_BY_ID } from './actions.js';
import { gameModifiers } from './worldmodes.js';
import { applyGlobalEvent, rollEvents } from './events.js';
import { applyEffect } from './effects.js';
import { runOpponents } from './opponents.js';
import { decayLadders, domesticBlowback, playerLadders, resolveConsequences } from './consequences.js';
import { availableFunds, creditLimit, debtOf, serviceDebt } from './finance.js';
import { resolveAction, resolveDecision } from './resolve.js';
import { driftAlignments, reconcileSovereignty } from './statecraft.js';
import { containment, primaryThreat } from './coalitions.js';
import { ensureTerm } from './lifecycle.js';
import { recordOrder, tickFactions } from './factions.js';
import { noteQuarter, updateNemesis } from './nemesis.js';
import { decayIntel, recordIntel } from './intel.js';
import { liveObjectives, meets, reviewDue, reviewMandate } from './mandate.js';
import { tickCommitments } from './commitments.js';
import { congressDue, congressOutcome, convene, resolveCongress } from './congress.js';
import { ambitionBonus } from './ambitions.js';
import { electionState } from './lifecycle.js';
import {
  QUARTERS,
  activeWarsFor,
  adjustRelation,
  clamp,
  dateLabel,
  defOf,
  isSovereign,
  getRelation,
  livePower,
  logEvent,
  rankedNations,
  sovereignIds,
  sovereignStates,
  withRng,
} from './state.js';
import { tickWars } from './war.js';

const REVENUE_RATE = 0.045; // of annual GDP, per quarter
const MILITARY_UPKEEP = 0.011;

/**
 * Advance one quarter.
 *
 * @param {object} game
 * @param {{orders: Array, decisionChoice?: string|null}} input
 * @returns {object} turn report — the mechanical truth the narrator writes from
 */
export function advanceTurn(game, { orders = [], decisionChoice = null } = {}) {
  if (game.status !== 'active') {
    throw new Error('This game has already ended.');
  }
  ensureTerm(game);
  const mods = gameModifiers(game);

  return withRng(game, (rng) => {
    game.turn += 1;
    game.quarter = (game.quarter + 1) % 4;
    if (game.quarter === 0) game.year += 1;

    const report = {
      turn: game.turn,
      date: dateLabel(game),
      playerOutcomes: [],
      decision: null,
      worldOutcomes: [],
      events: [],
      wars: [],
      economy: null,
      consequences: [],
      newDecision: null,
      status: 'active',
    };

    // 1. The player's standing crisis, if one was pending.
    if (decisionChoice && game.pendingDecision) {
      report.decision = resolveDecision(game, rng, mods, decisionChoice);
    } else if (game.pendingDecision) {
      // Ignoring a crisis has its own cost.
      const state = game.nations[game.playerId];
      state.approval = clamp(state.approval - 4);
      state.unrest = clamp(state.unrest + 3 * mods.unrestMultiplier);
      report.decision = {
        type: 'decision',
        title: game.pendingDecision.title,
        choice: 'No decision taken',
        succeeded: false,
        text: `${game.pendingDecision.title} — your government failed to decide. The initiative passed to others.`,
        changes: [],
      };
      logEvent(game, { type: 'decision', severity: 'major', text: report.decision.text });
      game.pendingDecision = null;
    }

    // 2. Player orders, and whatever they set off.
    for (const order of orders.slice(0, 4)) {
      const outcome = resolveAction(game, rng, mods, order, game.playerId);
      if (!outcome) continue;
      report.playerOutcomes.push(outcome);
      // Every order is read by the four domestic creditors, and anything aimed
      // at another country may have bought you a look at them.
      outcome.factions = recordOrder(game, outcome, ACTIONS_BY_ID[outcome.actionId] || order.custom);
      outcome.intelGained = recordIntel(game, outcome);
      const chain = [
        ...resolveConsequences(game, rng, mods, outcome),
        ...domesticBlowback(game, rng, mods, outcome),
      ];
      outcome.chain = chain;
      report.consequences.push(...chain);
    }

    // 3. Everyone else, and whatever they set off.
    report.worldOutcomes = runOpponents(game, rng, mods);
    for (const outcome of report.worldOutcomes) {
      // Everything aimed at the player provokes a chain; elsewhere in the world
      // only some do, or the briefing drowns in other people's quarrels.
      const touchesPlayer = outcome.targetId === game.playerId || outcome.actorId === game.playerId;
      if (!touchesPlayer && !rng.bool(0.3)) continue;
      const chain = resolveConsequences(game, rng, mods, outcome);
      if (chain.length) {
        outcome.chain = chain;
        report.consequences.push(...chain);
      }
    }

    // 4. Random world events.
    const rolled = rollEvents(game, rng, mods);
    for (const entry of rolled.entries) {
      applyEventEntry(game, entry);
      // An event that redraws the map or changes an alliance does it here,
      // after its statistical damage has been applied.
      if (typeof entry.follow === 'function') {
        entry.outcome = entry.follow(game, rng) || null;
        entry.follow = null;
      }
      report.events.push(entry);
      logEvent(game, { type: 'event', severity: 'info', text: entry.text });
    }

    // Countries also drift between camps on their own, without an event.
    report.realignments = driftAlignments(game, rng, mods);
    // …and they line up against whoever has been taking things.
    report.containment = containment(game, rng, mods);
    report.threat = primaryThreat(game);
    if (rolled.decision) {
      game.pendingDecision = rolled.decision;
      report.newDecision = rolled.decision;
    }

    // 5. Wars grind on, and then the map is reconciled: anyone pushed off it
    //    entirely stops being a country, anyone who gets their ground back is
    //    one again.
    report.wars = tickWars(game, rng, mods);
    report.sovereignty = reconcileSovereignty(game, rng);

    // 6. Books, modifiers, drift.
    report.economy = economyTick(game, rng, mods);
    decayLadders(game);
    relationDrift(game, rng, mods);
    tensionDrift(game, rng, mods);

    // 7. The rivalry, the fog, and the four creditors of political capital.
    noteQuarter(game, report);
    report.nemesis = updateNemesis(game, rng);
    decayIntel(game);

    report.factions = tickFactions(game, rng, mods, report);
    game.politicalCapital = report.factions.capital.total;

    // The brief is rewritten every two years from whatever has happened since.
    if (reviewDue(game)) {
      report.mandate = reviewMandate(game, rng, scoreContext(game));
    }

    // The closing session convenes in the last year and votes in the last
    // quarter, so a term ends on a decision rather than on a clock.
    if (congressDue(game) && !game.congress) {
      convene(game, rng);
      report.congressOpened = true;
    }
    if (game.congress && !game.congress.resolved && game.turn >= game.totalTurns) {
      report.congressResults = resolveCongress(game, rng);
    }

    // 8. Snapshot + endgame check.
    for (const state of Object.values(game.nations)) {
      const snapshot = {
        turn: game.turn,
        gdp: Number(state.gdp.toFixed(3)),
        military: Math.round(state.military),
        stability: Math.round(state.stability),
      };
      // The player's card shows a quarter-on-quarter change for every figure on
      // it, so the player's row keeps the full set. Everyone else keeps three,
      // which is all the charts and the AI digest ever read.
      if (state.id === game.playerId) {
        Object.assign(snapshot, {
          readiness: Math.round(state.readiness),
          tech: Math.round(state.tech),
          unrest: Math.round(state.unrest),
          approval: Math.round(state.approval),
          influence: Math.round(state.influence),
          treasury: Math.round(state.treasury),
          population: Math.round(state.population),
        });
      }
      state.history.push(snapshot);
      if (state.history.length > 60) state.history.shift();
    }

    const ending = checkEndgame(game, mods);
    if (ending) {
      game.status = ending.status;
      game.ending = ending;
      report.status = ending.status;
      report.ending = ending;
    }

    game.turnReports.push(summariseReport(report));
    if (game.turnReports.length > 60) game.turnReports.shift();

    return report;
  });
}

function applyEventEntry(game, entry) {
  if (entry.global) {
    applyGlobalEvent(game, entry);
    return;
  }
  if (entry.pair) {
    const [a, b] = entry.pair;
    adjustRelation(game, a, b, entry.relationDelta || 0);
    if (entry.worldTension) game.worldTension = clamp(game.worldTension + entry.worldTension, 0, 100);
    if (entry.bothSides) {
      for (const id of [a, b]) applyEffect(game, id, null, { self: entry.bothSides });
    }
    return;
  }
  if (entry.appliesTo) {
    applyEffect(game, entry.appliesTo, null, entry.effect);
    if (entry.relationShock) {
      adjustRelation(game, game.playerId, entry.appliesTo, entry.relationShock);
    }
    if (entry.worldTension) {
      game.worldTension = clamp(game.worldTension + entry.worldTension, 0, 100);
    }
  }
}

function economyTick(game, rng, mods) {
  const summary = { playerGrowth: 0, playerRevenue: 0, playerUpkeep: 0, worldGrowth: 0 };

  // A mild global cycle so the world is not a metronome.
  game.globalGrowth = clamp(game.globalGrowth + rng.normal(0, 0.06), 0.6, 1.4);

  for (const state of sovereignStates(game)) {
    const isPlayer = state.id === game.playerId;

    // Modifiers decay and contribute.
    let modGrowth = 0;
    for (const mod of state.modifiers) {
      modGrowth += mod.growth || 0;
      if (mod.stability) state.stability = clamp(state.stability + mod.stability);
      if (mod.unrest) state.unrest = clamp(state.unrest + mod.unrest);
      if (mod.influence) state.influence = clamp(state.influence + mod.influence);
      if (mod.readiness) state.readiness = clamp(state.readiness + mod.readiness);
      if (mod.tech) state.tech = clamp(state.tech + mod.tech);
      mod.turnsLeft -= 1;
    }
    state.modifiers = state.modifiers.filter((m) => m.turnsLeft > 0);

    const outlook = growthOutlook(game, state.id, mods);
    const { drivers } = outlook;
    let growth = outlook.growth;
    growth += rng.normal(0, 0.08);

    state.gdp = Math.max(0.004, state.gdp * (1 + growth / 100));

    // Revenue and standing costs.
    const { revenue, upkeep } = ledgerFor(game, state.id, mods);
    state.treasury = state.treasury + revenue - upkeep;

    // Standing commitments draw their instalment before anything else. This is
    // money you decided to spend several years ago and cannot decline today.
    if (isPlayer) {
      const committed = tickCommitments(game);
      summary.committed = Math.round(committed.paid);
      summary.commitmentsFinished = committed.finished.map((c) => c.label);
    }

    // Deficits are financed, not magicked away.
    const debtReport = serviceDebt(game, state, rng, mods);
    if (isPlayer && debtReport) summary.debt = debtReport;

    // Drift back toward the country's structural equilibrium. Gains in
    // stability and approval are rented, never owned: stop paying and they go.
    // Stability reverts toward a structural baseline, but sustained unrest
    // drags that baseline down — which is how a state actually fails, rather
    // than being rescued by its own equilibrium every quarter.
    const def = defOf(game, state.id);
    const equilibrium = def.stability - Math.max(0, state.unrest - 40) * 0.85;
    state.stability = clamp(state.stability + (equilibrium - state.stability) * 0.085);
    state.unrest = clamp(state.unrest + (state.unrest > def.unrest ? -0.8 : 0.35));
    state.readiness = clamp(state.readiness + (state.readiness < 70 ? 0.6 : -0.2));
    state.approval = clamp(state.approval + (50 - state.approval) * 0.06);
    state.population = state.population * (1 + (def.growth > 1 ? 0.0018 : 0.0003));

    if (isPlayer) {
      summary.playerGrowth = Number(growth.toFixed(2));
      summary.playerRevenue = Math.round(revenue);
      summary.playerUpkeep = Math.round(upkeep);
      // What actually moved the number, so the briefing can explain itself
      // instead of just reporting a percentage.
      summary.drivers = drivers;
      summary.modifierCount = state.modifiers.length;
      summary.credit = Math.round(creditLimit(state));
      summary.available = Math.round(availableFunds(state));
    }
    summary.worldGrowth += growth;
  }

  summary.worldGrowth = Number((summary.worldGrowth / Math.max(1, sovereignIds(game).length)).toFixed(2));
  return summary;
}

/**
 * What this country's economy is set up to do next quarter, and why.
 *
 * The same arithmetic the quarter itself runs, minus the dice — so the
 * interface can show a player where their growth is coming from *before* they
 * commit, instead of explaining it afterwards. Pure: it reads the state and
 * changes nothing.
 *
 * @returns {{growth: number, drivers: Array<{label: string, value: number}>}}
 */
export function growthOutlook(game, id, mods = gameModifiers(game)) {
  const state = game.nations[id];
  if (!state) return { growth: 0, drivers: [] };
  const isPlayer = id === game.playerId;

  let modGrowth = 0;
  for (const mod of state.modifiers) modGrowth += mod.growth || 0;

  const warDrag = activeWarsFor(game, id).length * -0.35;
  const stabilityEffect = (state.stability - 60) / 300;
  const unrestEffect = -Math.max(0, state.unrest - 35) / 130;
  const techEffect = (state.tech - 55) / 800;

  // Stimulus programmes stack with diminishing returns — you cannot simply
  // buy a permanent boom by queueing growth modifiers every quarter.
  const effectiveMods = Math.sign(modGrowth) * 0.62 * Math.sqrt(Math.abs(modGrowth) / 0.62);

  // Convergence: rich economies do not grow like developing ones.
  const perCapita = (state.gdp / Math.max(state.population, 0.1)) * 1e6;
  const convergence = -0.4 * Math.log10(Math.max(1, perCapita / 18000));

  let growth =
    (state.baseGrowth +
      effectiveMods +
      stabilityEffect +
      unrestEffect +
      techEffect +
      convergence +
      warDrag) *
    game.globalGrowth;
  if (isPlayer) growth *= mods.growthMultiplier;

  const drivers = [
    { label: 'underlying trend', value: state.baseGrowth },
    { label: 'your programmes', value: effectiveMods },
    { label: 'institutional strength', value: stabilityEffect },
    { label: 'unrest', value: unrestEffect },
    { label: 'technology', value: techEffect },
    { label: 'the size you already are', value: convergence },
    { label: 'the war', value: warDrag },
  ]
    .filter((d) => Math.abs(d.value) >= 0.03)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .map((d) => ({ ...d, value: Number(d.value.toFixed(2)) }));

  return { growth, drivers };
}

/**
 * The quarter's books: what the state collects and what standing forces cost
 * it before a single order is issued.
 *
 * @returns {{revenue: number, upkeep: number, net: number, collection: number}}
 */
export function ledgerFor(game, id, mods = gameModifiers(game)) {
  const state = game.nations[id];
  if (!state) return { revenue: 0, upkeep: 0, net: 0, collection: 0 };

  // A state that cannot govern cannot collect, which is why failing countries
  // go broke faster than their economies shrink.
  const collection = clamp(0.55 + state.stability / 140, 0.4, 1.15);
  let revenue = state.gdp * 1000 * REVENUE_RATE * collection;
  if (id === game.playerId) revenue *= mods.budgetMultiplier;
  for (const mod of state.modifiers) revenue += mod.revenue || 0;

  const upkeep = state.gdp * 1000 * MILITARY_UPKEEP * (state.military / 60);
  return { revenue, upkeep, net: revenue - upkeep, collection };
}

function relationDrift(game, rng, mods) {
  const ids = sovereignIds(game);
  // Sample rather than sweep: 60 pairs a turn is plenty of movement.
  for (let i = 0; i < 60; i++) {
    const a = rng.pick(ids);
    const b = rng.pick(ids);
    if (a === b) continue;
    const current = getRelation(game, a, b);
    // Relations decay toward neutral, faster when the world is tense.
    const pull = -current * 0.012 * (a === game.playerId || b === game.playerId ? mods.diplomaticFriction : 1);
    adjustRelation(game, a, b, pull + rng.normal(0, 0.8 * (mods.relationVolatility ?? 1)));
  }
}

function tensionDrift(game, rng, mods) {
  const activeWars = game.wars.filter((w) => w.active).length;
  const nuclearShadow = game.stats.nukesUsed > 0 ? 15 : 0;
  // Tension mean-reverts toward what the world's actual conflicts justify.
  // Without this, sixty countries running exercises every quarter would peg it
  // at 100 permanently and it would stop carrying information.
  const equilibrium = clamp(34 + activeWars * 13 + nuclearShadow + (mods.tensionOffset || 0), 0, 100);
  game.worldTension = clamp(
    game.worldTension + (equilibrium - game.worldTension) * 0.17 + rng.normal(0, 1.2),
    0,
    100,
  );
}

function checkEndgame(game, mods) {
  const player = game.nations[game.playerId];
  const def = NATIONS_BY_ID[game.playerId];

  // Being conquered outright ends the run whatever the statistics say.
  if (!isSovereign(game, game.playerId)) {
    const conqueror = defOf(game, player.annexedBy);
    return {
      status: 'defeat',
      kind: 'conquest',
      title: 'Conquered',
      summary: conqueror
        ? `${def.name} is occupied in its entirety. ${conqueror.name} administers what is left of it from ${dateLabel(game)}.`
        : `${def.name} is occupied in its entirety and ceases to exist as an independent state in ${dateLabel(game)}.`,
      score: scoreRun(game, mods, { collapsed: true }),
    };
  }

  if (player.stability <= 6 || (player.stability < 22 && player.unrest > 88)) {
    return {
      status: 'defeat',
      kind: 'collapse',
      title: 'Government Collapse',
      summary: `The ${def.adjective} state loses its capacity to govern. Your administration falls in ${dateLabel(game)}.`,
      score: scoreRun(game, mods, { collapsed: true }),
    };
  }

  if (game.turn >= game.totalTurns) {
    const score = scoreRun(game, mods, { collapsed: false });
    // A term ends in an election, not in a full stop. Whether the country will
    // have you again, and whether the constitution would even allow it, is the
    // last decision of the term rather than a verdict handed down after it.
    const election = electionState(game, score);
    return {
      status: score.total >= 60 ? 'victory' : 'complete',
      kind: 'term-end',
      title: score.total >= 60 ? 'Term Concluded — Mandate Vindicated' : 'Term Concluded',
      summary: `Your time in office ends in ${dateLabel(game)} with ${def.name} ${score.verdict}.`,
      score,
      election,
      settlement: congressOutcome(game),
    };
  }

  return null;
}

/** Grade the run against the objectives set at the start. */
/**
 * The derived figures every objective is judged against, computed once so a
 * mandate of six does not recompute GDP growth six times.
 */
export function scoreContext(game) {
  const player = game.nations[game.playerId];
  const start = game.startSnapshot;
  const wars = game.wars.filter(
    (w) => w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId),
  );
  return {
    gdpGrowth: player.gdp / start.gdp - 1,
    influenceGain: player.influence - start.influence,
    wars,
    warsWon: wars.filter(
      (w) => !w.active && w.outcome?.includes(NATIONS_BY_ID[game.playerId]?.adjective || '\u0000'),
    ).length,
  };
}

export function scoreRun(game, mods = gameModifiers(game), { collapsed = false } = {}) {
  ensureTerm(game);
  const player = game.nations[game.playerId];
  const start = game.startSnapshot;

  const ctx = scoreContext(game);
  const { gdpGrowth, influenceGain, wars, warsWon } = ctx;
  const nuclearOnWatch = game.stats.nukesUsed > 0;

  // Graded against what the country would have done on autopilot, so a 0.3%/quarter
  // economy is not automatically outscored by a 1.6%/quarter one.
  const baseline = (1 + player.baseGrowth / 100) ** game.turn - 1;

  const components = [
    { id: 'economy', label: 'Economic record', value: clamp(52 + (gdpGrowth - baseline) * 420, 0, 100) },
    { id: 'stability', label: 'Domestic order', value: clamp(player.stability * 0.75 + (100 - player.unrest) * 0.25, 0, 100) },
    { id: 'standing', label: 'Global standing', value: clamp(player.influence * 0.7 + influenceGain * 2 + 15, 0, 100) },
    { id: 'security', label: 'Security', value: clamp(60 + warsWon * 14 - wars.filter((w) => w.active).length * 12 - (nuclearOnWatch ? 45 : 0), 0, 100) },
    { id: 'order', label: 'World order', value: clamp(100 - game.worldTension, 0, 100) },
  ];

  const weights = { economy: 0.26, stability: 0.24, standing: 0.2, security: 0.2, order: 0.1 };
  let total = components.reduce((sum, c) => sum + c.value * weights[c.id], 0);
  if (collapsed) total *= 0.35;
  // A hard run is worth more than an easy one, but only by a sixth either way.
  total = clamp(total * (0.85 + mods.t * 0.3), 0, 100);

  const objectives = liveObjectives(game).map((obj) => ({ ...obj, met: meets(game, obj, ctx) }));

  // Two things sit outside the five components: what the country privately
  // wanted, and how the closing settlement went. Both are worth a few points
  // and neither can rescue a bad decade on its own.
  const secret = ambitionBonus(game);
  const settlement = congressOutcome(game);
  const settlementBonus = settlement
    ? settlement.yoursCarried * 3 + Math.min(4, settlement.wentYourWay)
    : 0;
  total = clamp(total + secret + settlementBonus, 0, 100);

  const grade =
    total >= 88 ? 'S' : total >= 78 ? 'A' : total >= 66 ? 'B' : total >= 52 ? 'C' : total >= 38 ? 'D' : 'F';

  const verdict = collapsed
    ? 'in institutional collapse'
    : total >= 78
      ? 'measurably stronger than you found it'
      : total >= 60
        ? 'in better shape than most expected'
        : total >= 45
          ? 'roughly where you found it'
          : 'weaker than when you took office';

  return {
    total: Math.round(total),
    grade,
    verdict,
    components: components.map((c) => ({ ...c, value: Math.round(c.value) })),
    objectives,
    ambitionBonus: secret,
    settlement,
    settlementBonus,
    term: game.term || 1,
    gdpGrowth,
    influenceGain,
    difficulty: game.difficulty,
    tier: mods.tier.name,
  };
}

function summariseReport(report) {
  return {
    turn: report.turn,
    date: report.date,
    headline: report.headline || null,
    playerActions: report.playerOutcomes.map((o) => `${o.actionName}: ${o.tierLabel}`),
    consequences: report.consequences.map((c) => c.label),
    events: report.events.map((e) => e.title),
    wars: report.wars.filter((w) => w.type === 'war-end').map((w) => w.text),
  };
}

/** Compact machine-readable digest of the world — what the narrator is fed. */
export function worldDigest(game, limit = 12) {
  const ranked = rankedNations(game).slice(0, limit);
  return {
    date: dateLabel(game),
    turn: game.turn,
    totalTurns: game.totalTurns,
    worldTension: Math.round(game.worldTension),
    difficulty: game.difficulty,
    player: nationDigest(game, game.playerId),
    powers: ranked.map((r) => ({
      id: r.state.id,
      name: r.def.name,
      gdp: Number(r.state.gdp.toFixed(2)),
      military: Math.round(r.state.military),
      stability: Math.round(r.state.stability),
      relationToPlayer: getRelation(game, game.playerId, r.state.id),
    })),
    escalation: playerLadders(game)
      .filter((l) => l.value >= 1.5)
      .slice(0, 5)
      .map((l) => ({ with: defOf(game, l.id).name, level: Number(l.value.toFixed(1)), band: l.label })),
    wars: game.wars
      .filter((w) => w.active)
      .map((w) => ({
        name: w.name,
        attackers: w.attackers.map((id) => defOf(game, id).name),
        defenders: w.defenders.map((id) => defOf(game, id).name),
        warScore: Math.round(w.warScore),
        casualties: w.casualties,
      })),
  };
}

export function nationDigest(game, id) {
  const state = game.nations[id];
  const def = defOf(game, id);
  return {
    id,
    name: def.name,
    government: def.government,
    leaderTitle: def.leaderTitle,
    gdp: Number(state.gdp.toFixed(2)),
    treasury: Math.round(state.treasury),
    population: Math.round(state.population),
    military: Math.round(state.military),
    readiness: Math.round(state.readiness),
    tech: Math.round(state.tech),
    stability: Math.round(state.stability),
    approval: Math.round(state.approval),
    unrest: Math.round(state.unrest),
    influence: Math.round(state.influence),
    nukes: state.nukes,
    power: Math.round(livePower(game, id)),
    modifiers: state.modifiers.map((m) => m.label),
  };
}

export { QUARTERS };
