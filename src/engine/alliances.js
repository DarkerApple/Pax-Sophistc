// Orders about paper: who you are bound to, and what that binding is worth.
//
// The Alliances tab. Proposing a treaty is generated per kind — the only thing
// that differs between a trade treaty and a mutual defence pact is the weight,
// the relation it needs and what it does afterwards, all of which live in
// treaties.js. Everything else here is the work of keeping an alliance alive:
// exercises, standardisation, a fusion cell, a summit, and the two orders
// nobody wants to need — invoking the treaties, and tearing one up.

import { TREATY_LIST, canSign, treatiesFor, alliesOf, partnersOf } from './treaties.js';
import { activeWarsFor } from './state.js';

/** Defaults, so each order below is only what makes it different. */
function a(id, name, blurb, opts = {}) {
  return {
    id,
    name,
    blurb,
    category: 'alliances',
    target: 'none',
    pc: 3,
    risk: 'medium',
    baseSuccess: 0.68,
    cost: { pctGdp: 0.4 },
    skills: [['influence', 0.18]],
    ...opts,
  };
}

/**
 * One "propose a ——" order per treaty kind.
 *
 * Generated rather than written out: seven near-identical cards would drift
 * apart the first time the terms changed, and the availability rule is the same
 * for all of them — somebody has to be willing to sign it.
 */
const PROPOSALS = TREATY_LIST.map((kind) =>
  a(`propose-${kind.id}`, `Propose a ${kind.name}`, kind.blurb, {
    target: 'nation',
    pc: 2 + Math.ceil(kind.weight / 2),
    cost: { pctGdp: 0.15 + kind.weight * 0.08 },
    baseSuccess: 0.72 - kind.weight * 0.04,
    relationFloor: kind.minRelation,
    formsPact: kind.id,
    risk: kind.weight >= 4 ? 'high' : 'medium',
    skills: [['influence', 0.2 + kind.weight * 0.01], ['stability', 0.05]],
    situational: proposalSituations(kind.id),
    // Never offered against a country that could not sign it anyway.
    availableAgainst: (game, targetId) => canSign(game, game.playerId, targetId, kind.id).ok,
    effects: {
      success: {
        self: { influence: 1 + kind.weight },
        relation: 6 + kind.weight * 2,
        worldTension: kind.weight >= 4 ? kind.weight : 0,
      },
      failure: { self: { influence: -2, approval: -1 }, relation: -3 },
    },
  }),
);

function proposalSituations(kindId) {
  switch (kindId) {
    case 'nonaggression': return ['hostileNeighbour', 'tension', 'escalation', 'feared', 'warNextDoor'];
    case 'trade': return ['stagnant', 'exporter', 'sanctioned', 'isolated', 'growing'];
    case 'intelligence': return ['cyber', 'attack', 'tension', 'techLag', 'war'];
    case 'access': return ['tension', 'war', 'maritime', 'influential', 'warNextDoor'];
    case 'defence': return ['hostileNeighbour', 'warNextDoor', 'feared', 'tension', 'neighbourCrisis'];
    case 'umbrella': return ['nuclear', 'brink', 'escalation', 'influential'];
    case 'alliance': return ['tension', 'isolated', 'warNextDoor', 'pariah', 'influential'];
    default: return null;
  }
}

