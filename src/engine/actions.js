// The order catalogue. Every entry is a thing a head of state can plausibly
// order in a quarter, priced in money and political capital, with outcomes that
// depend on the country's actual stats rather than a flat dice roll.
//
// cost.pctGdp is a percentage of ANNUAL GDP; cost.flat is in billions USD.
// Orders are paid out of cash *plus* the country's credit line, so a deficit
// is a problem to manage rather than a state with no legal moves.
// skills shift the success chance: weight is the swing between a stat of 0 and 100.

import { NATIONS_BY_ID } from '../data/nations.js';
import { availableFunds } from './finance.js';
import { getRelation } from './state.js';
import { neighboursOf } from './territory.js';
import { threatOf } from './coalitions.js';
import { QUICK_ORDERS } from './quickorders.js';

export const CATEGORIES = [
  { id: 'quick', name: 'Quick', icon: '⚡', synthetic: true },
  { id: 'economy', name: 'Economy', icon: '₴' },
  { id: 'military', name: 'Military', icon: '⚔' },
  { id: 'diplomacy', name: 'Diplomacy', icon: '⚖' },
  { id: 'domestic', name: 'Domestic', icon: '⌂' },
  { id: 'intelligence', name: 'Intelligence', icon: '◈' },
  { id: 'technology', name: 'Technology', icon: '⚛' },
  // Only offered while there is a war to run.
  { id: 'war', name: 'War room', icon: '✦', wartimeOnly: true },
];

