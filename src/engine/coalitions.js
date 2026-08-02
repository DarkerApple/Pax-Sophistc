// Balance of power.
//
// A country that keeps attacking people, and keeps winning, becomes everybody
// else's problem. This module is the world noticing.
//
// It keeps one number per country — its **threat**, on 0 to 1 — built from how
// much of the world's power it holds, how much of it that country has been
// using lately, and what it has actually done with it: wars started, borders
// moved, states absorbed. Threat then does three things:
//
//   1. It pulls third parties into wars on the *defending* side, whether or not
//      they have a treaty. A great power invading a small neighbour used to be
//      a private matter; now the region takes a view.
//   2. It aims containment at the aggressor between wars — sanctions, forward
//      deployments, arms to whoever it is fighting.
//   3. It sours relations by itself, so a run of conquests is felt everywhere,
//      not only where the tanks are.
//
// Threat is per-aggressor, not per-player: the AI is subject to exactly the
// same arithmetic, and a runaway AI conqueror will find the board turning on it
// just as fast.

import { alliesOf, treatyBetween } from './treaties.js';
import { t, tNation } from '../i18n/index.js';
import {
  adjustRelation,
  clamp,
  combatPower,
  defOf,
  getRelation,
  livePower,
  logEvent,
  proximity,
  sovereignIds,
} from './state.js';
import { areaOf, startingAreaOf } from './territory.js';

/** How long an act of aggression stays on the record, in quarters. */
const MEMORY = 16;

function ledger(game) {
  if (!game.aggression) game.aggression = {};
  return game.aggression;
}

/**
 * Record something the world will hold against a country.
 * @param {string} kind  'war' | 'conquest' | 'annexation' | 'nuclear'
 */
export function recordAggression(game, actorId, kind, weight = 1) {
  if (!actorId) return;
  const book = ledger(game);
  const entries = book[actorId] || (book[actorId] = []);
  entries.push({ turn: game.turn, kind, weight });
  // Bounded: the world has a long memory, not an infinite one.
  book[actorId] = entries.filter((e) => game.turn - e.turn <= MEMORY).slice(-20);
}

/** The weight of what a country has done lately, decayed by how long ago. */
export function aggressionScore(game, actorId) {
  const entries = ledger(game)[actorId] || [];
  let score = 0;
  for (const entry of entries) {
    const age = game.turn - entry.turn;
    if (age > MEMORY) continue;
    score += entry.weight * (1 - age / MEMORY);
  }
  return score;
}

/**
 * How dangerous the rest of the world finds this country, 0 to 1.
 *
 * Power alone is not threatening — the United States and China are both large
 * without the world mobilising against either. What is threatening is power
 * *plus* a demonstrated willingness to use it to take things.
 */
export function threatOf(game, actorId) {
  const state = game.nations[actorId];
  if (!state || state.sovereign === false) return 0;

  const powers = sovereignIds(game).map((id) => livePower(game, id));
  const total = powers.reduce((a, b) => a + b, 0) || 1;
  const share = livePower(game, actorId) / total;
  // A twentieth of the world is unremarkable; a fifth of it is not.
  const size = clamp((share - 0.05) / 0.18, 0, 1);

  const deeds = clamp(aggressionScore(game, actorId) / 4.5, 0, 1);

  // Ground actually taken since the run began, as a share of what it started
  // with. This is the part nobody can argue with.
  const started = Math.max(1, startingAreaOf(game, actorId));
  const grown = clamp((areaOf(game, actorId) / started - 1) / 0.45, 0, 1);

  const activeWars = game.wars.filter(
    (w) => w.active && w.attackers.includes(actorId),
  ).length;
  const fighting = clamp(activeWars / 2, 0, 1);

  return clamp(size * 0.32 + deeds * 0.38 + grown * 0.2 + fighting * 0.1, 0, 1);
}

/** Everyone the world currently considers a danger, worst first. */
export function threats(game, floor = 0.25) {
  return sovereignIds(game)
    .map((id) => ({ id, threat: threatOf(game, id) }))
    .filter((entry) => entry.threat >= floor)
    .sort((a, b) => b.threat - a.threat);
}

/**
 * Will this country join a war against the aggressor?
 *
 * Four things decide it: how threatening the aggressor has become, whether the
 * joiner is close enough to be next, whether it dislikes the aggressor already,
 * and whether it is strong enough for the gesture to mean anything. A treaty
 * still matters most — but it is no longer the only thing that matters.
 *
 * @returns {number} probability, 0 to 1
 */
