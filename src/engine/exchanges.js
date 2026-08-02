// Things you say to another government, and what it says back.
//
// Every order in the catalogue was a one-way verb. You sanctioned somebody, you
// signed something with them, you sent an aid package — and the world answered
// in statistics. Nothing you did was ever *addressed* to a government that then
// had to decide what to do about it.
//
// An exchange is the other shape. You put a proposition to a named country with
// terms attached; it lands on their desk; and next quarter they accept, refuse,
// or come back with a counter-offer that lands on *yours* as a decision. The
// answer is computed from things the player can see and move: how much they
// like you, how much they need you commercially, how badly they would lose a
// war with you, who is standing behind them, and what you are actually asking
// for. A demand that would cost them their alignment is refused by a country
// with friends and accepted by one without.
//
// Refusals are not free for either party. An ultimatum you make and then do
// nothing about costs you credibility with everybody watching, which is most of
// the point of not making one.

import { t, tNation } from '../i18n/index.js';
import {
  addModifier,
  adjustRelation,
  blocsOf,
  clamp,
  combatPower,
  defOf,
  getRelation,
  isSovereign,
  livePower,
  logEvent,
} from './state.js';
import { exposure, leverage, severTies } from './dependency.js';
import { alliesOf } from './treaties.js';
import { reach } from './reach.js';
import { recordGrievance } from './nemesis.js';

/**
 * The propositions you can put to another government.
 *
 * `pressure` is how much they have to swallow, 0–1: a request for a port call
 * is nothing, a demand that they leave their alliance is nearly everything.
 * `hostile` marks the ones that are threats rather than offers, which changes
 * who else in the world takes note.
 */
export const DEMANDS = {
  'open-markets': {
    id: 'open-markets', name: 'Demand Market Access', pressure: 0.3, hostile: false,
    ask: 'tariff-free access to their market for your exporters',
    accepted: { relation: 6, modifier: { label: 'Preferential access', turns: 10, growth: 0.24 } },
    refused: { relation: -8 },
  },
  'transit-rights': {
    id: 'transit-rights', name: 'Demand Transit and Overflight', pressure: 0.45, hostile: false,
    ask: 'transit for your forces and overflight for your aircraft',
    accepted: { relation: 4, self: { readiness: 4 }, grantsAccess: true },
    refused: { relation: -10 },
  },
  'leave-bloc': {
    id: 'leave-bloc', name: 'Demand They Leave Their Bloc', pressure: 0.92, hostile: true,
    ask: 'that they withdraw from the organisation they are in',
    accepted: { relation: 14, self: { influence: 6 }, breaksBloc: true },
    refused: { relation: -22, worldTension: 6 },
  },
  'cut-third-party': {
    id: 'cut-third-party', name: 'Demand They Cut Off Your Rival', pressure: 0.7, hostile: true,
    ask: 'that they stop trading with the country you are in conflict with',
    accepted: { relation: 8, cutsThirdParty: true },
    refused: { relation: -14, worldTension: 4 },
  },
  reparations: {
    id: 'reparations', name: 'Demand Reparations', pressure: 0.75, hostile: true,
    ask: 'compensation for what they have already done',
    accepted: { relation: -4, tribute: 0.035 },
    refused: { relation: -18, worldTension: 5 },
  },
  'border-adjustment': {
    id: 'border-adjustment', name: 'Demand a Border Adjustment', pressure: 0.95, hostile: true,
    ask: 'a district on your side of the line, formally ceded',
    accepted: { relation: -8, land: 0.06, worldTension: 8 },
    refused: { relation: -26, worldTension: 10, escalates: true },
  },
  'release-hold': {
    id: 'release-hold', name: 'Demand They Vacate Occupied Ground', pressure: 0.85, hostile: true,
    ask: 'that they withdraw from the territory they are sitting on',
    accepted: { relation: 10, vacates: true, worldTension: -6 },
    refused: { relation: -20, worldTension: 6 },
  },
  'join-us': {
    id: 'join-us', name: 'Invite Them Into Your Camp', pressure: 0.55, hostile: false,
    ask: 'that they align with you formally and publicly',
    accepted: { relation: 22, self: { influence: 5 }, joinsBloc: true },
    refused: { relation: -6 },
  },
  'buy-land': {
    id: 'buy-land', name: 'Offer to Buy Territory', pressure: 0.6, hostile: false,
    ask: 'a stretch of their territory, at a price nobody will call generous',
    accepted: { relation: 4, land: 0.05, pays: 0.06 },
    refused: { relation: -4 },
  },
  'stand-down': {
    id: 'stand-down', name: 'Demand They Stand Down', pressure: 0.65, hostile: true,
    ask: 'that they pull their forces back from your frontier',
    accepted: { relation: 12, target: { readiness: -8 }, worldTension: -5 },
    refused: { relation: -16, worldTension: 6, escalates: true },
  },
  'guarantee-them': {
    id: 'guarantee-them', name: 'Offer Them a Guarantee', pressure: 0.2, hostile: false,
    ask: 'that they accept your protection, with everything that implies',
    accepted: { relation: 26, self: { influence: 4 }, guarantees: true },
    refused: { relation: -4, self: { influence: -3 } },
  },
  'hand-over': {
    id: 'hand-over', name: 'Demand They Hand Them Over', pressure: 0.5, hostile: true,
    ask: 'the people they are sheltering from you',
    accepted: { relation: -6, self: { approval: 7, stability: 3 } },
    refused: { relation: -14 },
  },
};

