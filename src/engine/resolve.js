// Order resolution: turning a queued action into an outcome tier, then into
// world-state changes.

import { NATIONS_BY_ID } from '../data/nations.js';
import { ACTIONS_BY_ID, actionCost } from './actions.js';
import { applyEffect, describeChanges, scaleEffect } from './effects.js';
import { clamp, getRelation, logEvent } from './state.js';
import { annexOccupied, concludeWar, declareWar, findWar, pressWar } from './war.js';

/** The first war this country is fighting, for orders that need no target. */
function activeWarFor(game, id) {
  return game.wars.find((w) => w.active && (w.attackers.includes(id) || w.defenders.includes(id)));
}

export const OUTCOME_TIERS = {
  critical: { label: 'Decisive success', scale: 1.55, tone: 'great' },
  success: { label: 'Success', scale: 1, tone: 'good' },
  partial: { label: 'Partial success', scale: 0.4, tone: 'mixed' },
  failure: { label: 'Failure', scale: 1, tone: 'bad' },
  backfire: { label: 'Backfire', scale: 1, tone: 'awful' },
};

/** Success chance for an order, before the dice. Exposed so the UI can show it. */
export function successChance(game, action, actorId, targetId, mods) {
  const state = game.nations[actorId];
  if (!state) return 0;

  let chance = action.baseSuccess ?? 0.65;

  for (const [stat, weight] of action.skills || []) {
    const value = state[stat] ?? 50;
    chance += ((value - 50) / 50) * weight;
  }

  if (actorId === game.playerId) chance -= mods.successPenalty;

  if (targetId && game.nations[targetId]) {
    const relation = getRelation(game, actorId, targetId);
    const friendly = (action.effects?.success?.relation || 0) > 0;
    if (friendly) {
      chance += relation / 260;
      if (action.relationFloor !== undefined && relation < action.relationFloor) {
        chance -= (action.relationFloor - relation) / 120;
      }
    } else {
      // An order aimed at somebody else is a contest, and the gap in whatever
      // it actually turns on decides it. A country far ahead on the relevant
      // capability should not merely edge the roll — it should be expected to
      // win, and the interface should say so before you commit.
      chance += capabilityEdge(game, action, state, game.nations[targetId]);
      if (action.covert) {
        chance -= ((game.nations[targetId].tech - 50) / 50) * 0.16;
        chance -= ((game.nations[targetId].stability - 50) / 50) * 0.08;
      }
    }
  }

  // Domestic turmoil makes everything harder to execute.
  chance -= Math.max(0, (state.unrest - 55) / 100) * 0.25;
  chance -= Math.max(0, (45 - state.stability) / 100) * 0.3;

  return clamp(chance, 0.03, 0.97);
}

/**
 * How far ahead the actor is on the capability the order rests on, as a
 * probability adjustment. Saturating, so a tenfold lead is decisive without
 * making the number meaningless: ±0.34 at the extremes.
 */
function capabilityEdge(game, action, actor, target) {
  const skills = action.skills || [];
  if (!skills.length) return 0;

  let edge = 0;
  let weightSum = 0;
  for (const [stat, weight] of skills) {
    const mine = (actor[stat] ?? 50) + 6;
    const theirs = (target[stat] ?? 50) + 6;
    // Ratio, not difference: 90 against 30 is a rout; 90 against 80 is a nudge.
    edge += Math.log2(mine / theirs) * weight;
    weightSum += weight;
  }
  if (weightSum <= 0) return 0;

  const normalised = edge / weightSum;
  return Math.max(-0.34, Math.min(0.34, normalised * 0.42));
}

function tierFor(chance, roll, action) {
  const margin = chance - roll;
  if (margin > 0.32) return 'critical';
  if (margin > 0) return 'success';
  if (margin > -0.18) return 'partial';
  const canBackfire = action.risk === 'high' || (action.risk === 'medium' && margin < -0.42);
  if (canBackfire && margin < -0.36 && action.effects?.backfire) return 'backfire';
  return 'failure';
}