export const ACTIONS = [
  // ─── Economy ──────────────────────────────────────────────────────────────
  {
    id: 'stimulus',
    name: 'Fiscal Stimulus',
    category: 'economy',
    blurb: 'Push money into the real economy now and worry about the deficit later.',
    cost: { pctGdp: 1.8 }, pc: 2, target: 'none', baseSuccess: 0.78, risk: 'low',
    skills: [['stability', 0.12]],
    effects: {
      success: {
        self: { approval: 4, unrest: -3 },
        modifier: { label: 'Stimulus flowing', turns: 4, growth: 0.35 },
      },
      failure: { self: { approval: -2, unrest: 2 }, modifier: { label: 'Inflation spike', turns: 3, growth: -0.2, unrest: 1.5 } },
    },
  },
  {
    id: 'infrastructure',
    name: 'National Infrastructure Programme',
    category: 'economy',
    blurb: 'Ports, grid, rail. Slow to pay off, hard to reverse, popular in the meantime.',
    cost: { pctGdp: 2.4 }, pc: 2, target: 'none', baseSuccess: 0.74, risk: 'low',
    skills: [['stability', 0.14], ['tech', 0.1]],
    effects: {
      success: {
        self: { approval: 3, unrest: -2 },
        modifier: { label: 'Infrastructure build-out', turns: 8, growth: 0.28 },
      },
      failure: { self: { approval: -3, unrest: 3 }, modifier: { label: 'Stalled megaprojects', turns: 4, growth: -0.1 } },
    },
  },
  {
    id: 'trade-deal',
    name: 'Negotiate Trade Agreement',
    category: 'economy',
    blurb: 'Tariff schedules and market access, in exchange for a friendlier neighbour.',
    cost: { pctGdp: 0.25 }, pc: 2, target: 'nation', baseSuccess: 0.6, risk: 'low',
    skills: [['influence', 0.2]], relationFloor: -40,
    effects: {
      success: {
        self: { influence: 2 }, target: { influence: 1 }, relation: 14,
        modifier: { label: 'Trade agreement', turns: 10, growth: 0.2 },
        targetModifier: { label: 'Trade agreement', turns: 10, growth: 0.15 },
      },
      failure: { relation: -4, self: { approval: -1 } },
    },
  },
  {
    id: 'sanctions',
    name: 'Impose Sanctions',
    category: 'economy',
    blurb: 'Cut them out of your market and your banking system. Expect the same back.',
    cost: { pctGdp: 0.35 }, pc: 3, target: 'nation', baseSuccess: 0.72, risk: 'medium',
    skills: [['influence', 0.22]], tension: 5,
    effects: {
      success: {
        target: { unrest: 4, stability: -2 }, relation: -22, worldTension: 5,
        targetModifier: { label: 'Under sanctions', turns: 8, growth: -0.4, unrest: 0.6 },
        modifier: { label: 'Lost export market', turns: 4, growth: -0.08 },
      },
      failure: {
        relation: -14, worldTension: 3, self: { influence: -2 },
        modifier: { label: 'Sanctions evaded', turns: 3, growth: -0.12 },
      },
    },
  },
  {
    id: 'industrial-policy',
    name: 'Strategic Industry Subsidies',
    category: 'economy',
    blurb: 'Pick winners: steel, batteries, shipbuilding, whatever you cannot afford to import.',
    cost: { pctGdp: 1.6 }, pc: 2, target: 'none', baseSuccess: 0.7, risk: 'low',
    skills: [['tech', 0.18], ['stability', 0.08]],
    effects: {
      success: { self: { tech: 2 }, modifier: { label: 'Industrial policy', turns: 6, growth: 0.22 } },
      failure: { self: { approval: -2 }, modifier: { label: 'Subsidy waste', turns: 3, growth: -0.1 } },
    },
  },
  {
    id: 'energy-security',
    name: 'Energy Security Drive',
    category: 'economy',
    blurb: 'Diversify supply, fill the reserves, insulate yourself from the next price shock.',
    cost: { pctGdp: 1.3 }, pc: 2, target: 'none', baseSuccess: 0.75, risk: 'low',
    skills: [['tech', 0.12], ['influence', 0.08]],
    effects: {
      success: {
        self: { stability: 2, unrest: -2 },
        modifier: { label: 'Energy resilience', turns: 8, growth: 0.15, unrest: -0.4 },
      },
      failure: { self: { approval: -2 } },
    },
  },
  {
    id: 'austerity',
    name: 'Fiscal Consolidation',
    category: 'economy',
    blurb: 'Rebuild the treasury by cutting. The bond market will love you; nobody else will.',
    cost: { pctGdp: 0 }, pc: 3, target: 'none', baseSuccess: 0.8, risk: 'medium',
    skills: [['stability', 0.16]],
    effects: {
      success: {
        self: { treasuryPctGdp: 2.2, unrest: 5, approval: -5 },
        modifier: { label: 'Austerity budget', turns: 4, growth: -0.12 },
      },
      failure: { self: { treasuryPctGdp: 0.8, unrest: 9, approval: -8, stability: -3 } },
      backfire: { self: { unrest: 15, approval: -12, stability: -6 }, modifier: { label: 'General strike', turns: 3, growth: -0.35, unrest: 2 } },
    },
  },

  // ─── Military ─────────────────────────────────────────────────────────────
  {
    id: 'rearm',
    name: 'Accelerated Rearmament',
    category: 'military',
    blurb: 'Orders placed, lines restarted, recruitment targets raised.',
    cost: { pctGdp: 2.2 }, pc: 2, target: 'none', baseSuccess: 0.8, risk: 'low',
    skills: [['tech', 0.14]], tension: 2,
    effects: {
      success: { self: { military: 3, readiness: 2 }, worldTension: 2 },
      failure: { self: { military: 1 }, modifier: { label: 'Procurement scandal', turns: 3, growth: -0.08 } },
    },
  },
  {
    id: 'exercises',
    name: 'Large-Scale Exercises',
    category: 'military',
    blurb: 'Move the formations, fly the sorties, let the neighbours watch.',
    cost: { pctGdp: 0.5 }, pc: 1, target: 'none', baseSuccess: 0.85, risk: 'low',
    skills: [['readiness', 0.1]], tension: 3,
    effects: {
      success: { self: { readiness: 5 }, worldTension: 3 },
      failure: { self: { readiness: 1, approval: -1 }, worldTension: 2 },
    },
  },
  {
    id: 'forward-deploy',
    name: 'Forward Deployment',
    category: 'military',
    blurb: 'Put forces where an adversary has to account for them. Signals resolve; invites incidents.',
    cost: { pctGdp: 0.9 }, pc: 3, target: 'nation', baseSuccess: 0.72, risk: 'medium',
    skills: [['readiness', 0.14], ['military', 0.12]], tension: 8,
    effects: {
      success: {
        self: { influence: 2 }, relation: -10, worldTension: 8,
        modifier: { label: 'Forward posture', turns: 5, readiness: 0.5 },
      },
      failure: { relation: -16, worldTension: 11, self: { approval: -3 } },
      backfire: { relation: -26, worldTension: 16, self: { readiness: -4, approval: -6 } },
    },
  },
  {
    id: 'arms-transfer',
    name: 'Arms Transfer',
    category: 'military',
    blurb: 'Ship them what they need. They remember it; their enemies remember it too.',
    cost: { pctGdp: 0.8 }, pc: 2, target: 'nation', baseSuccess: 0.82, risk: 'medium',
    skills: [['military', 0.12], ['influence', 0.1]], tension: 4,
    effects: {
      success: {
        target: { military: 3, readiness: 3 }, relation: 18, self: { influence: 2 }, worldTension: 4,
      },
      failure: { relation: 4, worldTension: 3, self: { approval: -2 } },
    },
  },
  {
    id: 'peacekeeping',
    name: 'Peacekeeping Deployment',
    category: 'military',
    blurb: 'Blue helmets, a mandate, and a long deployment nobody plans an exit from.',
    cost: { pctGdp: 0.7 }, pc: 2, target: 'none', baseSuccess: 0.7, risk: 'medium',
    skills: [['influence', 0.16], ['readiness', 0.1]],
    effects: {
      success: { self: { influence: 4 }, worldTension: -4 },
      failure: { self: { influence: -2, approval: -3, readiness: -2 } },
    },
  },
  {
    id: 'intervene',
    name: 'Military Intervention',
    category: 'military',
    blurb: 'Open hostilities. Everything after this is measured in casualties and quarters.',
    cost: { pctGdp: 2.8 }, pc: 5, target: 'nation', baseSuccess: 0.95, risk: 'high',
    skills: [], tension: 25, declaresWar: true, confirm: true,
    effects: {
      success: { relation: -70, worldTension: 25, self: { approval: -4, unrest: 4 } },
      failure: { relation: -60, worldTension: 20, self: { approval: -10, unrest: 8, readiness: -6 } },
    },
  },
  {
    id: 'annex-territory',
    name: 'Annex the Occupied Territory',
    category: 'war',
    blurb: 'Stop calling it an occupation. Everything your army holds becomes yours, and no peace deal gives it back.',
    cost: { pctGdp: 0.9 }, pc: 4, target: 'nation', baseSuccess: 0.72, risk: 'medium',
    skills: [['stability', 0.16], ['influence', 0.1]], requiresWar: true, confirm: true,
    warCommand: 'annex', tension: 8,
    effects: {
      success: { self: { approval: 5, unrest: 3, influence: -2 }, relation: -20, worldTension: 6 },
      failure: { self: { approval: -6, unrest: 6, influence: -4 }, relation: -10, worldTension: 4 },
    },
  },
  {
    id: 'press-advantage',
    name: 'Demand Unconditional Surrender',
    category: 'war',
    blurb: 'Refuse the negotiated end. Keep going until their government signs whatever you put in front of it.',
    cost: { pctGdp: 1.4 }, pc: 4, target: 'nation', baseSuccess: 0.62, risk: 'high',
    skills: [['military', 0.2], ['readiness', 0.16]], requiresWar: true, confirm: true,
    warCommand: 'press', tension: 10,
    warEffect: { warScore: 14, ownExhaustion: 5, casualties: 45000 },
    warEffectOnFailure: { warScore: -4, ownExhaustion: 12, casualties: 70000 },
    effects: {
      success: { self: { approval: 3, readiness: -4 }, worldTension: 8 },
      failure: { self: { approval: -8, unrest: 5, readiness: -8 }, worldTension: 6 },
    },
  },
  {
    id: 'seek-peace',
    name: 'Sue for Peace',
    category: 'war',
    blurb: 'Open a channel, accept what the front line already decided.',
    cost: { pctGdp: 0.2 }, pc: 3, target: 'nation', baseSuccess: 0.5, risk: 'low',
    skills: [['influence', 0.24]], requiresWar: true, seeksPeace: true,
    effects: {
      success: { relation: 26, worldTension: -10, self: { approval: 3 } },
      failure: { self: { approval: -4 }, relation: -4 },
    },
  },
  {
    id: 'nuclear-programme',
    name: 'Nuclear Weapons Programme',
    category: 'military',
    blurb: 'The ultimate insurance policy, and the fastest way to become everyone\'s problem.',
    cost: { pctGdp: 2.6 }, pc: 5, target: 'none', baseSuccess: 0.45, risk: 'high',
    skills: [['tech', 0.3]], tension: 18, confirm: true,
    effects: {
      success: {
        self: { nukes: 3, influence: 3 }, worldTension: 18,
        relationWithBlocs: { nato: -12 },
      },
      failure: { self: { influence: -3 }, worldTension: 12 },
      backfire: {
        self: { influence: -8, stability: -4, unrest: 6 }, worldTension: 20,
        modifier: { label: 'Proliferation sanctions', turns: 8, growth: -0.5, unrest: 0.8 },
      },
    },
  },

  // ─── Diplomacy ────────────────────────────────────────────────────────────
  {
    id: 'state-visit',
    name: 'State Visit',
    category: 'diplomacy',
    blurb: 'Handshakes, a communiqué, and a photograph that means more than the communiqué.',
    cost: { pctGdp: 0.06, flat: 0.2 }, pc: 1, target: 'nation', baseSuccess: 0.82, risk: 'low',
    skills: [['influence', 0.18]],
    effects: {
      success: { relation: 11, self: { influence: 1 } },
      failure: { relation: -3, self: { approval: -1 } },
    },
  },
  {
    id: 'defence-pact',
    name: 'Propose Defence Pact',
    category: 'diplomacy',
    blurb: 'A mutual guarantee. Binding, expensive, and read as a threat by a third party.',
    cost: { pctGdp: 0.3 }, pc: 4, target: 'nation', baseSuccess: 0.4, risk: 'medium',
    skills: [['influence', 0.3], ['military', 0.14]], relationFloor: 30, formsPact: true, tension: 6,
    effects: {
      success: { relation: 26, self: { influence: 4 }, worldTension: 6 },
      failure: { relation: -6, self: { influence: -2 } },
    },
  },
  {
    id: 'aid-package',
    name: 'Foreign Aid Package',
    category: 'diplomacy',
    blurb: 'Development money with your flag on the crates.',
    cost: { pctGdp: 0.45 }, pc: 1, target: 'nation', baseSuccess: 0.86, risk: 'low',
    skills: [['influence', 0.12]],
    effects: {
      success: {
        relation: 13, self: { influence: 2 }, target: { stability: 2, unrest: -2 },
        targetModifier: { label: 'Foreign aid inflow', turns: 4, growth: 0.12 },
      },
      failure: { relation: 3, self: { approval: -2 } },
    },
  },
  {
    id: 'multilateral',
    name: 'Multilateral Initiative',
    category: 'diplomacy',
    blurb: 'Convene the summit, chair the working group, own the communiqué.',
    cost: { pctGdp: 0.35 }, pc: 2, target: 'none', baseSuccess: 0.66, risk: 'low',
    skills: [['influence', 0.26]],
    effects: {
      success: { self: { influence: 5 }, worldTension: -5 },
      failure: { self: { influence: -2, approval: -1 } },
    },
  },
  {
    id: 'mediate',
    name: 'Mediate a Conflict',
    category: 'diplomacy',
    blurb: 'Put yourself between two shooting parties and try to be indispensable.',
    cost: { pctGdp: 0.25 }, pc: 3, target: 'none', baseSuccess: 0.5, risk: 'medium',
    skills: [['influence', 0.34], ['stability', 0.1]], mediates: true,
    effects: {
      success: { self: { influence: 7 }, worldTension: -9 },
      failure: { self: { influence: -3, approval: -2 } },
    },
  },
  {
    id: 'condemn',
    name: 'Public Condemnation',
    category: 'diplomacy',
    blurb: 'Say the thing out loud. Cheap, satisfying, and not free.',
    cost: { pctGdp: 0.02, flat: 0.1 }, pc: 1, target: 'nation', baseSuccess: 0.88, risk: 'low',
    skills: [['influence', 0.1]],
    effects: {
      success: { relation: -12, self: { influence: 1, approval: 2 } },
      failure: { relation: -10, self: { influence: -2 } },
    },
  },

  // ─── Domestic ─────────────────────────────────────────────────────────────
  {
    id: 'crackdown',
    name: 'Security Crackdown',
    category: 'domestic',
    blurb: 'Clear the squares. Buys quiet now, costs legitimacy later.',
    cost: { pctGdp: 0.4 }, pc: 2, target: 'none', baseSuccess: 0.74, risk: 'high',
    skills: [['stability', 0.16]],
    effects: {
      success: { self: { unrest: -12, stability: 2, influence: -3, approval: -2 } },
      failure: { self: { unrest: 6, stability: -3, influence: -5, approval: -5 } },
      backfire: {
        self: { unrest: 18, stability: -9, influence: -8, approval: -12 },
        modifier: { label: 'Mass protest movement', turns: 4, growth: -0.3, unrest: 2.5 },
      },
    },
  },
  {
    id: 'reform',
    name: 'Institutional Reform',
    category: 'domestic',
    blurb: 'Courts, procurement, the civil service. Unglamorous, compounding, politically expensive.',
    cost: { pctGdp: 0.9 }, pc: 3, target: 'none', baseSuccess: 0.58, risk: 'medium',
    skills: [['stability', 0.2], ['tech', 0.08]],
    effects: {
      success: {
        self: { stability: 4, unrest: -4, influence: 2 },
        modifier: { label: 'Reform dividend', turns: 8, growth: 0.18 },
      },
      failure: { self: { stability: -2, unrest: 4, approval: -4 } },
    },
  },
  {
    id: 'social-spending',
    name: 'Social Spending Expansion',
    category: 'domestic',
    blurb: 'Wages, pensions, subsidies. The most reliable way to buy a quiet quarter.',
    cost: { pctGdp: 2.0 }, pc: 2, target: 'none', baseSuccess: 0.85, risk: 'low',
    skills: [],
    effects: {
      success: { self: { approval: 8, unrest: -8, stability: 1.5 } },
      failure: { self: { approval: 2, unrest: -2 } },
    },
  },
  {
    id: 'messaging',
    name: 'National Messaging Campaign',
    category: 'domestic',
    blurb: 'Control the frame before someone else does.',
    cost: { pctGdp: 0.25 }, pc: 1, target: 'none', baseSuccess: 0.76, risk: 'medium',
    skills: [['influence', 0.14], ['tech', 0.08]],
    effects: {
      success: { self: { approval: 6, unrest: -3 } },
      failure: { self: { approval: -3, unrest: 2 } },
      backfire: { self: { approval: -9, unrest: 6, influence: -3 } },
    },
  },
  {
    id: 'mandate',
    name: 'Seek a Fresh Mandate',
    category: 'domestic',
    blurb: 'Go to the country. Win big and you can do anything; lose and you can do nothing.',
    cost: { pctGdp: 0.3 }, pc: 4, target: 'none', baseSuccess: 0.5, risk: 'high',
    skills: [['approval', 0.4], ['stability', 0.12]],
    effects: {
      success: { self: { approval: 14, stability: 7, unrest: -6 } },
      failure: { self: { approval: -10, stability: -5, unrest: 5 } },
      backfire: { self: { approval: -18, stability: -12, unrest: 12, influence: -4 } },
    },
  },

  // ─── Intelligence ─────────────────────────────────────────────────────────
  {
    id: 'espionage',
    name: 'Industrial Espionage',
    category: 'intelligence',
    blurb: 'Acquire what you cannot yet build. Denial is part of the operation.',
    cost: { pctGdp: 0.35 }, pc: 2, target: 'nation', baseSuccess: 0.6, risk: 'high',
    skills: [['tech', 0.24]], covert: true,
    effects: {
      success: { self: { tech: 3 }, modifier: { label: 'Acquired know-how', turns: 5, growth: 0.12 } },
      failure: { self: { tech: 1 } },
      backfire: { relation: -20, self: { influence: -5, approval: -3 }, worldTension: 6 },
    },
  },
  {
    id: 'cyber-op',
    name: 'Cyber Operation',
    category: 'intelligence',
    blurb: 'Get inside their networks and leave something behind.',
    cost: { pctGdp: 0.45 }, pc: 3, target: 'nation', baseSuccess: 0.58, risk: 'high',
    skills: [['tech', 0.32]], covert: true, tension: 4,
    effects: {
      success: {
        target: { readiness: -5, stability: -2 }, worldTension: 3,
        targetModifier: { label: 'Systems compromised', turns: 3, growth: -0.2 },
      },
      failure: { worldTension: 2 },
      backfire: {
        relation: -24, self: { influence: -6 }, worldTension: 10,
        modifier: { label: 'Retaliatory intrusions', turns: 4, growth: -0.18 },
      },
    },
  },
  {
    id: 'destabilise',
    name: 'Covert Destabilisation',
    category: 'intelligence',
    blurb: 'Fund the opposition, seed the narrative, wait. If it surfaces, it is a scandal for a decade.',
    cost: { pctGdp: 0.8 }, pc: 4, target: 'nation', baseSuccess: 0.45, risk: 'high',
    skills: [['influence', 0.2], ['tech', 0.16]], covert: true, tension: 6,
    effects: {
      success: {
        target: { unrest: 12, stability: -6 }, worldTension: 5,
        targetModifier: { label: 'Foreign-backed unrest', turns: 5, growth: -0.28, unrest: 1.5 },
      },
      failure: { target: { unrest: 3 }, worldTension: 3 },
      backfire: {
        relation: -34, self: { influence: -9, approval: -6 }, worldTension: 14,
        target: { stability: 4, unrest: -4 },
      },
    },
  },
  {
    id: 'counter-intel',
    name: 'Counter-Intelligence Sweep',
    category: 'intelligence',
    blurb: 'Roll up the networks operating inside your own institutions.',
    cost: { pctGdp: 0.4 }, pc: 1, target: 'none', baseSuccess: 0.72, risk: 'low',
    skills: [['tech', 0.2], ['stability', 0.1]],
    effects: {
      success: {
        self: { stability: 3, unrest: -2 },
        modifier: { label: 'Hardened services', turns: 6, stability: 0.4 },
      },
      failure: { self: { approval: -2, unrest: 2 } },
    },
  },

  // ─── Technology ───────────────────────────────────────────────────────────
  {
    id: 'rnd-push',
    name: 'National R&D Push',
    category: 'technology',
    blurb: 'Fund the labs, the grants, the graduate pipeline.',
    cost: { pctGdp: 1.7 }, pc: 2, target: 'none', baseSuccess: 0.78, risk: 'low',
    skills: [['tech', 0.2]],
    effects: {
      success: { self: { tech: 4 }, modifier: { label: 'Research surge', turns: 6, growth: 0.16 } },
      failure: { self: { tech: 1 } },
    },
  },
  {
    id: 'compute-programme',
    name: 'Frontier Compute Programme',
    category: 'technology',
    blurb: 'Buy the accelerators, build the datacentres, hoard the power contracts.',
    cost: { pctGdp: 2.1 }, pc: 3, target: 'none', baseSuccess: 0.62, risk: 'medium',
    skills: [['tech', 0.3]],
    effects: {
      success: {
        self: { tech: 6, influence: 2 },
        modifier: { label: 'Compute advantage', turns: 8, growth: 0.3 },
      },
      failure: { self: { tech: 1, approval: -2 }, modifier: { label: 'Stranded datacentres', turns: 3, growth: -0.15 } },
    },
  },
  {
    id: 'space-programme',
    name: 'Space Programme',
    category: 'technology',
    blurb: 'Launch capacity, sovereign satellites, and a flag on the evening news.',
    cost: { pctGdp: 1.5 }, pc: 2, target: 'none', baseSuccess: 0.66, risk: 'medium',
    skills: [['tech', 0.26]],
    effects: {
      success: { self: { tech: 3, influence: 4, approval: 3, readiness: 2 } },
      failure: { self: { tech: 1, approval: -3 } },
    },
  },
  {
    id: 'semiconductors',
    name: 'Semiconductor Self-Sufficiency',
    category: 'technology',
    blurb: 'Fabs of your own, at almost any price, because the alternative is dependence.',
    cost: { pctGdp: 2.5 }, pc: 3, target: 'none', baseSuccess: 0.55, risk: 'medium',
    skills: [['tech', 0.36]],
    effects: {
      success: {
        self: { tech: 7 },
        modifier: { label: 'Domestic fabrication', turns: 10, growth: 0.26 },
      },
      failure: { self: { tech: 2 }, modifier: { label: 'Fab overruns', turns: 4, growth: -0.2 } },
    },
  },

  // ─── Quick orders ─────────────────────────────────────────────────────────
  // Cheap, one point of political capital, no target. For turns where you want
  // to keep the budget for something else.
  {
    id: 'address-nation',
    name: 'Address the Nation',
    category: 'domestic', quick: true,
    blurb: 'Twenty minutes of airtime and a clear line. Cheap, and it buys a little room.',
    cost: { pctGdp: 0.03, flat: 0.05 }, pc: 1, target: 'none', baseSuccess: 0.8, risk: 'low',
    skills: [['approval', 0.16], ['influence', 0.08]],
    effects: {
      success: { self: { approval: 4, unrest: -2 } },
      failure: { self: { approval: -2, unrest: 1 } },
    },
  },
  {
    id: 'emergency-cabinet',
    name: 'Emergency Cabinet',
    category: 'domestic', quick: true,
    blurb: 'Pull the department heads into one room and force a decision out of them.',
    cost: { pctGdp: 0.05 }, pc: 1, target: 'none', baseSuccess: 0.75, risk: 'low',
    skills: [['stability', 0.18]],
    effects: {
      success: { self: { stability: 3, unrest: -2 } },
      failure: { self: { approval: -1 } },
    },
  },
  {
    id: 'currency-intervention',
    name: 'Currency Intervention',
    category: 'economy', quick: true,
    blurb: 'Lean on the exchange rate. Fast, technical, and only ever a holding measure.',
    cost: { pctGdp: 0.35 }, pc: 1, target: 'none', baseSuccess: 0.66, risk: 'medium',
    skills: [['stability', 0.14], ['tech', 0.08]],
    effects: {
      success: { modifier: { label: 'Stabilised currency', turns: 3, growth: 0.16 }, self: { unrest: -1 } },
      failure: { self: { treasuryPctGdp: -0.3, approval: -2 } },
    },
  },
  {
    id: 'recall-ambassador',
    name: 'Recall Your Ambassador',
    category: 'diplomacy', quick: true,
    blurb: 'A signal that costs nothing but says exactly one thing.',
    cost: { pctGdp: 0.01, flat: 0.05 }, pc: 1, target: 'nation', baseSuccess: 0.9, risk: 'low',
    skills: [],
    effects: {
      success: { relation: -9, self: { approval: 2 }, worldTension: 2 },
      failure: { relation: -6, self: { influence: -1 } },
    },
  },
  {
    id: 'intelligence-review',
    name: 'Intelligence Review',
    category: 'intelligence', quick: true,
    blurb: 'Make the agencies actually talk to each other for one week.',
    cost: { pctGdp: 0.08 }, pc: 1, target: 'none', baseSuccess: 0.78, risk: 'low',
    skills: [['tech', 0.14]],
    effects: {
      success: { self: { stability: 2, readiness: 2 } },
      failure: { self: { approval: -1 } },
    },
  },
  {
    id: 'border-controls',
    name: 'Tighten Border Controls',
    category: 'domestic', quick: true,
    blurb: 'Popular at home, expensive with the neighbours, and it does work in the short run.',
    cost: { pctGdp: 0.25 }, pc: 1, target: 'none', baseSuccess: 0.8, risk: 'low',
    skills: [['stability', 0.1]],
    effects: {
      success: { self: { unrest: -4, approval: 3, influence: -2 } },
      failure: { self: { unrest: 2, approval: -2 } },
    },
  },

  {
    id: 'disaster-relief',
    name: 'Emergency Relief Operation',
    category: 'domestic', quick: true,
    blurb: 'Helicopters, field hospitals, and a minister on the ground before the cameras leave.',
    cost: { pctGdp: 0.3 }, pc: 1, target: 'none', baseSuccess: 0.82, risk: 'low',
    skills: [['stability', 0.14], ['tech', 0.06]],
    situational: ['disaster', 'epidemic', 'accident'],
    effects: {
      success: { self: { approval: 7, unrest: -5, stability: 2 } },
      failure: { self: { approval: -5, unrest: 3 } },
    },
  },
  {
    id: 'curfew',
    name: 'Impose a Curfew',
    category: 'domestic', quick: true,
    blurb: 'Clears the streets tonight. Fills them again next month.',
    cost: { pctGdp: 0.06 }, pc: 1, target: 'none', baseSuccess: 0.76, risk: 'medium',
    skills: [['stability', 0.16]],
    situational: ['unrest'],
    effects: {
      success: { self: { unrest: -9, stability: 2, approval: -2 } },
      failure: { self: { unrest: 6, approval: -6, stability: -3 } },
    },
  },
  {
    id: 'price-controls',
    name: 'Cap Staple Prices',
    category: 'economy', quick: true,
    blurb: 'Freeze the price of bread and fuel. Popular immediately, expensive shortly afterwards.',
    cost: { pctGdp: 0.4 }, pc: 1, target: 'none', baseSuccess: 0.8, risk: 'medium',
    skills: [['stability', 0.1]],
    situational: ['unrest', 'inflation'],
    effects: {
      success: { self: { unrest: -6, approval: 5 }, modifier: { label: 'Price controls', turns: 4, growth: -0.12 } },
      failure: { self: { unrest: 3, approval: -3 }, modifier: { label: 'Shortages', turns: 3, growth: -0.25, unrest: 1 } },
    },
  },
  {
    id: 'draw-reserves',
    name: 'Draw on the Reserves',
    category: 'economy', quick: true,
    blurb: 'Sell down the sovereign fund to cover the quarter. It buys time and nothing else.',
    cost: { pctGdp: 0 }, pc: 1, target: 'none', baseSuccess: 0.88, risk: 'low',
    skills: [['stability', 0.1]],
    situational: ['debt'],
    effects: {
      success: { self: { treasuryPctGdp: 2.2, influence: -1 } },
      failure: { self: { treasuryPctGdp: 0.8, approval: -3, influence: -2 } },
    },
  },
  {
    id: 'emergency-budget',
    name: 'Emergency Budget',
    category: 'economy', quick: true,
    blurb: 'Reopen the books mid-year and cut what can be cut. Nobody thanks you for it.',
    cost: { pctGdp: 0 }, pc: 2, target: 'none', baseSuccess: 0.72, risk: 'medium',
    skills: [['stability', 0.18]],
    situational: ['debt'],
    effects: {
      success: { self: { treasuryPctGdp: 1.4, approval: -5, unrest: 3 }, modifier: { label: 'Fiscal consolidation', turns: 4, growth: -0.1, revenue: 0 } },
      failure: { self: { approval: -9, unrest: 6 } },
    },
  },
  {
    id: 'reinforce-front',
    name: 'Reinforce the Front',
    category: 'military', quick: true,
    blurb: 'Everything on rails, moving east, tonight. Not a plan — a stopgap.',
    cost: { pctGdp: 0.5 }, pc: 1, target: 'none', baseSuccess: 0.8, risk: 'low',
    skills: [['readiness', 0.18]],
    situational: ['war'], requiresWar: true,
    warEffect: { warScore: 6, ownExhaustion: 3, casualties: 9000 },
    effects: {
      success: { self: { readiness: 3, approval: 2 } },
      failure: { self: { readiness: -3, unrest: 2 } },
    },
  },
  {
    id: 'recognise-state',
    name: 'Recognise the New State',
    category: 'diplomacy', quick: true,
    blurb: 'Be first through the door. Cheap, and it buys a friendship nobody else has yet.',
    cost: { pctGdp: 0.04 }, pc: 1, target: 'nation', baseSuccess: 0.85, risk: 'low',
    skills: [['influence', 0.14]],
    situational: ['newState'],
    effects: {
      success: { relation: 30, self: { influence: 2 }, worldTension: 2 },
      failure: { relation: 8, self: { influence: -1 } },
    },
  },
  {
    id: 'close-border',
    name: 'Close the Border',
    category: 'domestic', quick: true,
    blurb: 'Shut the crossings with whatever is happening next door before it walks in.',
    cost: { pctGdp: 0.2 }, pc: 1, target: 'nation', baseSuccess: 0.84, risk: 'low',
    skills: [['stability', 0.12]],
    situational: ['neighbourCrisis', 'epidemic'],
    effects: {
      success: { self: { unrest: -3, approval: 4 }, relation: -12 },
      failure: { self: { unrest: 2, approval: -2 }, relation: -8 },
    },
  },
  {
    id: 'raise-alert',
    name: 'Raise the Alert State',
    category: 'military', quick: true,
    blurb: 'Leave and cancel, everyone back to their units. It is read everywhere as a message.',
    cost: { pctGdp: 0.22 }, pc: 1, target: 'none', baseSuccess: 0.86, risk: 'low',
    skills: [['readiness', 0.16]],
    situational: ['escalation', 'tension'],
    effects: {
      success: { self: { readiness: 6, approval: 1 }, worldTension: 3 },
      failure: { self: { readiness: 2, unrest: 2 }, worldTension: 4 },
    },
  },
  {
    id: 'back-channel',
    name: 'Open a Back Channel',
    category: 'diplomacy', quick: true,
    blurb: 'One trusted person, one unminuted meeting. The cheapest way down a ladder.',
    cost: { pctGdp: 0.05 }, pc: 1, target: 'nation', baseSuccess: 0.68, risk: 'low',
    skills: [['influence', 0.2]],
    situational: ['escalation'],
    effects: {
      success: { relation: 14, worldTension: -4, self: { influence: 1 } },
      failure: { relation: -3, self: { approval: -1 } },
    },
  },
  {
    id: 'state-funeral',
    name: 'Lead the National Mourning',
    category: 'domestic', quick: true,
    blurb: 'Be the person who says the right thing on the worst day. It is not nothing.',
    cost: { pctGdp: 0.03 }, pc: 1, target: 'none', baseSuccess: 0.86, risk: 'low',
    skills: [['approval', 0.14]],
    situational: ['casualties'],
    effects: {
      success: { self: { approval: 6, unrest: -3, stability: 1 } },
      failure: { self: { approval: -4, unrest: 2 } },
    },
  },
  {
    id: 'blame-foreigners',
    name: 'Name a Foreign Hand',
    category: 'domestic', quick: true,
    blurb: 'Point at somebody abroad. It works at home, and it costs you abroad.',
    cost: { pctGdp: 0.02 }, pc: 1, target: 'nation', baseSuccess: 0.74, risk: 'medium',
    skills: [['approval', 0.1], ['influence', 0.06]],
    situational: ['unrest', 'escalation'],
    effects: {
      success: { self: { approval: 6, unrest: -4 }, relation: -16, worldTension: 4 },
      failure: { self: { approval: -5, unrest: 4, influence: -2 }, relation: -10, worldTension: 3 },
    },
  },

  // ─── More ways to grow ────────────────────────────────────────────────────
  {
    id: 'deregulate',
    name: 'Deregulation Package',
    category: 'economy',
    blurb: 'Strip out the permitting and the paperwork. Growth now, grievances later.',
    cost: { pctGdp: 0.3 }, pc: 3, target: 'none', baseSuccess: 0.7, risk: 'medium',
    skills: [['stability', 0.14]],
    effects: {
      success: {
        self: { unrest: 3, stability: -1 },
        modifier: { label: 'Deregulated economy', turns: 8, growth: 0.3 },
      },
      failure: { self: { unrest: 5, approval: -4, stability: -2 } },
    },
  },
  {
    id: 'special-zones',
    name: 'Special Economic Zones',
    category: 'economy',
    blurb: 'Carve out territory with its own rules and let foreign capital in.',
    cost: { pctGdp: 1.2 }, pc: 2, target: 'none', baseSuccess: 0.72, risk: 'low',
    skills: [['tech', 0.12], ['influence', 0.1]],
    effects: {
      success: {
        self: { influence: 2, tech: 1 },
        modifier: { label: 'Special economic zones', turns: 10, growth: 0.24 },
      },
      failure: { self: { approval: -2 }, modifier: { label: 'Empty industrial parks', turns: 4, growth: -0.1 } },
    },
  },
  {
    id: 'labour-markets',
    name: 'Open the Labour Market',
    category: 'economy',
    blurb: 'Let people in to do the work nobody at home will. It grows the economy and the argument.',
    cost: { pctGdp: 0.4 }, pc: 3, target: 'none', baseSuccess: 0.68, risk: 'medium',
    skills: [['stability', 0.16]],
    effects: {
      success: {
        self: { unrest: 4, population: 0.6 },
        modifier: { label: 'Labour inflow', turns: 10, growth: 0.26 },
      },
      failure: { self: { unrest: 7, approval: -5 } },
    },
  },
  {
    id: 'tourism-push',
    name: 'Open to the World',
    category: 'economy',
    blurb: 'Visas, flights, festivals. Modest money, and everyone thinks better of you afterwards.',
    cost: { pctGdp: 0.5 }, pc: 1, target: 'none', baseSuccess: 0.8, risk: 'low',
    skills: [['influence', 0.14], ['stability', 0.08]],
    effects: {
      success: {
        self: { influence: 3, approval: 2 },
        modifier: { label: 'Visitor economy', turns: 8, growth: 0.14 },
      },
      failure: { self: { approval: -1 } },
    },
  },
  {
    id: 'sovereign-fund',
    name: 'Sovereign Wealth Fund',
    category: 'economy',
    blurb: 'Put today\u2019s surplus somewhere it earns. Dull, slow, and it compounds.',
    cost: { pctGdp: 1.5 }, pc: 2, target: 'none', baseSuccess: 0.76, risk: 'low',
    skills: [['stability', 0.16], ['tech', 0.06]],
    effects: {
      success: { modifier: { label: 'Sovereign fund returns', turns: 12, growth: 0.1, revenue: 6 }, self: { influence: 2 } },
      failure: { self: { approval: -2 } },
    },
  },
  {
    id: 'debt-restructure',
    name: 'Restructure the Debt',
    category: 'economy',
    blurb: 'Go to your creditors and reopen the terms. It clears the books and costs you standing.',
    cost: { pctGdp: 0 }, pc: 4, target: 'none', baseSuccess: 0.6, risk: 'high',
    skills: [['influence', 0.22], ['stability', 0.14]],
    effects: {
      success: {
        self: { treasuryPctGdp: 3, influence: -4 },
        modifier: { label: 'Restructured debt', turns: 6, growth: -0.1 },
      },
      failure: { self: { influence: -6, approval: -4 }, modifier: { label: 'Failed restructuring', turns: 4, growth: -0.3 } },
      backfire: {
        self: { influence: -10, approval: -8, stability: -4 },
        modifier: { label: 'Locked out of credit markets', turns: 8, growth: -0.5 },
      },
    },
  },

  // ─── War room (only while fighting) ───────────────────────────────────────
  {
    id: 'offensive',
    name: 'Major Offensive',
    category: 'war',
    blurb: 'Commit the reserves and push. It moves the front, and it fills the hospitals.',
    cost: { pctGdp: 1.6 }, pc: 3, target: 'nation', baseSuccess: 0.6, risk: 'high',
    skills: [['readiness', 0.22], ['military', 0.18]], requiresWar: true,
    warEffect: { warScore: 16, ownExhaustion: 7, casualties: 40000 },
    warEffectOnFailure: { warScore: -6, ownExhaustion: 11, casualties: 55000 },
    effects: {
      success: { self: { readiness: -4, approval: 4 }, worldTension: 3 },
      failure: { self: { readiness: -8, approval: -6, unrest: 4 } },
    },
  },
  {
    id: 'hold-line',
    name: 'Hold the Line',
    category: 'war',
    blurb: 'Dig in, shorten the front, and make them pay for every metre.',
    cost: { pctGdp: 0.8 }, pc: 1, target: 'nation', baseSuccess: 0.78, risk: 'low',
    skills: [['readiness', 0.16], ['stability', 0.1]], requiresWar: true,
    warEffect: { warScore: 5, ownExhaustion: -6, enemyExhaustion: 4, casualties: 12000 },
    effects: {
      success: { self: { readiness: 2 } },
      failure: { self: { readiness: -3, unrest: 2 } },
    },
  },
  {
    id: 'mobilise',
    name: 'General Mobilisation',
    category: 'war',
    blurb: 'Call up the reserves. You get an army; you also get every family in the country involved.',
    cost: { pctGdp: 1.4 }, pc: 3, target: 'none', baseSuccess: 0.82, risk: 'medium',
    skills: [['stability', 0.18]],
    effects: {
      success: {
        self: { military: 5, readiness: 10, unrest: 6, approval: -3 },
        modifier: { label: 'Mobilised economy', turns: 6, growth: -0.3 },
        worldTension: 5,
      },
      failure: { self: { unrest: 9, approval: -7, readiness: 3 } },
    },
  },
  {
    id: 'strike-logistics',
    name: 'Strike Their Logistics',
    category: 'war',
    blurb: 'Bridges, depots, rail junctions. Unglamorous, and it decides more battles than anything else.',
    cost: { pctGdp: 0.9 }, pc: 2, target: 'nation', baseSuccess: 0.64, risk: 'medium',
    skills: [['tech', 0.2], ['readiness', 0.14]], requiresWar: true,
    warEffect: { warScore: 9, enemyExhaustion: 8, casualties: 8000 },
    effects: {
      success: { target: { readiness: -6 }, targetModifier: { label: 'Broken supply lines', turns: 4, growth: -0.25 } },
      failure: { self: { readiness: -3 }, worldTension: 2 },
    },
  },
  {
    id: 'war-economy',
    name: 'Total War Economy',
    category: 'war',
    blurb: 'Convert the civilian industry. Everything is for the front now, including the shortages.',
    cost: { pctGdp: 0.6 }, pc: 4, target: 'none', baseSuccess: 0.7, risk: 'medium',
    skills: [['stability', 0.2], ['tech', 0.1]],
    effects: {
      success: {
        self: { military: 4, readiness: 5, unrest: 5 },
        modifier: { label: 'War economy', turns: 10, growth: -0.45, readiness: 0.6 },
      },
      failure: { self: { unrest: 8, approval: -6 }, modifier: { label: 'Botched conversion', turns: 4, growth: -0.5 } },
    },
  },
];

