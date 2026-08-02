// The brief you are graded on, and how history rewrites it.
//
// A mandate fixed on day one is a checklist: you know in quarter two whether
// quarter forty will go well. This one is reviewed every two years. Objectives
// that have been comfortably met retire with credit; objectives the world has
// made irrelevant are struck; and whatever has actually happened since the last
// review writes new ones. "Grow the economy" survives a quiet decade and does
// not survive a war on your border.
//
// Everything here is plain data — metric plus target, evaluated by a switch —
// because the mandate is serialised into the save and functions are not.

import { powerRank } from '../data/nations.js';
import { areaOf, startingAreaOf } from './territory.js';
import { threatOf } from './coalitions.js';
import { nemesisOf } from './nemesis.js';
import {
  activeWarsFor,
  blocsOf,
  clamp,
  defOf,
  getRelation,
  isSovereign,
  logEvent,
  sovereignIds,
} from './state.js';
import { t, tNation } from '../i18n/index.js';

/** How often the brief is rewritten, in quarters. */
export const REVIEW_EVERY = 8;

// ── Evaluation ──────────────────────────────────────────────────────────────

/**
 * Whether one objective is currently met.
 *
 * `ctx` carries the derived figures the scorer already computed, so this does
 * not recompute GDP growth once per objective.
 */
export function meets(game, objective, ctx) {
  const player = game.nations[game.playerId];
  const wars = activeWarsFor(game, game.playerId);

  switch (objective.metric) {
    case 'gdpGrowth': return ctx.gdpGrowth >= objective.target;
    case 'stabilityFloor': return player.stability >= objective.target;
    case 'influenceGain': return ctx.influenceGain > objective.target;
    case 'tensionCeiling': return game.worldTension < objective.target && !wars.length;
    case 'warOutcome': return !wars.length && game.stats.nukesUsed === 0;

    // Written by history rather than by the founding brief.
    case 'solvency': return player.treasury >= objective.target;
    case 'unrestCeiling': return player.unrest <= objective.target;
    case 'approvalFloor': return player.approval >= objective.target;
    case 'techFloor': return player.tech >= objective.target;
    case 'readinessFloor': return player.readiness >= objective.target;
    case 'holdBorders': return areaOf(game, game.playerId) >= startingAreaOf(game, game.playerId) * objective.target;
    case 'endWar': return !wars.length;
    case 'winWar': return !wars.length && ctx.warsWon > (objective.baseline ?? 0);
    case 'threatCeiling': return threatOf(game, game.playerId) <= objective.target;
    case 'noNukes': return game.stats.nukesUsed === 0;
    case 'blocMember': return blocsOf(game, game.playerId).includes(objective.blocId);
    case 'outlastRival':
      return !objective.rivalId
        || !isSovereign(game, objective.rivalId)
        || getRelation(game, game.playerId, objective.rivalId) >= objective.target;
    case 'shelter':
      return (objective.wards || []).every(
        (id) => !game.nations[id] || isSovereign(game, id),
      );
    default: return false;
  }
}

// ── The founding brief ──────────────────────────────────────────────────────

export function foundingMandate(def) {
  const objectives = [
    {
      id: 'prosperity',
      title: 'Grow the economy',
      detail: `Finish with ${def.name}'s GDP at least 8% above its starting level.`,
      metric: 'gdpGrowth',
      target: 0.08,
      origin: 'founding',
      since: 0,
    },
    {
      id: 'stability',
      title: 'Hold the country together',
      detail: 'Never let stability fall below 30, and finish above 55.',
      metric: 'stabilityFloor',
      target: 55,
      origin: 'founding',
      since: 0,
    },
    {
      id: 'standing',
      title: 'Raise your standing',
      detail: 'Finish with higher global influence than you started with.',
      metric: 'influenceGain',
      target: 0,
      origin: 'founding',
      since: 0,
    },
  ];

  // Only the genuine great powers are graded on keeping the system stable;
  // everyone else is graded on surviving it. (Power ranks run ~58-180.)
  if (powerRank(def) >= 124) {
    objectives.push({
      id: 'order',
      title: 'Keep the peace you profit from',
      detail: 'End the run with world tension below 60 and no great-power war ongoing.',
      metric: 'tensionCeiling',
      target: 60,
      origin: 'founding',
      since: 0,
    });
  } else {
    objectives.push({
      id: 'survival',
      title: 'Survive the great-power squeeze',
      detail: 'Avoid being drawn into a war you did not start, or win it if you are.',
      metric: 'warOutcome',
      target: 0,
      origin: 'founding',
      since: 0,
    });
  }
  return objectives;
}