function effectForTier(action, tier) {
  const e = action.effects || {};
  switch (tier) {
    case 'critical':
      return scaleEffect(e.success, OUTCOME_TIERS.critical.scale);
    case 'success':
      return e.success || null;
    case 'partial':
      return scaleEffect(e.success, OUTCOME_TIERS.partial.scale);
    case 'backfire':
      return e.backfire || e.failure || null;
    default:
      return e.failure || null;
  }
}

/**
 * Resolve one order.
 * @returns {object} outcome record used by the briefing and by the narrator prompt
 */
export function resolveAction(game, rng, mods, order, actorId = game.playerId) {
  const action = order.custom ? order.custom : ACTIONS_BY_ID[order.actionId];
  if (!action) return null;
  const state = game.nations[actorId];
  const targetId = order.targetId || null;

  const cost = actionCost(action, state);
  state.treasury -= cost;
  if (actorId === game.playerId) {
    game.politicalCapital = Math.max(0, game.politicalCapital - (action.pc || 0));
    game.stats.actionsTaken += 1;
  }
  state.lastAction = action.id;

  const chance = successChance(game, action, actorId, targetId, mods);
  const roll = rng.next();
  const tier = tierFor(chance, roll, action);
  const succeeded = tier === 'critical' || tier === 'success' || tier === 'partial';

  const outcome = {
    actorId,
    actionId: action.id,
    actionName: action.name,
    category: action.category,
    targetId,
    tier,
    tierLabel: OUTCOME_TIERS[tier].label,
    tone: OUTCOME_TIERS[tier].tone,
    chance: Number(chance.toFixed(2)),
    cost,
    changes: [],
    notes: [],
    custom: Boolean(order.custom),
    text: '',
  };

  const effect = effectForTier(action, tier);
  if (effect) {
    const applied = applyEffect(game, actorId, targetId, effect, {
      // Background powers move the global mood far less than you do.
      tensionScale: actorId === game.playerId ? 1 : 0.3,
    });
    outcome.changes = applied.changes;
    outcome.notes = applied.notes;
  }

  // Structural side effects that are more than stat deltas.
  if (action.declaresWar && succeeded && targetId) {
    const war = declareWar(game, actorId, targetId, { rng, reason: 'declared intervention' });
    if (war && actorId === game.playerId) game.stats.warsStarted += 1;
    outcome.startedWar = Boolean(war);
  }

  if (action.seeksPeace && targetId) {
    const war = findWar(game, actorId, targetId);
    if (war && succeeded) {
      concludeWar(game, war, rng, 'negotiated');
      outcome.endedWar = true;
    } else if (war) {
      outcome.notes.push('The other side is not ready to talk.');
    }
  }

  if (action.formsPact && succeeded && targetId) {
    game.treaties.push({
      id: `pact-${game.turn}-${actorId}-${targetId}`,
      kind: 'defence',
      members: [actorId, targetId],
      signedTurn: game.turn,
    });
    outcome.notes.push('Mutual defence obligations now bind both parties.');
  }

  // War-room orders move the front itself, not just the national statistics.
  if (action.warCommand && succeeded) {
    const war = targetId ? findWar(game, actorId, targetId) : activeWarFor(game, actorId);
    if (war) {
      if (action.warCommand === 'annex') {
        const done = annexOccupied(game, war, actorId);
        outcome.ground = done;
        if (done) {
          outcome.notes.push(
            `${Math.round(done.area).toLocaleString()},000 km² is now sovereign territory, not occupied territory.`,
          );
        } else {
          outcome.notes.push('Your forces hold nothing to annex yet.');
        }
      }
      if (action.warCommand === 'press') {
        pressWar(game, war, actorId);
        outcome.notes.push('No negotiated end will be accepted this quarter.');
      }
    }
  }

  if (action.warEffect || action.warEffectOnFailure) {
    const war = targetId ? findWar(game, actorId, targetId) : activeWarFor(game, actorId);
    if (war) {
      const spec = succeeded ? action.warEffect : (action.warEffectOnFailure || null);
      if (spec) {
        const attacking = war.attackers.includes(actorId);
        const sign = attacking ? 1 : -1;
        const scale = tier === 'critical' ? 1.5 : tier === 'partial' ? 0.5 : 1;

        if (spec.warScore) {
          war.warScore = clamp(war.warScore + spec.warScore * sign * scale, -100, 100);
        }
        const ownSide = attacking ? 'attackers' : 'defenders';
        const enemySide = attacking ? 'defenders' : 'attackers';
        if (spec.ownExhaustion) {
          war.exhaustion[ownSide] = clamp(war.exhaustion[ownSide] + spec.ownExhaustion * scale, 0, 100);
        }
        if (spec.enemyExhaustion) {
          war.exhaustion[enemySide] = clamp(war.exhaustion[enemySide] + spec.enemyExhaustion * scale, 0, 100);
        }
        if (spec.casualties) war.casualties += Math.round(spec.casualties * scale);

        outcome.warId = war.id;
        outcome.notes.push(
          `${war.name}: front ${spec.warScore > 0 ? 'moved in your favour' : 'gave ground'} (${Math.round(war.warScore)} on the hundred-point scale).`,
        );
      }
    }
  }

  if (action.mediates && succeeded) {
    const active = game.wars.filter((w) => w.active);
    if (active.length) {
      const war = rng.pick(active);
      war.exhaustion.attackers = clamp(war.exhaustion.attackers + 12, 0, 100);
      war.exhaustion.defenders = clamp(war.exhaustion.defenders + 12, 0, 100);
      outcome.notes.push(`Pressure applied to both sides of the ${war.name}.`);
      if (actorId === game.playerId) game.stats.crisesResolved += 1;
    }
  }

  outcome.text = describeOutcome(game, outcome, action);

  if (actorId === game.playerId) {
    logEvent(game, {
      type: 'order',
      severity: tier === 'backfire' ? 'major' : 'info',
      text: outcome.text,
      nations: [actorId, targetId].filter(Boolean),
    });
  }

  return outcome;
}