// The situational quick shelf lives in its own file — a hundred-odd orders
// would bury the thirty programmes that make up the rest of the catalogue.
ACTIONS.push(...QUICK_ORDERS);

export const ACTIONS_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

/** Money cost in billions USD for a given nation. */
/** The Quick tab is a view across categories, not a category of its own. */
export function actionsInCategory(categoryId, game = null) {
  if (categoryId === 'quick') {
    const quick = ACTIONS.filter((a) => a.quick);
    return game ? rankQuick(game, quick) : quick;
  }
  return ACTIONS.filter((a) => a.category === categoryId);
}

/**
 * What the world looks like right now, as a set of situation tags.
 *
 * Quick orders declare the situations they answer; this is what decides which
 * ones are on the table. With a catalogue this size the tags are what keep the
 * shelf short — an order with nothing to answer is never offered, so what you
 * see is what a chief of staff would actually have put in front of you given
 * the morning's news.
 *
 * @returns {Set<string>}
 */
export function situationTags(game) {
  const tags = new Set();
  const state = game.nations[game.playerId];
  if (!state) return tags;
  const def = NATIONS_BY_ID[game.playerId] || {};
  const tagsOf = def.tags || [];
  const add = (tag, when) => { if (when) tags.add(tag); };

  // ── At home ─────────────────────────────────────────────────────────────
  add('unrest', state.unrest > 45);
  add('boiling', state.unrest > 68);
  add('calm', state.unrest < 25);
  add('unpopular', state.approval < 42);
  add('popular', state.approval > 65);
  add('fragile', state.stability < 48);
  add('solid', state.stability > 72);

  // ── Money ───────────────────────────────────────────────────────────────
  add('debt', state.treasury < 0);
  add('tight', state.treasury >= 0 && state.treasury < state.gdp * 15);
  add('rich', state.treasury > state.gdp * 90);
  add('inflation', state.unrest > 55 && state.treasury < state.gdp * 40);
  add('stagnant', state.baseGrowth < 0.5);
  add('growing', state.baseGrowth > 1.1);

  // ── Standing ────────────────────────────────────────────────────────────
  add('tension', game.worldTension > 62);
  add('peaceful', game.worldTension < 38);
  add('isolated', state.influence < 35);
  add('influential', state.influence > 70);
  add('sanctioned', (state.sanctionedBy || []).length > 0);

  // ── Capability ──────────────────────────────────────────────────────────
  add('techLead', state.tech > 78);
  add('techLag', state.tech < 50);
  add('hollowArmy', state.readiness < 55);
  add('strongArmy', state.military > 70);
  add('weakArmy', state.military < 35);
  add('nuclear', state.nukes > 0);

  // ── Character of the country, from its own sheet ─────────────────────────
  add('energy', tagsOf.some((tg) => /energy|oil|gas|lng|opec|petro/.test(tg)));
  add('maritime', tagsOf.some((tg) => /navy|strait|entrepot|port|island|shipping/.test(tg)));
  add('agrarian', tagsOf.some((tg) => /agri|grain|breadbasket|food/.test(tg)));
  add('exporter', tagsOf.some((tg) => /export|manufactur|trade-hub/.test(tg)));
  add('resource', tagsOf.some((tg) => /rare-earth|mining|lithium|minerals|copper/.test(tg)));
  add('aging', tagsOf.includes('aging'));
  add('young', tagsOf.includes('demographic-dividend'));

  // ── War ─────────────────────────────────────────────────────────────────
  const wars = game.wars.filter(
    (w) => w.active && (w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId)),
  );
  if (wars.length) {
    tags.add('war');
    let bestScore = -999;
    let worstExhaustion = 0;
    for (const war of wars) {
      const attacking = war.attackers.includes(game.playerId);
      bestScore = Math.max(bestScore, attacking ? war.warScore : -war.warScore);
      worstExhaustion = Math.max(
        worstExhaustion,
        attacking ? war.exhaustion.attackers : war.exhaustion.defenders,
      );
      if (war.casualties > 60_000) tags.add('casualties');
      if ((war.occupied || []).some(([, , holder]) => holder === game.playerId)) tags.add('occupier');
      if ((war.occupied || []).some(([, from]) => from === game.playerId)) tags.add('occupied');
    }
    add('warWinning', bestScore > 20);
    add('warLosing', bestScore < -20);
    add('warExhausted', worstExhaustion > 55);
    add('warStalled', Math.abs(bestScore) <= 20);
  } else {
    tags.add('peace');
  }

  // ── Escalation ──────────────────────────────────────────────────────────
  for (const [key, value] of Object.entries(game.escalation || {})) {
    if (!key.includes(game.playerId)) continue;
    if (value >= 3.5) tags.add('escalation');
    if (value >= 7) tags.add('brink');
  }

  // ── The neighbourhood ───────────────────────────────────────────────────
  const neighbours = neighboursOf(game, game.playerId).filter((id) => game.nations[id]);
  for (const id of neighbours) {
    const other = game.nations[id];
    if (!other || other.sovereign === false) continue;
    if (other.stability < 40) tags.add('neighbourCrisis');
    if (getRelation(game, game.playerId, id) < -45) tags.add('hostileNeighbour');
    if (game.wars.some((w) => w.active && (w.attackers.includes(id) || w.defenders.includes(id)))) {
      tags.add('warNextDoor');
    }
  }

  // ── Whatever the last quarter actually threw at you ──────────────────────
  for (const entry of (game.log || [])) {
    if (entry.turn < game.turn - 1) continue;
    if (entry.type === 'secession') tags.add('newState');
    if (entry.type === 'conquest') tags.add('conquest');
    if (entry.type === 'territory') tags.add('borderChange');
    if (entry.type === 'nuclear') tags.add('nuclearUsed');
  }
  for (const report of (game.turnReports || []).slice(-1)) {
    for (const title of report.events || []) {
      const key = String(title).toLowerCase();
      if (/disaster|earthquake|flood|cyclone|wildfire/.test(key)) tags.add('disaster');
      if (/harvest|famine/.test(key)) tags.add('famine');
      if (/epidemic|pandemic/.test(key)) tags.add('epidemic');
      if (/accident|plant|industrial/.test(key)) tags.add('accident');
      if (/riot/.test(key)) tags.add('riot');
      if (/protest|strike/.test(key)) tags.add('unrest');
      if (/coup|junta/.test(key)) tags.add('coup');
      if (/assassination|attack|terror/.test(key)) tags.add('attack');
      if (/currency|credit|financial|market/.test(key)) tags.add('financial');
      if (/cyber|intrusion/.test(key)) tags.add('cyber');
      if (/commodity|price/.test(key)) tags.add('commodityShock');
      if (/migration|displacement|refugee/.test(key)) tags.add('refugees');
      if (/breakthrough|technolog/.test(key)) tags.add('breakthrough');
    }
  }

  // ── The world's view of you ──────────────────────────────────────────────
  const threat = threatOf(game, game.playerId);
  add('feared', threat > 0.4);
  add('pariah', threat > 0.6);

  return tags;
}

