// The Ties tab, and the orders that put you into somebody else's war.
//
// Two families of order that the catalogue had no room for before the
// dependency web and the world-war machinery existed:
//
//   • Commercial statecraft. Not "impose sanctions" as a flat modifier but the
//     whole instrument set that a country with real commercial leverage
//     actually has — embargo a class of goods, close a strait, de-risk a supply
//     chain you cannot defend, buy a chokepoint, underwrite somebody else's
//     dependence on you so it deepens. Every one of them is priced against the
//     real exposure between the two countries, so the same order is devastating
//     against a country that needs you and pointless against one that does not.
//
//   • Entering a war that is already running. You could declare war on a
//     country and you could be dragged into one, but you could not walk into
//     an existing conflict on a side. That is how most countries end up in most
//     wars.

import { DEMANDS } from './exchanges.js';
import { exposure, openShare } from './dependency.js';
import { getRelation, isSovereign, livePower } from './state.js';
import { reach, MIN_REACH } from './reach.js';
import { canRally } from './rally.js';

/** Defaults, so each order below is only what makes it different. */
function tr(id, name, blurb, opts = {}) {
  return {
    id, name, category: 'trade', blurb,
    cost: { pctGdp: 0.4 }, pc: 2, target: 'nation', baseSuccess: 0.7, risk: 'medium',
    skills: [['influence', 0.18]],
    ...opts,
  };
}

/** Are these two doing enough business for an order about it to mean anything? */
function tradesWith(game, targetId, floor = 0.012) {
  return exposure(game, game.playerId, targetId) + exposure(game, targetId, game.playerId) >= floor;
}