function describeOutcome(game, outcome, action) {
  const actor = NATIONS_BY_ID[outcome.actorId].name;
  const target = outcome.targetId ? NATIONS_BY_ID[outcome.targetId].name : null;
  const deltas = describeChanges(outcome.changes);
  const head = target
    ? `${actor} → ${action.name} (${target}): ${outcome.tierLabel}.`
    : `${actor} → ${action.name}: ${outcome.tierLabel}.`;
  return deltas.length ? `${head} ${deltas.join(', ')}.` : head;
}

/** Apply a player's answer to a pending decision. */
export function resolveDecision(game, rng, mods, choiceId) {
  const decision = game.pendingDecision;
  if (!decision) return null;
  const choice = decision.choices.find((c) => c.id === choiceId) || decision.choices[0];
  const state = game.nations[game.playerId];

  if (choice.cost) {
    const amount = ((choice.cost.pctGdp || 0) / 100) * state.gdp * 1000 + (choice.cost.flat || 0);
    state.treasury -= amount;
  }

  const hasChance = typeof choice.chance === 'number';
  const succeeded = !hasChance || rng.next() < clamp(choice.chance - mods.successPenalty * 0.6, 0.05, 0.95);
  const effect = succeeded ? choice.effect : choice.failEffect || choice.effect;

  const applied = applyEffect(game, game.playerId, decision.targetId, effect);

  if (choice.escalates && !succeeded && decision.targetId) {
    declareWar(game, decision.targetId, game.playerId, { rng, reason: 'ultimatum rejected' });
  }

  const record = {
    type: 'decision',
    title: decision.title,
    choice: choice.label,
    succeeded,
    text: `${decision.title} — you chose to ${choice.label.toLowerCase()}. ${
      succeeded ? 'It worked.' : 'It did not go as intended.'
    } ${describeChanges(applied.changes).join(', ')}`,
    changes: applied.changes,
  };

  logEvent(game, { type: 'decision', severity: succeeded ? 'info' : 'major', text: record.text });
  game.pendingDecision = null;
  game.stats.crisesResolved += succeeded ? 1 : 0;
  return record;
}