/** @type {Array<object>} */
export const ALLIANCE_ORDERS = [
  ...PROPOSALS,

  a('renew-the-paper', 'Renew the Expiring Treaties', 'Send the delegations before the clocks run out. Dull, cheap, and the alternative is explaining why it lapsed.',
    { pc: 1, cost: { pctGdp: 0.05 }, baseSuccess: 0.86, risk: 'low',
      renewsTreaties: true,
      situational: ['peaceful', 'tension', 'isolated'],
      available: (game) => treatiesFor(game, game.playerId).some((tr) => tr.expiresTurn - game.turn <= 6),
      effects: {
        success: { self: { influence: 2 } },
        failure: { self: { influence: -1 } },
      } }),

  a('withdraw-from-treaty', 'Withdraw From the Treaty', 'Give notice, take the obligations back, and accept that everyone else now reads your signature differently.',
    { target: 'nation', pc: 4, risk: 'high', confirm: true, baseSuccess: 0.9,
      abrogates: true,
      situational: ['pariah', 'sanctioned', 'unpopular', 'occupied', 'war'],
      availableAgainst: (game, targetId) => partnersOf(game, game.playerId).includes(targetId),
      effects: {
        success: { self: { influence: -3, approval: 3, unrest: 2 }, worldTension: 3 },
        failure: { self: { influence: -6, approval: -3, unrest: 4 }, worldTension: 3 },
      } }),

  a('invoke-the-treaties', 'Invoke the Treaties', 'Call every ally you have. You will find out, in one afternoon, exactly what the paper was worth.',
    { pc: 3, cost: { pctGdp: 0.1 }, baseSuccess: 0.95, risk: 'high', confirm: true,
      invokesTreaties: true,
      situational: ['war', 'warLosing', 'occupied', 'brink'],
      available: (game) => activeWarsFor(game, game.playerId).length > 0
        && alliesOf(game, game.playerId).length > 0,
      effects: {
        success: { self: { approval: 3 }, worldTension: 6 },
        failure: { self: { influence: -5, approval: -4 }, worldTension: 3 },
      } }),

  a('joint-exercises', 'Hold Joint Exercises', 'Move real formations across a real border on a real timetable. It is the only way to find out whether the alliance works.',
    { target: 'nation', pc: 2, cost: { pctGdp: 0.35 }, baseSuccess: 0.8,
      skills: [['readiness', 0.14], ['influence', 0.1]],
      situational: ['tension', 'hostileNeighbour', 'warNextDoor', 'hollowArmy', 'peace'],
      availableAgainst: (game, targetId) => alliesOf(game, game.playerId).some((x) => x.id === targetId),
      effects: {
        success: {
          self: { readiness: 6, influence: 2 }, target: { readiness: 4 }, relation: 12,
          modifier: { label: 'Interoperability', turns: 8, readiness: 0.3 },
          worldTension: 3,
        },
        failure: { self: { readiness: -2, approval: -2 }, relation: 2, worldTension: 2 },
      } }),

  a('arms-standardisation', 'Standardise the Arsenals', 'One calibre, one datalink, one logistics chain. Everybody hates it and everybody is better off.',
    { target: 'nation', pc: 3, cost: { pctGdp: 0.9 }, baseSuccess: 0.66,
      skills: [['tech', 0.16], ['influence', 0.1]],
      situational: ['war', 'tension', 'hollowArmy', 'exporter'],
      availableAgainst: (game, targetId) => alliesOf(game, game.playerId).some((x) => x.id === targetId),
      effects: {
        success: {
          self: { readiness: 5, military: 2, tech: 1 }, target: { readiness: 4, military: 1 }, relation: 14,
          modifier: { label: 'Common standards', turns: 14, readiness: 0.35 },
        },
        failure: { self: { readiness: -3 }, relation: -2 },
      } }),

  a('fusion-cell', 'Stand Up a Joint Intelligence Cell', 'One room, two services, and a standing argument about what may be shared with whom.',
    { target: 'nation', pc: 3, cost: { pctGdp: 0.3 }, baseSuccess: 0.7, covert: true,
      skills: [['tech', 0.16], ['influence', 0.1]],
      situational: ['cyber', 'attack', 'war', 'tension', 'techLag'],
      availableAgainst: (game, targetId) => partnersOf(game, game.playerId).includes(targetId),
      effects: {
        success: {
          self: { tech: 2, influence: 2 }, target: { tech: 1 }, relation: 10,
          modifier: { label: 'Shared collection', turns: 10, tech: 0.2 },
        },
        failure: { self: { influence: -2 }, relation: -4 },
      } }),

  a('alliance-summit', 'Convene the Alliance', 'Get every partner into one room and make them say out loud what they will actually do.',
    { pc: 3, cost: { pctGdp: 0.3 }, baseSuccess: 0.72,
      skills: [['influence', 0.24]],
      situational: ['tension', 'war', 'brink', 'warNextDoor', 'feared'],
      available: (game) => alliesOf(game, game.playerId).length >= 2,
      strengthensTreaties: 14,
      effects: {
        success: { self: { influence: 6, approval: 3 }, worldTension: -3 },
        failure: { self: { influence: -3, approval: -2 } },
      } }),

  a('underwrite-the-ally', 'Underwrite the Ally', 'Their deficit, your balance sheet. It is cheaper than the alternative and nobody at home will believe you.',
    { target: 'nation', pc: 2, cost: { pctGdp: 1.1 }, baseSuccess: 0.82,
      skills: [['influence', 0.14]],
      situational: ['warNextDoor', 'neighbourCrisis', 'rich', 'war', 'tension'],
      availableAgainst: (game, targetId) => partnersOf(game, game.playerId).includes(targetId),
      effects: {
        success: {
          self: { approval: -2, influence: 3 }, target: { stability: 6, readiness: 3 }, relation: 20,
          targetModifier: { label: 'Underwritten', turns: 8, growth: 0.24 },
        },
        failure: { self: { approval: -4 }, relation: 4 },
      } }),

  a('open-the-arsenal', 'Open the Arsenal to Them', 'Sell them what you would not sell anybody else, at a price that is not really a price.',
    { target: 'nation', pc: 3, cost: { pctGdp: 0.7 }, baseSuccess: 0.76, risk: 'high',
      skills: [['military', 0.12], ['influence', 0.12]],
      situational: ['warNextDoor', 'hostileNeighbour', 'war', 'strongArmy', 'exporter'],
      availableAgainst: (game, targetId) => partnersOf(game, game.playerId).includes(targetId),
      effects: {
        success: {
          self: { influence: 4, readiness: -2 }, target: { military: 5, readiness: 6 }, relation: 18,
          worldTension: 5,
        },
        failure: { self: { influence: -3, readiness: -3 }, relation: 4, worldTension: 3 },
      } }),

  a('quiet-word', 'Have the Quiet Word', 'Not a summit, not a note. One conversation, off the record, with the person who actually decides.',
    { target: 'nation', pc: 1, cost: { pctGdp: 0.02 }, baseSuccess: 0.74, risk: 'low',
      skills: [['influence', 0.22]],
      situational: ['escalation', 'tension', 'brink', 'hostileNeighbour', 'war'],
      effects: {
        success: { self: { influence: 2 }, relation: 12, worldTension: -2 },
        failure: { relation: -3 },
      } }),

  a('recognise-the-obligation', 'Say It Out Loud', 'State publicly, in terms nobody can walk back, exactly what you would do if they were attacked.',
    { target: 'nation', pc: 3, cost: { pctGdp: 0.05 }, baseSuccess: 0.78, risk: 'high',
      skills: [['influence', 0.18], ['military', 0.08]],
      situational: ['warNextDoor', 'hostileNeighbour', 'tension', 'neighbourCrisis', 'escalation'],
      availableAgainst: (game, targetId) => alliesOf(game, game.playerId).some((x) => x.id === targetId),
      strengthensTreaties: 20,
      effects: {
        success: { self: { influence: 4 }, target: { stability: 4 }, relation: 16, worldTension: 5 },
        failure: { self: { influence: -4, approval: -3 }, worldTension: 4 },
      } }),

  a('mediate-between-allies', 'Mediate Between Your Own', 'Two of your partners have stopped speaking. Somebody has to sit in the middle and it is going to be you.',
    { pc: 2, cost: { pctGdp: 0.15 }, baseSuccess: 0.64,
      skills: [['influence', 0.24], ['stability', 0.06]],
      situational: ['tension', 'peaceful', 'influential'],
      available: (game) => alliesOf(game, game.playerId).length >= 3,
      strengthensTreaties: 8,
      effects: {
        success: { self: { influence: 5, approval: 2 }, worldTension: -4 },
        failure: { self: { influence: -3 } },
      } }),

  a('buy-the-vote', 'Buy the Vote', 'Aid, access and a personal call, in exchange for a hand going up when it matters.',
    { target: 'nation', pc: 2, cost: { pctGdp: 0.55 }, baseSuccess: 0.7, risk: 'high', covert: true,
      skills: [['influence', 0.2]],
      situational: ['influential', 'rich', 'isolated', 'tension'],
      effects: {
        success: { self: { influence: 3, approval: -1 }, target: { stability: 2 }, relation: 22 },
        failure: { self: { influence: -5, approval: -4 }, relation: -8 },
      } }),
];
