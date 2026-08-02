// How the other ~55 countries decide what to do with their quarter.
//
// This is deliberately not an LLM call: it runs for every nation every turn and
// has to be cheap, deterministic and replayable. The language model's job is to
// narrate what happens here, not to compute it.

import { DOCTRINES, NATIONS_BY_ID } from '../data/nations.js';
import { ACTIONS, actionCost } from './actions.js';
import { resolveAction } from './resolve.js';
import {
  combatPower,
  getRelation,
  livePower,
  proximity,
  sovereignIds,
  sovereignStates,
} from './state.js';
import { declareWar, findWar } from './war.js';
import { alignedAgainst, threatOf } from './coalitions.js';
import { rivalryWarBias, targetingBias } from './nemesis.js';

const CATEGORY_TO_DOCTRINE_KEY = {
  economy: 'econ',
  military: 'mil',
  diplomacy: 'dip',
  domestic: 'dom',
  intelligence: 'covert',
  technology: 'econ',
};

/** Nations that get a full decision this turn: the powers, plus anyone involved. */
export function activeAgents(game, limit = 16) {
  const ranked = sovereignStates(game)
    .map((state) => ({ id: state.id, power: livePower(game, state.id) }))
    .sort((a, b) => b.power - a.power);

  const ids = new Set(ranked.slice(0, limit).map((n) => n.id));

  for (const war of game.wars) {
    if (!war.active) continue;
    for (const id of [...war.attackers, ...war.defenders]) ids.add(id);
  }
  for (const other of sovereignIds(game)) {
    const rel = getRelation(game, game.playerId, other);
    if (other !== game.playerId && (rel < -45 || rel > 65)) ids.add(other);
  }
  ids.delete(game.playerId);
  return [...ids];
}

/** Situational multipliers: what does this country actually need right now? */
function needMultiplier(game, state, category) {
  const def = NATIONS_BY_ID[state.id];
  const atWar = game.wars.some(
    (w) => w.active && (w.attackers.includes(state.id) || w.defenders.includes(state.id)),
  );

  switch (category) {
    case 'domestic':
      return 0.5 + Math.max(0, state.unrest - 30) / 25 + Math.max(0, 55 - state.stability) / 25;
    case 'military':
      return (atWar ? 2.4 : 0.7) + Math.max(0, 60 - state.readiness) / 60 + game.worldTension / 90;
    case 'economy':
      return 0.9 + Math.max(0, 55 - state.tech) / 90 + (state.treasury < state.gdp * 60 ? 0.5 : 0);
    case 'technology':
      return 0.6 + state.tech / 130 + (def.tags.includes('semiconductors') ? 0.3 : 0);
    case 'diplomacy':
      return 0.8 + state.influence / 120;
    case 'intelligence':
      return 0.5 + game.worldTension / 110;
    default:
      return 1;
  }
}

/** Pick the country this order should point at, if it needs one. */
function chooseTarget(game, rng, actorId, action) {
  const others = sovereignIds(game).filter((id) => id !== actorId);
  if (!others.length) return null;
  const actorDef = NATIONS_BY_ID[actorId];
  const friendly = (action.effects?.success?.relation || 0) > 0;

  const scored = others.map((id) => {
    const rel = getRelation(game, actorId, id);
    const near = proximity(actorDef, NATIONS_BY_ID[id]);
    const base = friendly
      ? Math.max(0.05, (rel + 100) / 90 + near)
      : Math.max(0.05, (-rel + 20) / 40 + near * 0.8 + livePower(game, id) / 90);
    // A country that has made you its central problem spends its quarters on
    // you rather than on whoever happened to score highest this turn.
    const weight = friendly ? base : base * targetingBias(game, actorId, id);
    return { id, weight };
  });

  if (action.requiresWar) {
    const atWar = scored.filter((s) => findWar(game, actorId, s.id));
    if (!atWar.length) return null;
    return rng.weighted(atWar, (s) => s.weight)?.id ?? null;
  }

  return rng.weighted(scored, (s) => s.weight)?.id ?? null;
}

function candidateActions(game, state, mods) {
  return ACTIONS.filter((action) => {
    if (action.declaresWar) return false; // handled separately
    // Background powers change sides through driftAlignments, which weighs the
    // whole bloc; the accede/withdraw orders are written for the player's desk.
    if (action.alignment) return false;
    if (action.id === 'nuclear-programme') return state.tech > 65 && state.nukes === 0 && mods.aiAggression > 1.1;
    if (action.id === 'mandate') return false; // player-only flavour
    return actionCost(action, state) <= state.treasury;
  });
}

