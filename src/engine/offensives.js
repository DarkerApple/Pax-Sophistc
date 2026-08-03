// Ways to attack, all of which cost materiel.
//
// The War Room already had twenty-seven operations, and every one of them was
// paid for in money and political capital. You could mount an amphibious
// landing every quarter for ten years. None of them asked *where*, because
// until fronts existed there was nowhere to ask about.
//
// These twenty-two are a different kind of order. Each one names a front, draws
// a specific mix out of the arsenal, and spends it: the armour that goes into
// the breakthrough does not come back, the salvo that goes downrange is gone.
// Each declares the ground it wants — `prefers` — so the shelf offers a
// mountain operation when there is a mountain front and an amphibious one when
// there is a coast, and the planner opens on the front that suits it.
//
// `intent` picks the default mix from the arsenal; `share` is how much of the
// available pool it reaches for. A player who opens the planner can override
// both, which is the point of having one.

import { activeWarsFor } from './state.js';

/** Defaults, so each operation below is only what makes it different. */
function o(id, name, blurb, opts = {}) {
  return {
    id,
    name,
    blurb,
    category: 'war',
    target: 'none',
    pc: 3,
    risk: 'high',
    baseSuccess: 0.7,
    cost: { pctGdp: 0.5 },
    skills: [['military', 0.14], ['readiness', 0.14]],
    // Everything here is an offensive: the resolver reads this, opens the
    // planner if the player wants one, and spends what it commits.
    offensive: { intent: 'break', share: 0.35, pressure: 1 },
    available: (game) => activeWarsFor(game, game.playerId).length > 0,
    ...opts,
  };
}