export function balancingChance(game, joinerId, aggressorId, victimId, mods = {}) {
  if (joinerId === aggressorId || joinerId === victimId) return 0;
  const joiner = game.nations[joinerId];
  if (!joiner || joiner.sovereign === false) return 0;

  const joinerDef = defOf(game, joinerId);
  const aggressorDef = defOf(game, aggressorId);
  const victimDef = defOf(game, victimId);
  if (!joinerDef || !aggressorDef || !victimDef) return 0;

  const threat = threatOf(game, aggressorId);
  if (threat < 0.12) return 0;

  const toAggressor = getRelation(game, joinerId, aggressorId);
  const toVictim = getRelation(game, joinerId, victimId);

  // You do not fight your friend to save a country you dislike more.
  if (toAggressor > 45) return 0;
  if (toVictim < -55 && toAggressor > -30) return 0;

  // Being next in line concentrates the mind.
  const exposure = Math.max(proximity(joinerDef, aggressorDef), proximity(joinerDef, victimDef));

  // A country with no army does not open a second front, however alarmed — but
  // the whole point of balancing is that states which cannot match the
  // aggressor alone combine until they can. Parity is not the bar; being able
  // to contribute is.
  const ratio = combatPower(game, joinerId) / Math.max(1, combatPower(game, aggressorId));
  const capacity = clamp(0.25 + Math.log2(1 + ratio * 3) * 0.55, 0.15, 1.2);

  // Somebody has to go first. Once a coalition exists, joining it is easier.
  const already = coalitionSize(game, aggressorId);
  const bandwagon = 1 + Math.min(0.8, already * 0.22);

  const dislike = clamp((-toAggressor + 20) / 80, 0, 1.3);
  const sympathy = clamp((toVictim + 40) / 100, 0, 1.2);

  const chance =
    threat * 0.55 *
    (0.35 + exposure * 0.75) *
    capacity *
    bandwagon *
    (0.45 + dislike * 0.7 + sympathy * 0.45) *
    (mods.aiAggression ?? 1);

  return clamp(chance, 0, 0.82);
}

/** How many countries are already fighting this one. */
function coalitionSize(game, aggressorId) {
  const against = new Set();
  for (const war of game.wars) {
    if (!war.active) continue;
    if (war.attackers.includes(aggressorId)) for (const id of war.defenders) against.add(id);
    if (war.defenders.includes(aggressorId)) for (const id of war.attackers) against.add(id);
  }
  against.delete(aggressorId);
  return against.size;
}

/**
 * Who joins a war against the aggressor at the moment it is declared.
 *
 * @returns {Array<{id: string, reason: 'treaty' | 'balance'}>}
 */
export function opposingCoalition(game, rng, aggressorId, victimId, mods = {}) {
  const joiners = [];
  const victimBlocs = (defOf(game, victimId)?.blocs) || [];
  const liveBlocs = game.blocMembership?.[victimId] || victimBlocs;

  for (const id of sovereignIds(game)) {
    if (id === aggressorId || id === victimId) continue;

    // A defence pact is still a defence pact — and now it is a real one: the
    // bilateral paper the victim actually signed, weighed by how serious it is
    // and how much of it either side believes.
    const bond = alliesOf(game, victimId).find((a) => a.id === id);
    if (bond) {
      const paper = treatyBetween(game, victimId, id);
      const credibility = (paper?.credibility ?? 60) / 100;
      const chance = clamp(
        0.45 + bond.weight * 0.08 + credibility * 0.3 + getRelation(game, id, victimId) / 500,
        0.1,
        0.95,
      );
      if (rng.bool(chance)) joiners.push({ id, reason: 'treaty', via: bond.via, kind: bond.kind });
      continue;
    }

    if (rng.bool(balancingChance(game, id, aggressorId, victimId, mods))) {
      joiners.push({ id, reason: 'balance' });
    }
  }
  return joiners;
}

/**
 * Between wars, the world contains rather than fights. Each quarter the most
 * alarmed countries cool toward the aggressor, and the alarmed-and-capable ones
 * hand the interface a reason for what they are about to do.
 *
 * @returns {Array<{id: string, against: string, threat: number}>}
 */
export function containment(game, rng, mods) {
  const acts = [];
  for (const { id: aggressorId, threat } of threats(game, 0.3)) {
    for (const id of sovereignIds(game)) {
      if (id === aggressorId) continue;
      const chance = balancingChance(game, id, aggressorId, aggressorId, mods) * 0.5;
      if (!rng.bool(Math.min(0.4, chance))) continue;

      adjustRelation(game, id, aggressorId, -Math.round(2 + threat * 6));
      acts.push({ id, against: aggressorId, threat });
    }
  }

  if (acts.length >= 4) {
    const worst = acts[0].against;
    game.worldTension = clamp(game.worldTension + 2, 0, 100);
    logEvent(game, {
      type: 'alignment',
      severity: 'major',
      text: t('coalition.containment',
        '{n} governments move to contain {nation} in the same week. None of them call it an alliance.',
        { n: acts.length, nation: tNation(defOf(game, worst)) }),
      nations: [worst, ...acts.slice(0, 4).map((a) => a.id)],
    });
  }
  return acts;
}

/** Who, if anyone, the world is currently organising against — for the UI. */
export function primaryThreat(game) {
  const list = threats(game, 0.3);
  if (!list.length) return null;
  const worst = list[0];
  return {
    ...worst,
    coalition: coalitionSize(game, worst.id),
    isPlayer: worst.id === game.playerId,
  };
}

/** Everyone whose relations put them on the other side of the aggressor. */
export function alignedAgainst(game, aggressorId) {
  return sovereignIds(game).filter(
    (id) => id !== aggressorId && getRelation(game, id, aggressorId) <= -35,
  );
}