/**
 * How much each situation demands an answer this quarter.
 *
 * Without this the shelf ranks by how many boxes an order ticks, which puts a
 * jobs programme above reinforcing a collapsing front because the jobs
 * programme happened to list three situations. What matters is not how many
 * things an order is relevant to, but how loudly the loudest of them is
 * shouting.
 */
const URGENCY = {
  brink: 5, nuclearUsed: 5, boiling: 4.5, warLosing: 4.5,
  coup: 4, conquest: 4, war: 4, riot: 4, disaster: 4, epidemic: 4, famine: 4,
  debt: 3.5, occupied: 3.5, attack: 3.5,
  accident: 3, financial: 3, escalation: 3, warExhausted: 3,
  unrest: 2.5, refugees: 2.5, newState: 2.5, pariah: 2.5, warNextDoor: 2.5,
  neighbourCrisis: 2, tension: 2, sanctioned: 2, occupier: 2, warWinning: 2,
  inflation: 2, tight: 2, unpopular: 2, fragile: 2, cyber: 2,
  commodityShock: 2, feared: 2, borderChange: 1.8, hostileNeighbour: 1.8,
  casualties: 1.8, warStalled: 1.5, isolated: 1.5, techLag: 1.5,
  hollowArmy: 1.5, stagnant: 1.5, weakArmy: 1.5, breakthrough: 1.5,
};