/** @type {Array<object>} */
export const OFFENSIVES = [
  // ── Breaking a line ───────────────────────────────────────────────────────
  o('armoured-thrust', 'Armoured Thrust', 'Everything on tracks, on the narrowest frontage the ground allows, and no stopping to consolidate.',
    { offensive: { intent: 'break', share: 0.55, pressure: 1.2 }, prefers: ['plain', 'desert'],
      cost: { pctGdp: 0.9 }, pc: 4, situational: ['war', 'warStalled', 'warWinning', 'strongArmy'],
      effects: { success: { self: { approval: 6, readiness: -8 } },
        failure: { self: { approval: -8, readiness: -12, unrest: 5 } } } }),

  o('combined-arms-push', 'Combined-Arms Push', 'Guns, then armour, then infantry, then the guns again. Slow, expensive, and the way it is actually done.',
    { offensive: { intent: 'break', share: 0.45 }, prefers: ['plain', 'forest', 'river'],
      cost: { pctGdp: 0.8 }, situational: ['war', 'warStalled', 'warWinning'],
      effects: { success: { self: { approval: 4, readiness: -6 } },
        failure: { self: { approval: -6, readiness: -9 } } } }),

  o('infiltration-attack', 'Infiltrate Their Positions', 'Small groups, at night, through the gaps. Nobody notices until the second line is gone.',
    { offensive: { intent: 'break', share: 0.2 }, prefers: ['forest', 'mountain', 'urban'],
      cost: { pctGdp: 0.35 }, pc: 2, baseSuccess: 0.62, situational: ['war', 'warStalled', 'warLosing'],
      effects: { success: { self: { approval: 3 } }, failure: { self: { readiness: -5 } } } }),

  o('mountain-offensive', 'Force the Passes', 'Three roads, all of them covered, and no way round any of them.',
    { offensive: { intent: 'break', share: 0.5, pressure: 0.9 }, prefers: ['mountain'],
      cost: { pctGdp: 0.7 }, baseSuccess: 0.5, situational: ['war', 'warStalled'],
      effects: { success: { self: { approval: 7, readiness: -9 } },
        failure: { self: { approval: -9, readiness: -12, unrest: 6 } } } }),

  o('urban-assault', 'Take the City', 'Block by block. It will cost you a corps and four months and the pictures will be terrible.',
    { offensive: { intent: 'break', share: 0.6, pressure: 0.85 }, prefers: ['urban'],
      cost: { pctGdp: 1.1 }, pc: 4, baseSuccess: 0.46, situational: ['war', 'warWinning', 'casualties'],
      effects: { success: { self: { approval: 9, readiness: -12, unrest: 3 } },
        failure: { self: { approval: -12, readiness: -15, unrest: 9 } } } }),

  o('river-crossing', 'Force the River', 'Bridging equipment, smoke, and forty minutes during which everything is on the wrong bank.',
    { offensive: { intent: 'break', share: 0.45 }, prefers: ['river'],
      cost: { pctGdp: 0.8 }, baseSuccess: 0.48, situational: ['war', 'warStalled'],
      effects: { success: { self: { approval: 6, readiness: -7 } },
        failure: { self: { approval: -9, readiness: -11, unrest: 5 } } } }),

  o('desert-envelopment', 'Go Round the Open Flank', 'There is nothing out there but sand, which is exactly why nobody is watching it.',
    { offensive: { intent: 'break', share: 0.5, pressure: 1.25 }, prefers: ['desert'],
      cost: { pctGdp: 0.85 }, baseSuccess: 0.55, situational: ['war', 'warStalled', 'warWinning'],
      effects: { success: { self: { approval: 8, readiness: -8 } },
        failure: { self: { approval: -8, readiness: -13 } } } }),

  o('probing-attack', 'Probe the Line', 'Not an offensive. A question, asked with a battalion, about where the seams are.',
    { offensive: { intent: 'break', share: 0.08, pressure: 0.4 },
      cost: { pctGdp: 0.15 }, pc: 1, risk: 'medium', baseSuccess: 0.78,
      situational: ['war', 'warStalled', 'warLosing'],
      effects: { success: { self: { readiness: -1 } }, failure: { self: { readiness: -3 } } } }),

  o('exploit-the-gap', 'Exploit the Breakthrough', 'The line is open. Everything that can move goes through it before it closes.',
    { offensive: { intent: 'break', share: 0.7, pressure: 1.5 },
      cost: { pctGdp: 1 }, pc: 4, baseSuccess: 0.6, situational: ['warWinning', 'war'],
      effects: { success: { self: { approval: 10, readiness: -10 } },
        failure: { self: { approval: -10, readiness: -16, unrest: 7 } } } }),

  // ── Grinding them down ────────────────────────────────────────────────────
  o('artillery-preparation', 'Artillery Preparation', 'Six hours of it, on a frontage of nine kilometres, and then find out what is left.',
    { offensive: { intent: 'attrit', share: 0.6, pressure: 0.8 }, prefers: ['plain', 'urban', 'river'],
      cost: { pctGdp: 0.45 }, pc: 2, risk: 'medium', baseSuccess: 0.76,
      situational: ['war', 'warStalled', 'casualties'],
      effects: { success: { self: { approval: 2 } }, failure: { self: { approval: -3 } } } }),

  o('drone-swarm', 'Saturate Them With Drones', 'Cheap, expendable, and there are more of them than there are interceptors.',
    { offensive: { intent: 'attrit', share: 0.7, pressure: 0.9 },
      cost: { pctGdp: 0.3 }, pc: 2, risk: 'medium', baseSuccess: 0.72,
      skills: [['tech', 0.2], ['readiness', 0.1]],
      situational: ['war', 'warStalled', 'techLead', 'warLosing'],
      effects: { success: { self: { approval: 3 } }, failure: { self: { influence: -2 } } } }),

  o('counter-battery-duel', 'Fight the Counter-Battery War', 'Their guns or yours. Whoever finds the other first stops being shelled.',
    { offensive: { intent: 'attrit', share: 0.5 }, prefers: ['plain', 'forest', 'river'],
      cost: { pctGdp: 0.4 }, pc: 2, risk: 'medium', baseSuccess: 0.68,
      skills: [['tech', 0.18], ['military', 0.12]],
      situational: ['war', 'warStalled', 'casualties'],
      effects: { success: { self: { readiness: 3 } }, failure: { self: { readiness: -6 } } } }),

  o('siege-lines', 'Invest the Sector', 'Not an assault. A ring, and a winter, and a supply situation that gets worse every week.',
    { offensive: { intent: 'attrit', share: 0.55, pressure: 0.6 }, prefers: ['urban', 'mountain'],
      cost: { pctGdp: 0.5 }, risk: 'medium', baseSuccess: 0.7,
      situational: ['war', 'warStalled', 'warWinning'],
      effects: { success: { self: { approval: 2 } }, failure: { self: { approval: -4, unrest: 3 } } } }),

  o('fortify-the-sector', 'Dig In Across the Sector', 'Nothing takes ground. It makes the ground cost more than it is worth to take.',
    { offensive: { intent: 'hold', share: 0.4, pressure: 0.7 },
      cost: { pctGdp: 0.3 }, pc: 2, risk: 'medium', baseSuccess: 0.8,
      situational: ['war', 'warLosing', 'occupied', 'warStalled'],
      effects: { success: { self: { approval: 2 } }, failure: { self: { unrest: 2 } } } }),

  // ── Reaching past the line ────────────────────────────────────────────────
  o('missile-salvo', 'Fire a Salvo', 'Everything the launchers hold, at the four targets that matter, in ninety seconds.',
    { offensive: { intent: 'strike', share: 0.75, pressure: 1.1 },
      cost: { pctGdp: 0.55 }, pc: 3, baseSuccess: 0.7,
      skills: [['tech', 0.22]],
      situational: ['war', 'warStalled', 'warLosing', 'brink', 'nuclear'],
      effects: { success: { self: { approval: 5 }, worldTension: 6 },
        failure: { self: { approval: -5, influence: -3 }, worldTension: 4 } } }),

  o('sead-campaign', 'Roll Back the Air Defence', 'Nothing else in the air campaign is possible until this is done, and it is done by losing aircraft.',
    { offensive: { intent: 'strike', share: 0.6 }, prefers: ['air'],
      cost: { pctGdp: 0.75 }, pc: 3, baseSuccess: 0.58,
      skills: [['tech', 0.24], ['readiness', 0.1]],
      situational: ['war', 'techLead', 'warStalled'],
      effects: { success: { self: { readiness: 4 } }, failure: { self: { readiness: -8, approval: -5 } } } }),

  o('interdiction-campaign', 'Cut the Roads Behind Them', 'Bridges, junctions, marshalling yards. The front starves without anybody firing at it.',
    { offensive: { intent: 'strike', share: 0.5, pressure: 0.9 }, prefers: ['air', 'plain'],
      cost: { pctGdp: 0.55 }, risk: 'medium', baseSuccess: 0.66,
      situational: ['war', 'warStalled', 'warWinning'],
      effects: { success: { self: { approval: 3 } }, failure: { self: { readiness: -5 } } } }),

  o('decapitation-strike', 'Strike the Command Chain', 'Headquarters, communications, the three people who can authorise a counter-attack.',
    { offensive: { intent: 'strike', share: 0.45, pressure: 1.3 },
      cost: { pctGdp: 0.6 }, pc: 4, baseSuccess: 0.42,
      skills: [['tech', 0.26], ['readiness', 0.12]],
      situational: ['war', 'warStalled', 'brink', 'escalation'],
      effects: { success: { self: { approval: 8 }, worldTension: 8 },
        failure: { self: { approval: -7, influence: -5 }, worldTension: 10 } } }),

  o('special-raid', 'Send the Quiet People', 'Forty of them, one night, and either it changes the sector or none of them come back.',
    { offensive: { intent: 'break', share: 0.35 }, prefers: ['mountain', 'urban', 'forest'],
      cost: { pctGdp: 0.25 }, pc: 3, baseSuccess: 0.5,
      skills: [['readiness', 0.26], ['tech', 0.1]],
      situational: ['war', 'warStalled', 'warLosing'],
      effects: { success: { self: { approval: 6 } }, failure: { self: { approval: -4, readiness: -3 } } } }),

  // ── The sea, and getting off it ───────────────────────────────────────────
  o('naval-interdiction', 'Close Their Sea Lanes', 'Nothing reaches them by water. It is not a battle, it is a bookkeeping exercise with submarines.',
    { offensive: { intent: 'reach', share: 0.6, pressure: 0.9 }, prefers: ['sea', 'littoral'],
      cost: { pctGdp: 0.7 }, pc: 3, risk: 'medium', baseSuccess: 0.64,
      skills: [['military', 0.16], ['tech', 0.14]],
      situational: ['war', 'maritime', 'warStalled'],
      effects: { success: { self: { approval: 4 }, worldTension: 5 },
        failure: { self: { readiness: -6, influence: -3 } } } }),

  o('carrier-strike', 'Put the Fleet Off Their Coast', 'Everything a carrier group can reach, every day, until somebody moves.',
    { offensive: { intent: 'reach', share: 0.7, pressure: 1.15 }, prefers: ['littoral', 'sea'],
      cost: { pctGdp: 1.2 }, pc: 4, baseSuccess: 0.56,
      skills: [['military', 0.2], ['tech', 0.14]],
      situational: ['war', 'maritime', 'strongArmy', 'warStalled'],
      effects: { success: { self: { approval: 7 }, worldTension: 7 },
        failure: { self: { approval: -8, readiness: -10 }, worldTension: 5 } } }),

  o('shore-assault', 'Put a Corps Ashore Here', 'The chosen beach, at the chosen hour, with everything that can float behind it.',
    { offensive: { intent: 'reach', share: 0.65, pressure: 1.4 }, prefers: ['littoral'],
      cost: { pctGdp: 1.5 }, pc: 4, baseSuccess: 0.44,
      skills: [['military', 0.18], ['readiness', 0.2], ['tech', 0.1]],
      situational: ['war', 'maritime', 'warStalled', 'warWinning'],
      effects: { success: { self: { approval: 9, readiness: -9 } },
        failure: { self: { approval: -13, readiness: -16, unrest: 8 } } } }),
];

/** The operations that suit a given kind of ground, best first. */
export function offensivesFor(terrainId) {
  return OFFENSIVES.filter((op) => !op.prefers || op.prefers.includes(terrainId));
}

export const OFFENSIVES_BY_ID = Object.fromEntries(OFFENSIVES.map((op) => [op.id, op]));