export const TRADE_ORDERS = [
  tr('embargo', 'Impose a Full Embargo', 'Close the ports, the accounts and the airspace. Both of you will feel it; one of you will feel it more.', {
    cost: { pctGdp: 0.5 }, pc: 4, baseSuccess: 0.82, risk: 'medium', tension: 8,
    situational: ['escalation', 'sanctioned', 'hostileNeighbour', 'war', 'brink', 'feared'],
    availableAgainst: (game, id) => tradesWith(game, id),
    trade: { sever: 0.95, turns: 10, label: 'Full embargo' },
    effects: {
      success: { relation: -26, worldTension: 8, self: { influence: 2 } },
      failure: { relation: -14, self: { influence: -3 }, worldTension: 4 },
    },
  }),
  tr('targeted-embargo', 'Embargo the Critical Goods', 'Not everything — the three categories they cannot make themselves.', {
    cost: { pctGdp: 0.25 }, pc: 3, baseSuccess: 0.76,
    situational: ['escalation', 'techLead', 'hostileNeighbour', 'tension'],
    availableAgainst: (game, id) => tradesWith(game, id),
    trade: { sever: 0.45, turns: 8, label: 'Targeted embargo' },
    effects: {
      success: { relation: -14, target: { tech: -2 }, worldTension: 4 },
      failure: { relation: -8, self: { influence: -2 } },
    },
  }),
  tr('close-the-strait', 'Close the Strait to Their Shipping', 'Everything they move by sea now moves the long way round, if it moves.', {
    cost: { pctGdp: 0.55 }, pc: 4, baseSuccess: 0.6, risk: 'high',
    skills: [['military', 0.2], ['influence', 0.1]],
    situational: ['maritime', 'war', 'escalation', 'brink'],
    availableAgainst: (game, id) => tradesWith(game, id, 0.008) && reach(game, game.playerId, id) >= MIN_REACH,
    trade: { sever: 0.8, turns: 6, label: 'Sea lanes closed' },
    tension: 12,
    effects: {
      success: { relation: -30, worldTension: 12, target: { unrest: 5 } },
      failure: { relation: -18, self: { influence: -4, readiness: -4 }, worldTension: 8 },
      backfire: { relation: -24, self: { influence: -8, readiness: -8, approval: -5 }, worldTension: 14 },
    },
  }),
  tr('secondary-sanctions', 'Sanction Whoever Keeps Trading With Them', 'The point is not the country you are naming. It is the twenty watching.', {
    cost: { pctGdp: 0.3 }, pc: 4, baseSuccess: 0.55, risk: 'high',
    skills: [['influence', 0.3]],
    situational: ['sanctioned', 'escalation', 'influential', 'tension'],
    availableAgainst: (game, id) => livePower(game, game.playerId) > livePower(game, id),
    trade: { sever: 0.35, turns: 6, label: 'Secondary sanctions', spillover: true },
    effects: {
      success: { relation: -18, worldTension: 6, self: { influence: 3 } },
      failure: { relation: -10, self: { influence: -6 }, worldTension: 4 },
      backfire: { relation: -16, self: { influence: -12, approval: -4 } },
    },
  }),
  tr('lift-sanctions', 'Re-open the Arrangement', 'Whatever it was worth before, it is worth again — and they remember who closed it.', {
    cost: { pctGdp: 0.15 }, pc: 2, baseSuccess: 0.86, risk: 'low',
    situational: ['sanctioned', 'debt', 'stagnant', 'isolated', 'peace'],
    availableAgainst: (game, id) => openShare(game, game.playerId, id) < 0.99,
    trade: { restore: 1, label: 'Ties restored' },
    effects: {
      success: { relation: 18, self: { influence: 2 }, worldTension: -4 },
      failure: { relation: 4 },
    },
  }),
  tr('deepen-ties', 'Underwrite Their Dependence On You', 'Cheap credit, long contracts, a standard only your firms can meet. In ten years they will not be able to leave.', {
    cost: { pctGdp: 1.1 }, pc: 2, baseSuccess: 0.72, risk: 'low',
    skills: [['influence', 0.16], ['tech', 0.1]],
    situational: ['rich', 'influential', 'exporter', 'techLead', 'peace'],
    effects: {
      success: {
        relation: 12, self: { influence: 3 }, target: { stability: 2 },
        modifier: { label: 'Commercial bridgehead', turns: 10, growth: 0.16 },
        targetModifier: { label: 'Dependent on your credit', turns: 12, growth: 0.2 },
      },
      failure: { relation: 2, self: { influence: -1 } },
    },
  }),
  tr('de-risk', 'De-risk the Supply Chain', 'Move what you cannot afford to lose out of a country you cannot defend it in.', {
    cost: { pctGdp: 1.6 }, pc: 3, target: 'nation', baseSuccess: 0.66,
    skills: [['tech', 0.18], ['stability', 0.1]],
    situational: ['escalation', 'tension', 'hostileNeighbour', 'sanctioned', 'techLag'],
    availableAgainst: (game, id) => exposure(game, game.playerId, id) > 0.02,
    trade: { insulate: 0.45, label: 'De-risked' },
    effects: {
      success: {
        self: { stability: 2 },
        modifier: { label: 'Supply chains rerouted', turns: 10, growth: -0.08 },
      },
      failure: { self: { approval: -2 }, modifier: { label: 'Botched relocation', turns: 4, growth: -0.22 } },
    },
  }),
  tr('stockpile', 'Build the Strategic Stockpile', 'Ninety days of everything, in warehouses nobody visits, against a quarter nobody wants.', {
    cost: { pctGdp: 1.4 }, pc: 1, target: 'none', baseSuccess: 0.82, risk: 'low',
    skills: [['stability', 0.12]],
    situational: ['tension', 'war', 'escalation', 'energy', 'brink', 'commodityShock'],
    trade: { buffer: 0.3, turns: 12, label: 'Strategic reserve' },
    effects: {
      success: { self: { stability: 3 }, modifier: { label: 'Strategic reserves full', turns: 12, growth: -0.05, unrest: -0.4 } },
      failure: { self: { approval: -2 } },
    },
  }),
  tr('buy-the-chokepoint', 'Buy the Chokepoint', 'A terminal, a canal concession, a cable landing station. It costs a fortune and it changes the map.', {
    cost: { pctGdp: 2.6 }, pc: 4, target: 'nation', baseSuccess: 0.5, risk: 'medium',
    skills: [['influence', 0.2], ['tech', 0.08]],
    situational: ['rich', 'maritime', 'influential', 'growing'],
    effects: {
      success: {
        relation: 8, self: { influence: 6 },
        modifier: { label: 'Chokepoint concession', turns: 16, growth: 0.24 },
      },
      failure: { self: { approval: -3, influence: -2 }, relation: -4 },
    },
  }),
  tr('resource-cartel', 'Form a Producers’ Cartel', 'Agree the volumes with the only other people who have any, and let the price do the talking.', {
    cost: { pctGdp: 0.6 }, pc: 3, target: 'nation', baseSuccess: 0.52, risk: 'medium',
    skills: [['influence', 0.22]],
    situational: ['resource', 'energy', 'commodityShock', 'growing'],
    effects: {
      success: {
        relation: 14, self: { influence: 5 },
        modifier: { label: 'Cartel pricing', turns: 10, growth: 0.3 },
        targetModifier: { label: 'Cartel pricing', turns: 10, growth: 0.22 },
        worldTension: 4,
      },
      failure: { relation: -6, self: { influence: -3 } },
    },
  }),
  tr('debt-trap', 'Lend Them More Than They Can Repay', 'The terms are generous. The collateral is a port.', {
    cost: { pctGdp: 2.2 }, pc: 3, baseSuccess: 0.64, risk: 'medium', covert: false,
    skills: [['influence', 0.18]],
    situational: ['rich', 'influential', 'growing'],
    availableAgainst: (game, id) => (game.nations[id]?.treasury ?? 0) < 0 || (game.nations[id]?.stability ?? 100) < 55,
    effects: {
      success: {
        relation: 10, self: { influence: 5 }, target: { stability: 3 },
        targetModifier: { label: 'External debt service', turns: 14, growth: -0.18 },
      },
      failure: { relation: -8, self: { influence: -4 }, modifier: { label: 'Bad sovereign loan', turns: 6, growth: -0.14 } },
    },
  }),
  tr('rare-earth-squeeze', 'Restrict the Export Licences', 'You are not banning anything. You are simply taking longer over the paperwork.', {
    cost: { pctGdp: 0.2 }, pc: 3, baseSuccess: 0.74, covert: true,
    skills: [['tech', 0.16], ['influence', 0.1]],
    situational: ['resource', 'techLead', 'escalation', 'tension'],
    availableAgainst: (game, id) => exposure(game, id, game.playerId) > 0.015,
    trade: { sever: 0.3, turns: 6, label: 'Licences slow-walked' },
    effects: {
      success: { relation: -10, target: { tech: -2 }, worldTension: 3 },
      failure: { relation: -6, self: { influence: -2 } },
    },
  }),
  tr('trade-mission', 'Send the Largest Trade Mission in Years', 'Four hundred executives, nine memoranda, and one photograph that does more than any of them.', {
    cost: { pctGdp: 0.35 }, pc: 1, baseSuccess: 0.8, risk: 'low',
    skills: [['influence', 0.16]],
    situational: ['stagnant', 'isolated', 'peace', 'exporter', 'growing'],
    effects: {
      success: { relation: 12, self: { influence: 2 }, modifier: { label: 'New export orders', turns: 6, growth: 0.18 } },
      failure: { relation: 2, self: { approval: -1 } },
    },
  }),
  tr('currency-swap', 'Open a Currency Swap Line', 'When their banks cannot find dollars at three in the morning, they will find yours.', {
    cost: { pctGdp: 0.9 }, pc: 2, baseSuccess: 0.68, risk: 'low',
    skills: [['influence', 0.2], ['stability', 0.12]],
    situational: ['rich', 'influential', 'financial', 'peace'],
    effects: {
      success: {
        relation: 16, self: { influence: 4 },
        targetModifier: { label: 'Swap line open', turns: 10, growth: 0.14 },
      },
      failure: { relation: 2, self: { influence: -2 } },
    },
  }),
  tr('food-shipment', 'Ship Them the Grain', 'It is not charity and everybody involved knows it. It still gets eaten.', {
    cost: { pctGdp: 0.7 }, pc: 1, baseSuccess: 0.84, risk: 'low',
    skills: [['influence', 0.14]],
    situational: ['agrarian', 'famine', 'neighbourCrisis', 'refugees', 'peace'],
    effects: {
      success: { relation: 18, self: { influence: 3 }, target: { unrest: -6, stability: 3 } },
      failure: { relation: 4, self: { approval: -2 } },
    },
  }),
];

