// The difficulty slider is a single 1..10 value. Everything else in the game
// reads its modifiers from here, so one drag of the slider retunes the whole
// simulation rather than just scaling one number.

export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 10;

export const DIFFICULTY_TIERS = [
  { at: 1, name: 'Détente', blurb: 'A forgiving world. Rivals are cautious, money is loose, mistakes are survivable.' },
  { at: 2, name: 'Détente', blurb: 'A forgiving world. Rivals are cautious, money is loose, mistakes are survivable.' },
  { at: 3, name: 'Stable Order', blurb: 'Institutions mostly hold. Expect friction, not crises.' },
  { at: 4, name: 'Stable Order', blurb: 'Institutions mostly hold. Expect friction, not crises.' },
  { at: 5, name: 'Contested', blurb: 'Great powers probe each other. Budgets bite. Allies ask what you have done for them lately.' },
  { at: 6, name: 'Contested', blurb: 'Great powers probe each other. Budgets bite. Allies ask what you have done for them lately.' },
  { at: 7, name: 'Volatile', blurb: 'Crises stack faster than you can clear them. Rivals coordinate against the leader.' },
  { at: 8, name: 'Volatile', blurb: 'Crises stack faster than you can clear them. Rivals coordinate against the leader.' },
  { at: 9, name: 'Brinkmanship', blurb: 'Everything is a escalation ladder and someone is always climbing. Failure compounds.' },
  { at: 10, name: 'Doomsday Clock', blurb: 'Hostile world, empty treasury, coordinated rivals, and a nuclear threshold that actually gets crossed.' },
];

export function clampDifficulty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(DIFFICULTY_MAX, Math.max(DIFFICULTY_MIN, Math.round(n)));
}

export function difficultyTier(difficulty) {
  const d = clampDifficulty(difficulty);
  return DIFFICULTY_TIERS.find((t) => t.at === d) || DIFFICULTY_TIERS[4];
}

/**
 * Map the slider to the concrete knobs the simulation reads.
 * `t` runs 0 (easiest) → 1 (hardest).
 */
export function difficultyModifiers(difficulty) {
  const d = clampDifficulty(difficulty);
  const t = (d - 1) / (DIFFICULTY_MAX - 1);

  return {
    level: d,
    t,
    tier: difficultyTier(d),

    // How often AI nations reach for the aggressive option, and how hard they push.
    aiAggression: 0.35 + 1.45 * t,
    // Chance per turn that rivals deliberately coordinate against the player.
    rivalCoordination: 0.05 + 0.55 * t,
    // Multiplier on random event severity and frequency.
    eventSeverity: 0.65 + 0.85 * t,
    eventFrequency: 0.7 + 0.8 * t,
    // Flat penalty subtracted from every player action's success chance.
    successPenalty: 0.24 * t,
    // Multiplier on the player's quarterly revenue.
    budgetMultiplier: 1.25 - 0.5 * t,
    // Multiplier on baseline GDP growth (headwinds at high difficulty).
    growthMultiplier: 1.12 - 0.42 * t,
    // Extra political capital at low difficulty, a deficit at high.
    politicalCapitalBonus: Math.round(2 - 4 * t),
    // How fast unrest accumulates from unpopular outcomes.
    unrestMultiplier: 0.7 + 0.9 * t,
    // How forgiving relation drift is toward the player.
    diplomaticFriction: 0.6 + 1.0 * t,
    // Whether the AI will actually use nuclear escalation when losing badly.
    nuclearThreshold: 0.98 - 0.35 * t,
    // Score multiplier when the run is graded.
    scoreMultiplier: 0.7 + 0.9 * t,
  };
}

/**
 * Short bullet list rendered next to the slider. Everything is expressed
 * against the easiest setting, so the numbers read as "how much worse than
 * Détente is this" rather than against an invisible baseline of 1.
 */
export function difficultyPreview(difficulty) {
  const m = difficultyModifiers(difficulty);
  const base = difficultyModifiers(DIFFICULTY_MIN);
  const times = (v) => `×${v.toFixed(2)}`;
  const pts = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`;
  return [
    `Revenue ${times(m.budgetMultiplier / base.budgetMultiplier)}`,
    `Growth ${times(m.growthMultiplier / base.growthMultiplier)}`,
    `Action success ${pts(-m.successPenalty * 100)} pts`,
    `Rival aggression ${times(m.aiAggression / base.aiAggression)}`,
    `Crisis severity ${times(m.eventSeverity / base.eventSeverity)}`,
    `Political capital ${pts(m.politicalCapitalBonus - base.politicalCapitalBonus)}`,
  ];
}