/** Should this nation start a war this turn? */
function considerWar(game, rng, mods, actorId) {
  const state = game.nations[actorId];
  const def = NATIONS_BY_ID[actorId];
  const doctrine = DOCTRINES[state.doctrine] || DOCTRINES.balancer;

  const alreadyFighting = game.wars.some(
    (w) => w.active && (w.attackers.includes(actorId) || w.defenders.includes(actorId)),
  );
  if (alreadyFighting) return null;
  if (state.stability < 35 || state.treasury < state.gdp * 20) return null;

  const targets = sovereignIds(game)
    .filter((id) => id !== actorId)
    .map((id) => ({
      id,
      relation: getRelation(game, actorId, id),
      near: proximity(def, NATIONS_BY_ID[id]),
      ratio: combatPower(game, actorId) / Math.max(1, combatPower(game, id)),
    }))
    .filter((t) => t.relation < -55 && t.near > 0.35 && t.ratio > 1.15)
    // In a Stable World nobody springs a war on the player out of nowhere.
    .filter((t) => !(mods.shieldPlayer && t.id === game.playerId));

  if (!targets.length) return null;

  const target = rng.weighted(targets, (t) => (t.ratio - 1) * 2 + (-t.relation - 55) / 30 + t.near);
  if (!target) return null;

  const nuclearDeterrent = game.nations[target.id].nukes > 0 && state.nukes === 0 ? 0.15 : 1;
  const chance =
    0.0075 *
    doctrine.aggression *
    (target.id === game.playerId ? rivalryWarBias(game, actorId) : 1) *
    mods.aiAggression *
    (1 + game.worldTension / 90) *
    Math.min(2.2, target.ratio) *
    nuclearDeterrent;

  if (!rng.bool(chance)) return null;
  return declareWar(game, actorId, target.id, {
    rng, mods, reason: 'territorial and security claims',
  });
}

/**
 * The country this one is most alarmed by, if it is alarmed enough to act.
 * Only a genuine threat qualifies, so most countries most of the time have
 * nobody here and go about their own business.
 */
function mostThreatening(game, actorId) {
  let worst = null;
  let worstScore = 0.34;
  for (const other of alignedAgainst(game, actorId)) {
    const score = threatOf(game, other);
    if (score > worstScore) {
      worstScore = score;
      worst = other;
    }
  }
  return worst;
}

/**
 * Run every AI nation's turn.
 * @returns {Array<object>} outcome records (only the notable ones are surfaced)
 */
export function runOpponents(game, rng, mods) {
  const outcomes = [];
  const agents = activeAgents(game);

  // At higher difficulty, rivals of a leading player deliberately gang up.
  const playerPower = livePower(game, game.playerId);
  const leading =
    playerPower >= Math.max(...sovereignIds(game).map((id) => livePower(game, id))) - 2;
  const coordinating =
    leading && rng.bool(mods.rivalCoordination)
      ? agents.filter((id) => getRelation(game, game.playerId, id) < -20)
      : [];

  // Independently of difficulty: whoever the world currently finds dangerous
  // gets aimed at. This is what makes an aggressive run feel like the board
  // turning, rather than like the difficulty slider being nudged.
  const containing = new Map();
  for (const id of agents) {
    const worst = mostThreatening(game, id);
    if (worst) containing.set(id, worst);
  }

  for (const id of rng.shuffle(agents)) {
    const state = game.nations[id];
    if (!state) continue;

    const war = considerWar(game, rng, mods, id);
    if (war) {
      outcomes.push({
        actorId: id,
        actionId: 'declare-war',
        actionName: 'Declaration of war',
        tier: 'success',
        tone: 'awful',
        targetId: war.defenders[0],
        text: `${NATIONS_BY_ID[id].name} declares war on ${NATIONS_BY_ID[war.defenders[0]].name}.`,
        changes: [],
        notes: [],
        major: true,
      });
      continue;
    }

    const doctrine = DOCTRINES[state.doctrine] || DOCTRINES.balancer;
    const pool = candidateActions(game, state, mods);
    if (!pool.length) continue;

    const forcedTarget = coordinating.includes(id)
      ? game.playerId
      : (containing.get(id) ?? null);

    const action = rng.weighted(pool, (a) => {
      const doctrineWeight = doctrine[CATEGORY_TO_DOCTRINE_KEY[a.category]] ?? 1;
      const need = needMultiplier(game, state, a.category);
      const hostileBonus =
        forcedTarget && (a.covert || a.id === 'sanctions' || a.id === 'forward-deploy') ? 2.6 : 1;
      return doctrineWeight * need * hostileBonus * rng.float(0.65, 1.35);
    });
    if (!action) continue;

    let targetId = null;
    if (action.target === 'nation') {
      targetId = forcedTarget && !((action.effects?.success?.relation || 0) > 0)
        ? forcedTarget
        : chooseTarget(game, rng, id, action);
      if (!targetId) continue;
    }

    const outcome = resolveAction(game, rng, mods, { actionId: action.id, targetId }, id);
    if (!outcome) continue;

    // Only surface things the player would plausibly read about.
    outcome.major =
      targetId === game.playerId ||
      outcome.tier === 'backfire' ||
      outcome.tier === 'critical' ||
      livePower(game, id) > 70;
    outcomes.push(outcome);
  }

  return outcomes;
}