// ── What history demands ────────────────────────────────────────────────────

/**
 * Candidate objectives the last two years could have written, each with the
 * condition that puts it on the table and how loudly it is shouting.
 *
 * Written as a table rather than as branches so the whole set can be read at
 * once and so a new one is four lines.
 */
const HISTORY = [
  {
    id: 'end-the-war',
    urgency: 10,
    when: (g) => activeWarsFor(g, g.playerId).length > 0,
    build: (g) => ({
      title: 'End the war',
      detail: 'Finish it. However the country got here, it cannot be here when your term ends.',
      metric: 'endWar', target: 0,
    }),
  },
  {
    id: 'hold-the-line',
    urgency: 9,
    when: (g) => areaOf(g, g.playerId) < startingAreaOf(g, g.playerId) * 0.97,
    build: (g) => ({
      title: 'Get the ground back',
      detail: 'The map moved against you. Finish with at least the territory you were handed.',
      metric: 'holdBorders', target: 1,
    }),
  },
  {
    id: 'settle-the-question',
    urgency: 8,
    when: (g) => Boolean(nemesisOf(g)),
    build: (g) => {
      const rival = nemesisOf(g);
      return {
        title: `Settle the question of ${tNation(defOf(g, rival.id))}`,
        detail: 'One relationship now defines the government. End your term with it no worse than cool, or with them no longer a problem.',
        metric: 'outlastRival', target: -30, rivalId: rival.id,
      };
    },
  },
  {
    id: 'get-solvent',
    urgency: 8,
    when: (g) => g.nations[g.playerId].treasury < 0,
    build: () => ({
      title: 'Get the books straight',
      detail: 'The state is borrowing to stand still. Finish in the black.',
      metric: 'solvency', target: 0,
    }),
  },
  {
    id: 'quiet-the-streets',
    urgency: 7,
    when: (g) => g.nations[g.playerId].unrest > 55,
    build: () => ({
      title: 'Quiet the streets',
      detail: 'Unrest has become the government’s main opponent. Bring it under 40.',
      metric: 'unrestCeiling', target: 40,
    }),
  },
  {
    id: 'stop-being-feared',
    urgency: 7,
    when: (g) => threatOf(g, g.playerId) > 0.42,
    build: () => ({
      title: 'Stop being the problem',
      detail: 'Other governments have begun to organise around you. Bring the world’s reading of you back down.',
      metric: 'threatCeiling', target: 0.3,
    }),
  },
  {
    id: 'shelter-the-neighbours',
    urgency: 6,
    when: (g) => neighbourhoodAtWar(g).length > 0,
    build: (g) => ({
      title: 'Keep the neighbourhood standing',
      detail: 'A war next door is a war half a step away. See that the states between you and it are still there.',
      metric: 'shelter', target: 0, wards: neighbourhoodAtWar(g).slice(0, 3),
    }),
  },
  {
    id: 'rebuild',
    urgency: 6,
    when: (g) => recentLog(g, ['event'], 8).some((e) => /disaster|epidemic|earthquake|flood|outbreak/i.test(e.text)),
    build: () => ({
      title: 'Put the country back on its feet',
      detail: 'What happened is over. What it did is not. Finish with approval above 55.',
      metric: 'approvalFloor', target: 55,
    }),
  },
  {
    id: 'never-again',
    urgency: 9,
    when: (g) => g.stats.nukesUsed > 0 || recentLog(g, ['nuclear'], 16).length > 0,
    build: () => ({
      title: 'Never again',
      detail: 'A weapon was used. Your government is now judged on there not being a second.',
      metric: 'noNukes', target: 0,
    }),
  },
  {
    id: 'catch-up',
    urgency: 4,
    when: (g) => g.nations[g.playerId].tech < 55,
    build: () => ({
      title: 'Close the technology gap',
      detail: 'You are being out-built. Get technology above 65 before it becomes permanent.',
      metric: 'techFloor', target: 65,
    }),
  },
  {
    id: 'rearm',
    urgency: 5,
    when: (g) => g.nations[g.playerId].readiness < 50 && g.worldTension > 55,
    build: () => ({
      title: 'Make the army usable',
      detail: 'A tense world and a hollow force is a decision waiting to be taken for you. Readiness above 70.',
      metric: 'readinessFloor', target: 70,
    }),
  },
];