/** Background facts about a country are never urgent on their own. */
const BACKGROUND_URGENCY = 0.5;

/** The most pressing thing an order is an answer to, for the card to say. */
export function reasonFor(action, tags) {
  if (!action.situational) return null;
  let best = null;
  let bestWeight = -1;
  for (const tag of action.situational) {
    if (!tags.has(tag)) continue;
    const weight = URGENCY[tag] ?? BACKGROUND_URGENCY;
    if (weight > bestWeight) {
      bestWeight = weight;
      best = tag;
    }
  }
  return best;
}

/**
 * Quick orders that answer something happening now, most urgent first; the
 * standing ones that always make sense after; and the ones that answer nothing
 * at all left off entirely. Deterministic — the same quarter always offers the
 * same shelf.
 */
function rankQuick(game, quick) {
  const tags = situationTags(game);
  const scored = [];

  for (const action of quick) {
    const wants = action.situational;
    if (!wants) {
      // The handful of orders that are always sensible sit at the bottom.
      scored.push({ action, score: 0 });
      continue;
    }
    const hits = wants.filter((tag) => tags.has(tag));
    // A situational order with nothing to answer is noise on the shelf.
    if (!hits.length) continue;

    const urgency = hits.reduce((sum, tag) => sum + (URGENCY[tag] ?? BACKGROUND_URGENCY), 0);
    // An order aimed squarely at what is happening beats one that lists six
    // situations and happens to catch this one.
    const precision = hits.length / wants.length;
    scored.push({ action, score: urgency + precision * 0.8 });
  }

  scored.sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id));

  // Capped, because a "quick" shelf of a hundred and twenty is not a quick
  // shelf — and spread, because eight different answers to the same flood is a
  // worse shelf than four answers to the flood and four to everything else that
  // is also happening.
  const perReason = new Map();
  const shelf = [];
  const overflow = [];
  for (const entry of scored) {
    const reason = reasonFor(entry.action, tags) || 'standing';
    const used = perReason.get(reason) || 0;
    if (used >= 4) {
      overflow.push(entry);
      continue;
    }
    perReason.set(reason, used + 1);
    shelf.push(entry);
    if (shelf.length >= SHELF_SIZE) break;
  }
  // If the world is only doing one thing, fall back to more of that one thing
  // rather than showing a short shelf.
  for (const entry of overflow) {
    if (shelf.length >= SHELF_SIZE) break;
    shelf.push(entry);
  }
  return shelf.map((entry) => entry.action);
}