// ── Entering somebody else's war ────────────────────────────────────────────

/** Wars the player is not in but could join. */
export function joinableWars(game) {
  return game.wars.filter(
    (war) => war.active
      && !war.attackers.includes(game.playerId)
      && !war.defenders.includes(game.playerId),
  );
}

/** Is this country fighting a war we are not in, and can we get there? */
function fightingWithoutUs(game, id, side) {
  return joinableWars(game).some(
    (war) => war[side].includes(id) && reach(game, game.playerId, id) >= MIN_REACH * 0.8,
  );
}

export const WAR_ENTRY_ORDERS = [
  {
    id: 'enter-alongside',
    name: 'Enter the War on Their Side',
    category: 'military',
    blurb: 'They are already fighting. You are about to be. Everything their enemies are is now yours.',
    cost: { pctGdp: 1.2 }, pc: 5, target: 'nation', baseSuccess: 0.9, risk: 'high',
    skills: [['military', 0.1]],
    situational: ['warNextDoor', 'war', 'tension', 'strongArmy', 'brink'],
    joinsWar: 'with',
    availableAgainst: (game, id) =>
      (fightingWithoutUs(game, id, 'defenders') || fightingWithoutUs(game, id, 'attackers'))
      && getRelation(game, game.playerId, id) > 5,
    tension: 14,
    effects: {
      success: { relation: 26, self: { approval: -6, unrest: 4 }, worldTension: 12 },
      failure: { relation: 8, self: { approval: -8, unrest: 6 }, worldTension: 8 },
    },
  },
  {
    id: 'enter-against',
    name: 'Enter the War Against Them',
    category: 'military',
    blurb: 'Somebody is already fighting them and losing. You have decided that is your problem.',
    cost: { pctGdp: 1.4 }, pc: 5, target: 'nation', baseSuccess: 0.9, risk: 'high',
    skills: [['military', 0.1]],
    situational: ['warNextDoor', 'feared', 'tension', 'strongArmy', 'hostileNeighbour'],
    joinsWar: 'against',
    availableAgainst: (game, id) =>
      (fightingWithoutUs(game, id, 'attackers') || fightingWithoutUs(game, id, 'defenders'))
      && getRelation(game, game.playerId, id) < 20,
    tension: 16,
    effects: {
      success: { relation: -50, self: { influence: 3, unrest: 5 }, worldTension: 14 },
      failure: { relation: -40, self: { influence: -3, unrest: 8 }, worldTension: 10 },
    },
  },
  {
    id: 'call-the-bloc',
    name: 'Call the Alliance',
    category: 'alliances',
    blurb: 'Not a bilateral phone call — the standing council, in session, with the clause read aloud.',
    cost: { pctGdp: 0.3 }, pc: 4, target: 'none', baseSuccess: 0.7, risk: 'medium',
    skills: [['influence', 0.24]],
    situational: ['war', 'warLosing', 'occupied', 'brink', 'escalation'],
    blocCall: true,
    available: (game) => game.wars.some(
      (w) => w.active && (w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId)),
    ),
    effects: {
      success: { self: { approval: 4 }, worldTension: 8 },
      failure: { self: { influence: -5, approval: -4 }, worldTension: 4 },
    },
  },
  {
    id: 'rally-one',
    name: 'Ask Them to Join the War',
    category: 'alliances',
    blurb: 'A direct call to one capital, made in person, with the whole case laid out. They owe you nothing, which is what makes it worth doing properly.',
    cost: { pctGdp: 0.4 }, pc: 3, target: 'nation', baseSuccess: 0.95, risk: 'medium',
    skills: [['influence', 0.14]],
    situational: ['war', 'warLosing', 'occupied', 'warStalled', 'brink', 'casualties'],
    rally: 'one',
    available: (game) => game.wars.some(
      (w) => w.active && (w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId)),
    ),
    availableAgainst: (game, id) => Boolean(canRally(game, id)),
    effects: {
      success: { self: { influence: 1 }, worldTension: 3 },
      failure: { self: { influence: -3, approval: -2 } },
    },
  },
  {
    id: 'rally-the-region',
    name: 'Appeal to Every Capital That Will Listen',
    category: 'alliances',
    blurb: 'One appeal, broadcast, to everybody who has not committed. Easier to make than twelve telephone calls and much easier to refuse.',
    cost: { pctGdp: 0.7 }, pc: 4, target: 'none', baseSuccess: 0.85, risk: 'medium',
    skills: [['influence', 0.26]],
    situational: ['warLosing', 'occupied', 'war', 'casualties', 'brink', 'warExhausted'],
    rally: 'all',
    available: (game) => game.wars.some(
      (w) => w.active && (w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId)),
    ),
    effects: {
      success: { self: { influence: 2, approval: 2 }, worldTension: 6 },
      failure: { self: { influence: -6, approval: -4 } },
    },
  },
  {
    id: 'general-armistice',
    name: 'Convene a General Armistice',
    category: 'diplomacy',
    blurb: 'Every belligerent in one room, a ceasefire line on one map, and nobody leaving until it is signed.',
    cost: { pctGdp: 0.8 }, pc: 5, target: 'none', baseSuccess: 0.34, risk: 'medium',
    skills: [['influence', 0.34], ['stability', 0.1]],
    situational: ['war', 'warExhausted', 'casualties', 'brink', 'tension', 'nuclearUsed'],
    generalArmistice: true,
    available: (game) => game.wars.some((w) => w.active),
    effects: {
      success: { self: { influence: 9, approval: 6 }, worldTension: -22 },
      failure: { self: { influence: -4, approval: -3 } },
    },
  },
  {
    id: 'armed-neutrality-declared',
    name: 'Declare Armed Neutrality',
    category: 'diplomacy',
    blurb: 'You will trade with both sides, escort your own shipping, and shoot at whoever stops it.',
    cost: { pctGdp: 0.9 }, pc: 3, target: 'none', baseSuccess: 0.66, risk: 'medium',
    skills: [['military', 0.14], ['influence', 0.14]],
    situational: ['warNextDoor', 'tension', 'peace', 'brink'],
    neutrality: true,
    available: (game) => !game.wars.some(
      (w) => w.active && (w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId)),
    ) && game.wars.some((w) => w.active),
    effects: {
      success: {
        self: { influence: 3, readiness: 5, approval: 4 },
        modifier: { label: 'Armed neutrality', turns: 10, growth: 0.14, unrest: -0.3 },
      },
      failure: { self: { influence: -3, approval: -3 } },
    },
  },
];

