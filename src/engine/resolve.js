// Order resolution: turning a queued action into an outcome tier, then into
// world-state changes.

import { NATIONS_BY_ID } from '../data/nations.js';
import { ACTIONS_BY_ID, actionCost } from './actions.js';
import { applyEffect, describeChanges, scaleEffect } from './effects.js';
import { adjustRelation, clamp, defOf, getRelation, logEvent } from './state.js';
import { annexOccupied, concludeWar, declareWar, findWar, pressWar } from './war.js';
import { realign } from './statecraft.js';
import { chargeExit, noteAccession, open as openCommitment } from './commitments.js';
import { hardenAgainst } from './intel.js';
import { factionsOf } from './factions.js';
import { leverage, noteTradeBreak, restoreTies, severTies } from './dependency.js';
import { DEMANDS, send as sendDemand, settleCounter } from './exchanges.js';
import { blocCall } from './worldwar.js';
import { reach } from './reach.js';
import { canRally, rally, rallyAll, ralliableWars } from './rally.js';
import {
  TREATY_KINDS,
  abrogate as abrogateTreaty,
  invoke as invokeTreaties,
  renew as renewTreaty,
  sign as signTreaty,
  treatiesFor,
  treatyBetween,
} from './treaties.js';

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

  // Paper. `formsPact` names the kind of treaty an order signs; the module owns
  // the diplomatic wash, the term and what it is worth every quarter after.
  if (action.formsPact && succeeded && targetId) {
    const kindId = action.formsPact === true ? 'defence' : action.formsPact;
    const treaty = signTreaty(game, actorId, targetId, kindId, rng);
    if (treaty) {
      outcome.treaty = { id: treaty.id, kind: treaty.kind, expiresTurn: treaty.expiresTurn };
      outcome.notes.push(
        `${TREATY_KINDS[kindId].name}: ${treaty.expiresTurn - game.turn} quarters, renewable.`,
      );
    }
  }

  // Tearing paper up, and calling it in.
  if (action.abrogates && succeeded && targetId) {
    const existing = treatyBetween(game, actorId, targetId, action.abrogates === true ? null : action.abrogates);
    if (existing) {
      const done = abrogateTreaty(game, existing.id, actorId);
      outcome.abrogated = done.ok ? existing.kind : null;
    } else {
      outcome.notes.push('There was nothing to withdraw from.');
    }
  }
  // Keeping the paper alive, and making the room say out loud that it means it.
  if (action.renewsTreaties && succeeded) {
    const due = treatiesFor(game, actorId).filter((tr) => tr.expiresTurn - game.turn <= 6);
    for (const treaty of due) renewTreaty(game, treaty.id);
    outcome.renewed = due.length;
    outcome.notes.push(due.length
      ? `${due.length} treaty(ies) renewed.`
      : 'Nothing was close enough to expiry to be worth the trip.');
  }
  if (action.strengthensTreaties && succeeded) {
    let moved = 0;
    for (const treaty of treatiesFor(game, actorId)) {
      if (targetId && !treaty.members.includes(targetId)) continue;
      treaty.credibility = clamp(treaty.credibility + action.strengthensTreaties, 0, 100);
      moved += 1;
    }
    if (moved) outcome.notes.push(`${moved} commitment(s) are now believed rather than merely signed.`);
  }
  if (action.invokesTreaties && succeeded) {
    const war = targetId ? findWar(game, actorId, targetId) : activeWarFor(game, actorId);
    if (war) {
      const answer = invokeTreaties(game, war, actorId, rng);
      outcome.invocation = { joined: answer.joined.map((a) => a.id), refused: answer.refused.length };
      outcome.notes.push(answer.joined.length
        ? `${answer.joined.length} ally(ies) answered the call.`
        : 'Nobody answered.');
    } else {
      outcome.notes.push('There is no war to call anybody into.');
    }
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

  // Changing sides. The bloc paperwork is the small part; the diplomatic wash
  // that follows is handled by realign().
  if (action.alignment && succeeded) {
    const done = realign(game, actorId, action.alignment.blocId, action.alignment.join, rng);
    if (done) {
      outcome.realignment = done;
      // Accession starts a clock; walking out before it runs down is charged
      // for, in standing and in every relationship inside the bloc.
      if (actorId === game.playerId) {
        if (action.alignment.join) noteAccession(game, action.alignment.blocId);
        else outcome.exitCost = chargeExit(game, action.alignment.blocId);
      }
      outcome.notes.push(
        action.alignment.join
          ? `${NATIONS_BY_ID[actorId]?.name || actorId} is a member as of this quarter.`
          : 'The withdrawal takes effect immediately.',
      );
    } else {
      outcome.notes.push('The paperwork changed nothing — the position was already what it is.');
    }
  }

  // Commercial statecraft. What an embargo is worth is decided by the web, not
  // by a constant: the same order against a country that needs you and one that
  // does not are two different orders wearing the same name.
  if (action.trade && succeeded && (targetId || action.trade.buffer)) {
    const spec = action.trade;
    if (spec.sever && targetId) {
      const grip = leverage(game, actorId, targetId);
      const scale = tier === 'critical' ? 1 : tier === 'partial' ? 0.5 : 0.8;
      const result = severTies(game, actorId, targetId, spec.sever * scale, spec.turns || 8, {
        by: actorId, label: spec.label,
      });
      outcome.trade = { ...result, leverage: grip };
      if (actorId === game.playerId) noteTradeBreak(game, actorId, targetId, result, spec.label);
      outcome.notes.push(
        grip.verdict === 'yours'
          ? `The leverage runs your way: they lose ${(result[targetId === result.a.id ? 'a' : 'b'].exposure * 100).toFixed(1)}% of their economy's foreign leg, you lose ${(result[targetId === result.a.id ? 'b' : 'a'].exposure * 100).toFixed(1)}%.`
          : `It cuts both ways, and not in your favour — check who needs whom before the next one.`,
      );
      // A secondary sanction closes the target's other arrangements too.
      if (spec.spillover) {
        let hit = 0;
        for (const otherId of Object.keys(game.nations)) {
          if (otherId === actorId || otherId === targetId) continue;
          if (getRelation(game, actorId, otherId) < -20) continue;
          if (!rng.bool(0.3)) continue;
          severTies(game, otherId, targetId, 0.5, spec.turns || 6, { by: actorId, label: spec.label });
          hit += 1;
        }
        if (hit) outcome.notes.push(`${hit} third countries quietly stopped shipping as well.`);
      }
    }
    if (spec.restore && targetId) {
      restoreTies(game, actorId, targetId, spec.restore);
      outcome.notes.push('The arrangement is running again as of this quarter.');
    }
    if (spec.insulate && targetId) {
      // De-risking does not close the tie, it makes losing it cost less later.
      game.insulation = game.insulation || {};
      const key = [actorId, targetId].sort().join('|');
      game.insulation[key] = Math.min(0.8, (game.insulation[key] || 0) + spec.insulate);
      outcome.notes.push('What you buy from them is no longer what you cannot do without.');
    }
  }

  // Propositions put to another government, answered next quarter rather than
  // this one. The order only ever succeeds at being *sent*.
  if (action.demand && succeeded && targetId) {
    const entry = sendDemand(game, actorId, targetId, action.demand);
    if (entry) {
      outcome.demand = { id: action.demand, odds: entry.odds, dueTurn: entry.dueTurn };
      outcome.notes.push(
        `${DEMANDS[action.demand].name}: their answer arrives next quarter. Your people put it at about ${Math.round(entry.odds * 100)}%.`,
      );
    }
  }

  // Walking into a war that is already running — on either side.
  if (action.joinsWar && succeeded && targetId) {
    const war = game.wars.find(
      (w) => w.active && (w.attackers.includes(targetId) || w.defenders.includes(targetId))
        && !w.attackers.includes(actorId) && !w.defenders.includes(actorId),
    );
    if (war) {
      const theirSide = war.attackers.includes(targetId) ? 'attackers' : 'defenders';
      const mySide = action.joinsWar === 'with'
        ? theirSide
        : theirSide === 'attackers' ? 'defenders' : 'attackers';
      war[mySide].push(actorId);
      const enemies = mySide === 'attackers' ? war.defenders : war.attackers;
      for (const enemy of enemies) adjustRelation(game, actorId, enemy, -60);
      game.worldTension = clamp(game.worldTension + 10, 0, 100);
      if (actorId === game.playerId) game.stats.warsStarted += 1;
      outcome.warId = war.id;
      outcome.joinedWar = { warId: war.id, side: mySide, name: war.name };
      outcome.notes.push(
        `You are a belligerent in the ${war.name} as of this quarter, on the ${
          mySide === 'attackers' ? 'attacking' : 'defending'} side. Your reach into that theatre is about ${
          Math.round(reach(game, actorId, targetId) * 100)}% of what you could bring to your own border.`,
      );
    } else {
      outcome.notes.push('That war ended before the order left the building.');
    }
  }

  // Asking somebody who owes you nothing. The order succeeds at *making the
  // call*; whether the call is answered is decided by rally.js, in front of the
  // player, with every factor named.
  if (action.rally && succeeded) {
    const war = (targetId && canRally(game, targetId, actorId))
      || ralliableWars(game, actorId)[0];
    if (!war) {
      outcome.notes.push('There is no war to call anybody into.');
    } else if (action.rally === 'one' && targetId) {
      const answer = rally(game, actorId, targetId, war, rng);
      outcome.rally = answer;
      outcome.warId = war.id;
      outcome.notes.push(answer?.joined
        ? `${defOf(game, targetId)?.name || targetId} is a belligerent as of this quarter. You put it at about ${Math.round((answer.chance || 0) * 100)}%.`
        : `They declined. You put it at about ${Math.round((answer?.chance || 0) * 100)}%, and everybody watching now knows the answer.`);
    } else {
      const answer = rallyAll(game, actorId, war, rng);
      outcome.rally = answer;
      outcome.warId = war.id;
      outcome.notes.push(answer.joined.length
        ? `${answer.joined.length} of ${answer.joined.length + answer.refused.length} capitals answered.`
        : 'The appeal went out to every capital that would take the call and none of them took it further than a statement.');
    }
  }

  // The standing council, in session, with the clause read aloud.
  if (action.blocCall && succeeded) {
    const war = activeWarFor(game, actorId);
    if (war) {
      // A formal call re-opens organisations that had already declined once.
      war.blocAsked = {};
      const answered = blocCall(game, war, rng);
      const joined = answered.flatMap((entry) => entry.joined || []);
      outcome.blocCall = { joined };
      outcome.notes.push(joined.length
        ? `${joined.length} member(s) of your organisations are in the war as of this quarter.`
        : 'The council met, expressed concern, and adjourned.');
    } else {
      outcome.notes.push('There is no war to call anybody into.');
    }
  }

  // Everybody in one room, and nobody leaving until it is signed.
  if (action.generalArmistice && succeeded) {
    const active = game.wars.filter((w) => w.active);
    let ended = 0;
    for (const war of active) {
      // The bigger the war, the harder it is to stop in one session.
      const stubborn = 0.25 + Math.min(0.5, war.attackers.length + war.defenders.length) * 0.05;
      if (!rng.bool(1 - stubborn)) continue;
      concludeWar(game, war, rng, 'negotiated');
      ended += 1;
    }
    outcome.armistice = ended;
    if (actorId === game.playerId) game.stats.crisesResolved += ended;
    outcome.notes.push(ended
      ? `${ended} war(s) stop this quarter. Whether they stay stopped is next year's problem.`
      : 'Everybody came. Nobody signed.');
  }

  // Trading with both sides, escorting your own shipping, shooting at whoever
  // stops it.
  if (action.neutrality && succeeded) {
    const state2 = game.nations[actorId];
    if (state2) state2.neutralUntil = game.turn + 10;
    outcome.notes.push('Your neutrality is declared, armed, and now has to be respected by people who did not agree to it.');
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

  // Some programmes are a signature rather than a payment: they draw money
  // every quarter until they finish, and cost more to cancel than to complete.
  if (succeeded && actorId === game.playerId) {
    const commitment = openCommitment(game, action, cost);
    if (commitment) {
      outcome.commitment = { label: commitment.label, quarterly: commitment.quarterly, turns: commitment.turnsLeft };
      outcome.notes.push(
        `${commitment.label}: $${commitment.quarterly.toLocaleString()}B a quarter for ${commitment.turnsLeft} more quarters.`,
      );
    }
  }

  // Counter-intelligence work makes you harder for that country to read.
  if (succeeded && action.id === 'counter-intel' && targetId) {
    hardenAgainst(game, targetId, 0.3);
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

  const record = {};
  const hasChance = typeof choice.chance === 'number';
  const succeeded = !hasChance || rng.next() < clamp(choice.chance - mods.successPenalty * 0.6, 0.05, 0.95);
  const effect = succeeded ? choice.effect : choice.failEffect || choice.effect;

  const applied = applyEffect(game, game.playerId, decision.targetId, effect);

  // A decision is read by the four domestic creditors exactly as an order is —
  // which is the point of choices that are only hard because of who is watching.
  if (choice.factions) {
    const factions = factionsOf(game);
    for (const [id, delta] of Object.entries(choice.factions)) {
      if (!factions[id]) continue;
      factions[id].mood = clamp(factions[id].mood + delta * (succeeded ? 1 : 0.5));
    }
    record.factions = choice.factions;
  }

  // Some of them are decisions about a war, and move the front rather than the
  // national statistics.
  const warSpec = succeeded ? choice.warEffect : (choice.warEffectOnFailure || null);
  if (warSpec) {
    const war = activeWarFor(game, game.playerId);
    if (war) {
      const attacking = war.attackers.includes(game.playerId);
      const sign = attacking ? 1 : -1;
      const ownSide = attacking ? 'attackers' : 'defenders';
      const enemySide = attacking ? 'defenders' : 'attackers';
      if (warSpec.warScore) war.warScore = clamp(war.warScore + warSpec.warScore * sign, -100, 100);
      if (warSpec.ownExhaustion) {
        war.exhaustion[ownSide] = clamp(war.exhaustion[ownSide] + warSpec.ownExhaustion, 0, 100);
      }
      if (warSpec.enemyExhaustion) {
        war.exhaustion[enemySide] = clamp(war.exhaustion[enemySide] + warSpec.enemyExhaustion, 0, 100);
      }
      if (warSpec.casualties) war.casualties += Math.round(warSpec.casualties);
      record.warId = war.id;
    }
  }

  // And some of them end one.
  if (choice.seeksPeace && succeeded) {
    const war = activeWarFor(game, game.playerId);
    if (war) {
      concludeWar(game, war, rng, 'negotiated');
      record.endedWar = true;
    }
  }

  if (choice.escalates && !succeeded && decision.targetId) {
    declareWar(game, decision.targetId, game.playerId, { rng, reason: 'ultimatum rejected' });
  }

  // A counter-offer is the second half of an exchange: they answered, you have
  // now answered them, and the proposition finally settles.
  if (choice.settles && decision.exchangeId) {
    const settled = settleCounter(game, decision.exchangeId, choice.settles, succeeded, rng);
    if (settled) {
      record.exchange = settled;
      record.exchangeText = settled.text;
    }
  }

  Object.assign(record, {
    type: 'decision',
    title: decision.title,
    choice: choice.label,
    succeeded,
    text: `${decision.title} — you chose to ${choice.label.toLowerCase()}. ${
      succeeded ? 'It worked.' : 'It did not go as intended.'
    } ${describeChanges(applied.changes).join(', ')}`,
    changes: applied.changes,
  });

  logEvent(game, { type: 'decision', severity: succeeded ? 'info' : 'major', text: record.text });
  game.pendingDecision = null;
  game.stats.crisesResolved += succeeded ? 1 : 0;
  return record;
}