function neighbourhoodAtWar(game) {
  return sovereignIds(game).filter((id) => {
    if (id === game.playerId) return false;
    const def = defOf(game, id);
    const you = defOf(game, game.playerId);
    if (!def || !you || def.region !== you.region) return false;
    return game.wars.some((w) => w.active && (w.attackers.includes(id) || w.defenders.includes(id)));
  });
}

function recentLog(game, types, within) {
  const wanted = new Set(types);
  return (game.log || []).filter((e) => wanted.has(e.type) && game.turn - e.turn <= within);
}

// ── The review ──────────────────────────────────────────────────────────────

export function nextReviewTurn(game) {
  const last = game.mandateReviewedAt ?? 0;
  return last + REVIEW_EVERY;
}

export function reviewDue(game) {
  return game.turn >= nextReviewTurn(game) && game.turn < game.totalTurns;
}

/**
 * Rewrite the brief from what has happened.
 *
 * Objectives are never silently swapped: everything that changes is returned
 * and logged, because being graded on a moving target is only fair if you are
 * told the moment it moves.
 *
 * @returns {{added: Array, retired: Array, kept: number} | null}
 */
export function reviewMandate(game, rng, ctx) {
  if (!game.objectives) return null;
  const added = [];
  const retired = [];

  // 1. Anything already banked is banked. A founding objective comfortably met
  //    for two years becomes an achievement rather than a standing demand.
  for (const objective of game.objectives) {
    if (objective.retired) continue;
    const met = meets(game, objective, ctx);
    if (met && objective.origin === 'founding' && game.turn - objective.since >= REVIEW_EVERY) {
      objective.banked = true;
    } else {
      objective.banked = false;
    }
  }

  // 2. History-written objectives whose situation has passed are struck, met or
  //    not — they were about a moment, and the moment is over.
  for (const objective of game.objectives) {
    if (objective.retired || objective.origin !== 'history') continue;
    const spec = HISTORY.find((h) => h.id === objective.id);
    const stillLive = spec ? spec.when(game) : false;
    const met = meets(game, objective, ctx);
    if (met || !stillLive) {
      objective.retired = true;
      objective.retiredTurn = game.turn;
      objective.met = met;
      retired.push(objective);
    }
  }

  // 3. And whatever the last two years demand goes on the desk. Never more than
  //    two at once, or the brief stops being a brief.
  const live = game.objectives.filter((o) => !o.retired);
  const room = Math.max(0, 6 - live.length);
  const candidates = HISTORY
    .filter((spec) => spec.when(game))
    .filter((spec) => !live.some((o) => o.id === spec.id))
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, Math.min(2, room));

  for (const spec of candidates) {
    const objective = {
      id: spec.id,
      ...spec.build(game, rng),
      origin: 'history',
      since: game.turn,
      urgency: spec.urgency,
    };
    game.objectives.push(objective);
    added.push(objective);
  }

  game.mandateReviewedAt = game.turn;
  game.mandateReviews = (game.mandateReviews || 0) + 1;

  if (added.length || retired.length) {
    logEvent(game, {
      type: 'mandate',
      severity: 'major',
      text: added.length
        ? t('mandate.rewritten',
            'The mandate is reviewed. {n} new demand(s) are added to what your government is judged on.',
            { n: added.length })
        : t('mandate.narrowed', 'The mandate is reviewed. What the last two years were about is no longer what this term is about.'),
      nations: [game.playerId],
    });
  }

  return { added, retired, kept: game.objectives.filter((o) => !o.retired).length };
}

/** The live brief, for the interface and the scorer. */
export function liveObjectives(game) {
  return (game.objectives || []).filter((o) => !o.retired);
}

/** Everything struck or banked, for the closing page. */
export function mandateHistory(game) {
  return (game.objectives || []).filter((o) => o.retired || o.banked);
}

/**
 * A fresh brief for a successor term: the founding objectives again, plus
 * whatever the outgoing term left unfinished and unbanked.
 */
export function mandateForNewTerm(game, def) {
  const carried = liveObjectives(game)
    .filter((o) => o.origin === 'history' && !o.banked)
    .map((o) => ({ ...o, since: game.turn, inherited: true }));
  const founding = foundingMandate(def).map((o) => ({ ...o, since: game.turn }));
  return [...founding, ...carried.slice(0, 2)];
}

/** How far through the current review period the term is. */
export function reviewProgress(game) {
  const last = game.mandateReviewedAt ?? 0;
  return clamp((game.turn - last) / REVIEW_EVERY, 0, 1);
}