// ── Demands, as orders ──────────────────────────────────────────────────────

/**
 * Each demand in exchanges.js becomes one diplomacy order. They are written
 * once, there, with their terms and their consequences; this only puts them on
 * the shelf.
 */
const DEMAND_SITUATIONS = {
  'open-markets': ['stagnant', 'exporter', 'growing', 'peace'],
  'transit-rights': ['war', 'tension', 'warNextDoor', 'strongArmy'],
  'leave-bloc': ['influential', 'escalation', 'feared', 'tension'],
  'cut-third-party': ['escalation', 'sanctioned', 'war', 'influential'],
  reparations: ['warWinning', 'occupier', 'conquest', 'attack'],
  'border-adjustment': ['warWinning', 'occupier', 'feared', 'strongArmy'],
  'release-hold': ['occupied', 'warLosing', 'borderChange', 'newState'],
  'join-us': ['influential', 'popular', 'peace', 'growing'],
  'buy-land': ['rich', 'growing', 'peace'],
  'stand-down': ['hostileNeighbour', 'escalation', 'brink', 'tension'],
  'guarantee-them': ['influential', 'strongArmy', 'warNextDoor', 'neighbourCrisis'],
  'hand-over': ['attack', 'unrest', 'coup', 'boiling'],
};

export const DEMAND_ORDERS = Object.values(DEMANDS).map((demand) => ({
  id: `demand-${demand.id}`,
  name: demand.name,
  category: 'diplomacy',
  blurb: `You put it to them formally and in writing: ${demand.ask}. They answer next quarter.`,
  cost: { pctGdp: demand.hostile ? 0.3 : 0.5 },
  pc: demand.hostile ? 3 : 2,
  target: 'nation',
  baseSuccess: 0.95,
  risk: demand.hostile ? 'medium' : 'low',
  skills: [['influence', 0.1]],
  situational: DEMAND_SITUATIONS[demand.id],
  demand: demand.id,
  tension: demand.hostile ? 4 : 0,
  availableAgainst: (game, id) => isSovereign(game, id)
    && !(game.exchanges || []).some(
      (x) => x.status === 'sent' && x.from === game.playerId && x.to === id && x.demandId === demand.id,
    ),
  effects: {
    // The order itself only ever succeeds at *being sent*. What it is worth is
    // decided by the answer, next quarter, in exchanges.js — so the card shows
    // the price of asking, which is the part that is certain.
    success: {
      self: { influence: demand.hostile ? -1 : 1 },
      worldTension: demand.hostile ? 3 : -1,
    },
    failure: { self: { influence: -2, approval: -1 } },
  },
}));