/** How many quick orders the tab shows at once. */
const SHELF_SIZE = 14;

export function actionCost(action, nationState) {
  const pct = action.cost?.pctGdp || 0;
  const flat = action.cost?.flat || 0;
  return Math.round((pct / 100) * nationState.gdp * 1000 + flat);
}

/** Whether the order can even be issued this turn, and why not. */
export function actionAvailability(game, action, targetId = null) {
  const state = game.nations[game.playerId];
  const cost = actionCost(action, state);
  const funds = availableFunds(state);

  if (cost > funds) {
    return { ok: false, reason: `Beyond your credit line by $${Math.round(cost - funds)}B` };
  }
  if (action.pc > game.politicalCapital) {
    return { ok: false, reason: `Needs ${action.pc} political capital` };
  }
  if (action.target === 'nation' && !targetId) {
    return { ok: false, reason: 'Choose a target country' };
  }
  if (targetId === game.playerId) {
    return { ok: false, reason: 'Cannot target your own country' };
  }
  if (action.requiresWar && targetId) {
    const atWar = game.wars.some(
      (w) =>
        w.active &&
        ((w.attackers.includes(game.playerId) && w.defenders.includes(targetId)) ||
          (w.defenders.includes(game.playerId) && w.attackers.includes(targetId))),
    );
    if (!atWar) return { ok: false, reason: 'You are not at war with them' };
  }
  if (action.declaresWar && targetId) {
    const atWar = game.wars.some(
      (w) =>
        w.active &&
        ((w.attackers.includes(game.playerId) && w.defenders.includes(targetId)) ||
          (w.defenders.includes(game.playerId) && w.attackers.includes(targetId))),
    );
    if (atWar) return { ok: false, reason: 'Already at war with them' };
  }
  return { ok: true, reason: null };
}