export const DEMAND_LIST = Object.values(DEMANDS);

function pending(game) {
  if (!game.exchanges) game.exchanges = [];
  return game.exchanges;
}

/**
 * How likely they are to say yes, and what is driving it.
 *
 * Shown on the order card before you commit, because a demand whose odds you
 * cannot see is a coin toss with extra steps.
 *
 * @returns {{chance: number, factors: Array<{label: string, value: number}>}}
 */
export function odds(game, actorId, targetId, demandId) {
  const demand = DEMANDS[demandId];
  if (!demand) return { chance: 0, factors: [] };

  const relation = getRelation(game, actorId, targetId);
  const force = combatPower(game, actorId) * reach(game, actorId, targetId);
  const theirForce = Math.max(1, combatPower(game, targetId));
  // Coercion only works if you could actually carry out the threat behind it.
  const menace = Math.min(1.4, Math.log2(Math.max(0.25, force / theirForce)) * 0.3);
  // And commerce is the other lever: somebody who needs your market listens.
  const grip = exposure(game, targetId, actorId) - exposure(game, actorId, targetId);
  // Somebody with friends says no more often than somebody without.
  const backing = alliesOf(game, targetId)
    .filter((ally) => ally.id !== actorId && isSovereign(game, ally.id))
    .reduce((sum, ally) => sum + ally.weight * 0.05, 0);
  const standing = livePower(game, targetId) / Math.max(1, livePower(game, actorId));

  const factors = [
    { label: 'how they feel about you', value: relation / 260 },
    { label: 'what you are asking for', value: -demand.pressure * 0.72 },
    { label: 'what you could do about a refusal', value: demand.hostile ? menace * 0.5 : menace * 0.18 },
    { label: 'how much they need your market', value: grip * 1.5 },
    { label: 'who is standing behind them', value: -Math.min(0.3, backing) },
    { label: 'how big they are next to you', value: -Math.min(0.28, Math.log2(Math.max(0.3, standing)) * 0.18) },
  ];

  const chance = clamp(0.52 + factors.reduce((sum, f) => sum + f.value, 0), 0.02, 0.96);
  return {
    chance: Number(chance.toFixed(2)),
    factors: factors
      .filter((f) => Math.abs(f.value) >= 0.02)
      .map((f) => ({ ...f, value: Number(f.value.toFixed(2)) }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
  };
}

/**
 * Send it. The answer comes back next quarter, not this one — which is the
 * point of an exchange rather than an order.
 */
export function send(game, actorId, targetId, demandId, { deadline = 1 } = {}) {
  const demand = DEMANDS[demandId];
  if (!demand || !isSovereign(game, targetId)) return null;
  const existing = pending(game).find(
    (x) => x.from === actorId && x.to === targetId && x.demandId === demandId && x.status === 'sent',
  );
  if (existing) return existing;

  const entry = {
    id: `exch-${game.turn}-${actorId}-${targetId}-${demandId}`,
    from: actorId,
    to: targetId,
    demandId,
    sentTurn: game.turn,
    dueTurn: game.turn + Math.max(1, deadline),
    status: 'sent',
    odds: odds(game, actorId, targetId, demandId).chance,
  };
  pending(game).push(entry);

  if (demand.hostile) {
    game.worldTension = clamp(game.worldTension + 3, 0, 100);
    recordGrievance(game, targetId, {
      by: 'you', actionId: `demand-${demandId}`, label: demand.name, weight: demand.pressure * 1.4,
    });
  }
  logEvent(game, {
    type: 'diplomacy',
    severity: demand.hostile ? 'major' : 'info',
    text: t('exchange.sent', '{from} puts it to {to}: {ask}. They have a quarter to answer.', {
      from: tNation(defOf(game, actorId)),
      to: tNation(defOf(game, targetId)),
      ask: t(`demand.${demandId}.ask`, demand.ask),
    }),
    nations: [actorId, targetId],
  });
  return entry;
}

/**
 * Every outstanding proposition that is due, answered.
 *
 * @returns {Array<object>} report entries, and possibly one desk decision
 */
export function resolveExchanges(game, rng, mods) {
  const reports = [];
  let decision = null;

  for (const entry of pending(game)) {
    if (entry.status !== 'sent' || game.turn < entry.dueTurn) continue;
    const demand = DEMANDS[entry.demandId];
    if (!demand || !isSovereign(game, entry.to) || !isSovereign(game, entry.from)) {
      entry.status = 'moot';
      continue;
    }

    // A proposition addressed to the player is not rolled for. It is put in
    // front of them, which is the entire point of the mechanism running in both
    // directions: other governments ask you for things too.
    if (entry.to === game.playerId) {
      if (decision) continue;
      entry.status = 'sent';
      decision = inboundDemand(game, entry, demand);
      reports.push({
        type: 'exchange', exchangeId: entry.id, title: t('exchange.inboundTitle', 'They Want Something'),
        text: decision.prompt, status: 'inbound',
      });
      continue;
    }

    const { chance } = odds(game, entry.from, entry.to, entry.demandId);
    const roll = rng.next();
    // The middle band is where it gets interesting: they will not say yes, but
    // they are not willing to say no either, so they come back with terms.
    if (roll < chance) entry.status = 'accepted';
    else if (roll < chance + 0.22) entry.status = 'countered';
    else entry.status = 'refused';
    entry.answeredTurn = game.turn;

    if (entry.status === 'countered' && entry.from === game.playerId && !decision) {
      decision = counterOffer(game, entry, demand);
      reports.push({
        type: 'exchange', exchangeId: entry.id, title: t('exchange.counterTitle', 'They Come Back With Terms'),
        text: decision.prompt, status: 'countered',
      });
      continue;
    }
    if (entry.status === 'countered') {
      // Between two other governments a counter-offer is just a slower yes.
      entry.status = rng.bool(0.5) ? 'accepted' : 'refused';
    }

    reports.push(apply(game, entry, demand, rng, mods));
  }

  // Keep the last two years of correspondence, drop the rest.
  game.exchanges = pending(game).filter(
    (x) => x.status === 'sent' || game.turn - (x.answeredTurn ?? x.sentTurn) < 8,
  );
  return { reports: reports.filter(Boolean), decision };
}

/** Carry out an accepted or refused proposition. */
function apply(game, entry, demand, rng, mods) {
  const from = entry.from;
  const to = entry.to;
  const accepted = entry.status === 'accepted';
  const spec = accepted ? demand.accepted : demand.refused;

  adjustRelation(game, from, to, spec.relation || 0);
  if (spec.worldTension) game.worldTension = clamp(game.worldTension + spec.worldTension, 0, 100);

  const actor = game.nations[from];
  const target = game.nations[to];
  for (const [stat, delta] of Object.entries(spec.self || {})) {
    if (actor && typeof actor[stat] === 'number') actor[stat] = clamp(actor[stat] + delta);
  }
  for (const [stat, delta] of Object.entries(spec.target || {})) {
    if (target && typeof target[stat] === 'number') target[stat] = clamp(target[stat] + delta);
  }
  if (spec.modifier && actor) addModifier(game, from, { ...spec.modifier, source: 'exchange' });

  if (accepted) {
    if (spec.tribute && target && actor) {
      const amount = target.gdp * 1000 * spec.tribute;
      target.treasury -= amount;
      actor.treasury += amount;
      entry.tribute = Math.round(amount);
    }
    if (spec.pays && target && actor) {
      const amount = actor.gdp * 1000 * spec.pays;
      actor.treasury -= amount;
      target.treasury += amount;
      entry.paid = Math.round(amount);
    }
    if (spec.cutsThirdParty) {
      const rival = worstEnemyOf(game, from);
      if (rival) {
        severTies(game, to, rival, 0.8, 10, { by: from, label: 'Cut at your insistence' });
        entry.cut = rival;
      }
    }
    if (spec.grantsAccess) entry.access = true;
    if (spec.guarantees) entry.guarantee = true;
    if (spec.breaksBloc) {
      const bloc = blocsOf(game, to).find((id) => !blocsOf(game, from).includes(id));
      if (bloc) {
        game.blocMembership[to] = (game.blocMembership[to] || []).filter((id) => id !== bloc);
        entry.leftBloc = bloc;
      }
    }
    if (spec.joinsBloc) {
      const bloc = blocsOf(game, from)[0];
      if (bloc && !blocsOf(game, to).includes(bloc)) {
        game.blocMembership[to] = [...(game.blocMembership[to] || []), bloc];
        entry.joinedBloc = bloc;
      }
    }
  } else if (spec.escalates) {
    // A refused ultimatum is the reason ultimatums are dangerous to make.
    entry.escalated = true;
    game.escalation = game.escalation || {};
    const ladderKey = [from, to].sort().join('|');
    game.escalation[ladderKey] = (game.escalation[ladderKey] || 0) + 1.6;
  }

  // Making a demand and being refused in public costs you with everyone else,
  // in proportion to how loudly you made it.
  if (!accepted && demand.hostile && actor) {
    actor.influence = clamp(actor.influence - demand.pressure * 5);
  }

  const text = accepted
    ? t('exchange.accepted', '{to} accepts: {ask}.', {
        to: tNation(defOf(game, to)), ask: t(`demand.${demand.id}.ask`, demand.ask),
      })
    : t('exchange.refused', '{to} refuses. The answer is a single paragraph and it is not a long one.', {
        to: tNation(defOf(game, to)),
      });
  logEvent(game, {
    type: 'diplomacy',
    severity: accepted ? 'info' : demand.hostile ? 'major' : 'info',
    text,
    nations: [from, to],
  });

  return {
    type: 'exchange',
    exchangeId: entry.id,
    warId: null,
    title: accepted ? t('exchange.acceptedTitle', 'They Agree') : t('exchange.refusedTitle', 'They Refuse'),
    text,
    status: entry.status,
    demandId: demand.id,
    withId: to,
  };
}

/** Whoever this country is most at odds with, for demands that need a third party. */
function worstEnemyOf(game, id) {
  let worst = null;
  let coldest = Infinity;
  for (const otherId of Object.keys(game.nations)) {
    if (otherId === id || !isSovereign(game, otherId)) continue;
    const relation = getRelation(game, id, otherId);
    if (relation < coldest) {
      coldest = relation;
      worst = otherId;
    }
  }
  return coldest < -25 ? worst : null;
}

/**
 * Somebody has asked *you* for something.
 *
 * The three answers are not accept / refuse / stall: they are accept, refuse
 * and knowing what refusing will cost, and extract a price for saying yes. What
 * a refusal is worth to them is on the card, because a demand from a country
 * that could not do anything about a no is a different decision from the same
 * words sent by a country that could.
 */
function inboundDemand(game, entry, demand) {
  const them = defOf(game, entry.from);
  const grip = leverage(game, game.playerId, entry.from);
  const theirForce = combatPower(game, entry.from) * reach(game, entry.from, game.playerId);
  const mine = Math.max(1, combatPower(game, game.playerId));
  const menacing = theirForce / mine > 1.15;

  return {
    id: `decision-inbound-${entry.id}`,
    kind: 'decision',
    title: t('exchange.inboundHead', '{nation} Asks', { nation: tNation(them) }),
    targetId: entry.from,
    exchangeId: entry.id,
    inbound: true,
    prompt: t('exchange.inboundPrompt',
      '{nation} has put it to you formally: {ask}. There is no deadline in the note, which in this business means there is one. {threat} The commercial leverage between you runs {way}.',
      {
        nation: tNation(them),
        ask: t(`demand.${demand.id}.ask`, demand.ask),
        threat: menacing
          ? t('exchange.inboundMenace', 'They are in a position to make a refusal cost something, and both of you know it.')
          : t('exchange.inboundHollow', 'They are not, on any reading, in a position to do much about a refusal.'),
        way: grip.verdict === 'yours'
          ? t('exchange.leverageYours', 'firmly your way')
          : grip.verdict === 'theirs'
            ? t('exchange.leverageTheirs', 'firmly theirs')
            : t('exchange.leverageEven', 'in neither direction very hard'),
      }),
    choices: [
      {
        id: 'accede',
        label: t('exchange.choiceAccede', 'Give them what they asked for'),
        detail: t('exchange.choiceAccedeDetail', 'It buys a friend and it establishes what asking gets them.'),
        effect: { relation: 16, self: { influence: -demand.pressure * 6, approval: -demand.pressure * 8 } },
        factions: { staff: -2, party: -3, street: -2 },
        settles: 'accepted',
      },
      {
        id: 'price',
        label: t('exchange.choicePrice', 'Agree — for something in return'),
        detail: t('exchange.choicePriceDetail', 'Nothing is free. Their ambassador knew that before the note was drafted.'),
        chance: grip.verdict === 'yours' ? 0.72 : grip.verdict === 'theirs' ? 0.38 : 0.55,
        // Paid to you, not by you — so it belongs in the effect rather than in
        // the cost, where the card would render it as a negative price.
        effect: { relation: 8, self: { influence: 3, treasuryPctGdp: 0.9 } },
        failEffect: { relation: -12, self: { influence: -3, approval: -2 } },
        factions: { staff: 3, capital: 2 },
        settles: 'accepted',
      },
      {
        id: 'refuse',
        label: t('exchange.choiceRefuse', 'Refuse, in one paragraph'),
        detail: menacing
          ? t('exchange.choiceRefuseHard', 'They can make this expensive. Refusing anyway is a statement about what you will not be asked for again.')
          : t('exchange.choiceRefuseEasy', 'They cannot make this expensive. Everybody watching can see that too.'),
        effect: {
          relation: -demand.pressure * 22,
          self: { approval: 5, influence: menacing ? -2 : 2 },
          worldTension: demand.hostile ? 4 : 0,
        },
        factions: { staff: 2, party: 3, street: 2 },
        settles: 'refused',
        irreversible: demand.hostile,
      },
    ],
  };
}

/**
 * They will do it — for a price. Comes back as a decision on the desk, which is
 * the interactive half of the whole mechanism: you asked, they answered, and
 * now it is your move again.
 */
function counterOffer(game, entry, demand) {
  const them = defOf(game, entry.to);
  const grip = leverage(game, entry.from, entry.to);
  const state = game.nations[game.playerId];
  const price = Number((state.gdp * (0.9 + demand.pressure * 2.4)).toFixed(1));

  return {
    id: `decision-counter-${entry.id}`,
    kind: 'decision',
    title: t('exchange.counterHead', 'A Counter-Offer From {nation}', { nation: tNation(them) }),
    targetId: entry.to,
    exchangeId: entry.id,
    prompt: t('exchange.counterPrompt',
      '{nation} will not simply agree to {ask}. Their ambassador arrives with a counter-proposal: they will do it, for roughly ${price}B in compensation and a public statement that the initiative was theirs. Your own analysts note that the commercial leverage in this relationship runs {way}.',
      {
        nation: tNation(them),
        ask: t(`demand.${demand.id}.ask`, demand.ask),
        price: Math.round(price),
        way: grip.verdict === 'yours'
          ? t('exchange.leverageYours', 'firmly your way')
          : grip.verdict === 'theirs'
            ? t('exchange.leverageTheirs', 'firmly theirs')
            : t('exchange.leverageEven', 'in neither direction very hard'),
      }),
    choices: [
      {
        id: 'pay',
        label: t('exchange.choicePay', 'Pay it and take the deal'),
        detail: t('exchange.choicePayDetail', 'The money is real and the credit goes to them. You get the thing you asked for.'),
        cost: { flat: price },
        effect: { self: { influence: -2 }, relation: 12 },
        factions: { staff: 3, capital: -2, street: -3 },
        settles: 'accepted',
      },
      {
        id: 'press',
        label: t('exchange.choicePress', 'Refuse the price and press the original demand'),
        detail: t('exchange.choicePressDetail', 'They know what you can do about it. So does everybody watching to see whether you will.'),
        chance: Math.max(0.2, entry.odds - 0.15),
        effect: { self: { influence: 3 }, relation: -10, worldTension: 4 },
        failEffect: { self: { influence: -6, approval: -4 }, relation: -20, worldTension: 6 },
        factions: { staff: 2, party: -2, street: -2 },
        settles: 'pressed',
        irreversible: true,
      },
      {
        id: 'withdraw',
        label: t('exchange.choiceWithdraw', 'Withdraw the demand'),
        detail: t('exchange.choiceWithdrawDetail', 'It was a probe. It has told you what you needed to know, and cost you the price of asking.'),
        effect: { self: { influence: -3, approval: -2 } },
        factions: { staff: -2, party: 2 },
        settles: 'withdrawn',
      },
    ],
  };
}

/**
 * Finish a counter-offer once the player has answered it.
 * Called from the decision resolver, which is where the answer arrives.
 */
export function settleCounter(game, exchangeId, settles, succeeded, rng) {
  const entry = pending(game).find((x) => x.id === exchangeId);
  if (!entry) return null;
  const demand = DEMANDS[entry.demandId];
  if (!demand) return null;

  if (settles === 'accepted' || (settles === 'pressed' && succeeded)) {
    entry.status = 'accepted';
    return apply(game, entry, demand, rng, null);
  }
  if (settles === 'refused') {
    entry.status = 'refused';
    return apply(game, entry, demand, rng, null);
  }
  entry.status = settles === 'withdrawn' ? 'withdrawn' : 'refused';
  if (entry.status === 'refused') return apply(game, entry, demand, rng, null);
  return null;
}

// ── For the interface ───────────────────────────────────────────────────────

/** Outstanding correspondence, ours and theirs, for the panel. */
export function exchangeReport(game, id = game.playerId) {
  const all = pending(game);
  return {
    outbound: all.filter((x) => x.from === id && x.status === 'sent').map(decorate(game)),
    inbound: all.filter((x) => x.to === id && x.status === 'sent').map(decorate(game)),
    settled: all
      .filter((x) => (x.from === id || x.to === id) && x.status !== 'sent')
      .slice(-5)
      .reverse()
      .map(decorate(game)),
  };
}

function decorate(game) {
  return (entry) => ({
    ...entry,
    demand: DEMANDS[entry.demandId],
    fromDef: defOf(game, entry.from),
    toDef: defOf(game, entry.to),
    dueIn: Math.max(0, entry.dueTurn - game.turn),
  });
}
