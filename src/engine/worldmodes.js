// World modes set the *character* of the world; the difficulty slider sets how
// hard it pushes back. They compose — Chaotic at difficulty 2 is a wild but
// survivable ride, Chaotic at 10 is a shredder.

import { difficultyModifiers } from './difficulty.js';

export const WORLD_MODES = [
  {
    id: 'calm',
    name: 'Stable World',
    icon: '🕊',
    blurb:
      'The post-war order holds. Crises are rare and small, nobody declares war on you out of nowhere, and money is easier to find. The best place to learn the game.',
    traits: ['Fewer crises', 'No surprise wars on you', 'Steadier economy'],
    knobs: {
      eventFrequency: 0.55,
      eventSeverity: 0.7,
      warChance: 0.35,
      relationVolatility: 0.6,
      tensionOffset: -8,
      revenueBonus: 1.15,
      blackSwans: false,
      shieldPlayer: true,
      scrambleRelations: 0,
    },
  },
  {
    id: 'current',
    name: 'Current World',
    icon: '🌍',
    blurb:
      'The world as it actually stands at the start of 2026: real economies, real alliances, real grievances. Events follow from the situation rather than from dice.',
    traits: ['Real 2026 baseline', 'Grounded events', 'Balanced pacing'],
    knobs: {
      eventFrequency: 1,
      eventSeverity: 1,
      warChance: 1,
      relationVolatility: 1,
      tensionOffset: 0,
      revenueBonus: 1,
      blackSwans: false,
      shieldPlayer: false,
      scrambleRelations: 0,
    },
  },
  {
    id: 'chaos',
    name: 'Chaotic World',
    icon: '🎲',
    blurb:
      'Alignments are scrambled at the start and nothing stays settled. Black-swan events fire constantly, relations swing violently, coups and wars come from nowhere. Same rules, no stability.',
    traits: [
      'Scrambled starting alliances',
      'Black-swan events',
      'Violent relation swings',
      'Wars from nowhere',
    ],
    knobs: {
      eventFrequency: 2.3,
      eventSeverity: 1.55,
      warChance: 2.4,
      relationVolatility: 3.4,
      tensionOffset: 12,
      revenueBonus: 0.95,
      blackSwans: true,
      shieldPlayer: false,
      scrambleRelations: 0.45,
    },
  },
];

export const WORLD_MODES_BY_ID = Object.fromEntries(WORLD_MODES.map((m) => [m.id, m]));
export const DEFAULT_WORLD_MODE = 'current';

export function worldMode(id) {
  return WORLD_MODES_BY_ID[id] || WORLD_MODES_BY_ID[DEFAULT_WORLD_MODE];
}

/**
 * The single source of truth for "how does the world behave right now".
 * Difficulty first, then the mode multiplies on top.
 */
export function gameModifiers(game) {
  const base = difficultyModifiers(game?.difficulty ?? 5);
  const knobs = worldMode(game?.worldMode).knobs;

  return {
    ...base,
    mode: worldMode(game?.worldMode),
    eventFrequency: base.eventFrequency * knobs.eventFrequency,
    eventSeverity: base.eventSeverity * knobs.eventSeverity,
    aiAggression: base.aiAggression * knobs.warChance,
    diplomaticFriction: base.diplomaticFriction * knobs.relationVolatility,
    relationVolatility: knobs.relationVolatility,
    budgetMultiplier: base.budgetMultiplier * knobs.revenueBonus,
    tensionOffset: knobs.tensionOffset,
    blackSwans: knobs.blackSwans,
    shieldPlayer: knobs.shieldPlayer,
  };
}

/** Preview bullets for the mode picker. */
export function modePreview(modeId) {
  const knobs = worldMode(modeId).knobs;
  const times = (v) => `×${v.toFixed(2).replace(/\.00$/, '')}`;
  return [
    `Crisis frequency ${times(knobs.eventFrequency)}`,
    `Crisis severity ${times(knobs.eventSeverity)}`,
    `War risk ${times(knobs.warChance)}`,
    `Relation swings ${times(knobs.relationVolatility)}`,
  ];
}
