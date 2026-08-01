// A single, shared vocabulary for "something happened to a country".
// Actions, random events, war ticks and LLM-adjudicated custom orders all
// produce effect objects in this shape, and all of them land here.

import { NATIONS_BY_ID } from '../data/nations.js';
import { addModifier, adjustRelation, clamp, sovereignIds, sovereignStates } from './state.js';
import { t, tModifier, tStat } from '../i18n/index.js';

const STAT_FIELDS = {
  military: [0, 100],
  readiness: [0, 100],
  tech: [0, 100],
  stability: [0, 100],
  influence: [0, 100],
  unrest: [0, 100],
  approval: [0, 100],
};

/** Scale every numeric field of an effect block (used for crits / partials). */
export function scaleEffect(effect, factor) {
  if (!effect) return null;
  const out = {};
  for (const [key, value] of Object.entries(effect)) {
    if (typeof value === 'number') {
      out[key] = value * factor;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = scaleEffect(value, factor);
    } else {
      out[key] = value;
    }
  }
  // Durations should not scale into nonsense.
  if (out.modifier?.turns) out.modifier.turns = Math.max(1, Math.round(effect.modifier.turns));
  if (out.targetModifier?.turns) {
    out.targetModifier.turns = Math.max(1, Math.round(effect.targetModifier.turns));
  }
  return out;
}

function applyStatBlock(game, nationId, block, changes) {
  const state = game.nations[nationId];
  if (!state || !block) return;

  for (const [field, [min, max]] of Object.entries(STAT_FIELDS)) {
    if (typeof block[field] === 'number' && block[field] !== 0) {
      const before = state[field];
      state[field] = clamp(state[field] + block[field], min, max);
      if (state[field] !== before) {
        changes.push({ nationId, field, delta: Number((state[field] - before).toFixed(2)) });
      }
    }
  }

  if (typeof block.treasury === 'number' && block.treasury !== 0) {
    state.treasury += block.treasury;
    changes.push({ nationId, field: 'treasury', delta: Math.round(block.treasury) });
  }
  if (typeof block.treasuryPctGdp === 'number' && block.treasuryPctGdp !== 0) {
    const amount = (block.treasuryPctGdp / 100) * state.gdp * 1000;
    state.treasury += amount;
    changes.push({ nationId, field: 'treasury', delta: Math.round(amount) });
  }
  if (typeof block.gdpPct === 'number' && block.gdpPct !== 0) {
    const before = state.gdp;
    state.gdp = Math.max(0.005, state.gdp * (1 + block.gdpPct / 100));
    changes.push({ nationId, field: 'gdp', delta: Number((state.gdp - before).toFixed(3)) });
  }
  if (typeof block.nukes === 'number' && block.nukes !== 0) {
    state.nukes = Math.max(0, Math.round(state.nukes + block.nukes));
    changes.push({ nationId, field: 'nukes', delta: Math.round(block.nukes) });
  }
  if (typeof block.population === 'number' && block.population !== 0) {
    state.population = Math.max(0.1, state.population + block.population);
  }
}

/**
 * Apply one effect object.
 *
 * @param {object} game
 * @param {string} actorId
 * @param {string|null} targetId
 * @param {object} effect
 * @param {{tensionScale?: number}} [options] tensionScale damps world-tension
 *   contributions from background actors, so sixty countries running exercises
 *   do not peg the gauge at 100 every quarter.
 * @returns {{changes: Array, notes: Array<string>}}
 */
export function applyEffect(game, actorId, targetId, effect, { tensionScale = 1 } = {}) {
  const changes = [];
  const notes = [];
  if (!effect) return { changes, notes };

  applyStatBlock(game, actorId, effect.self, changes);
  if (targetId && effect.target) applyStatBlock(game, targetId, effect.target, changes);

  if (effect.modifier) {
    addModifier(game, actorId, effect.modifier);
    notes.push(t('modifier.forTurns', '{label} ({turns} turns)', {
      label: tModifier(effect.modifier.label),
      turns: effect.modifier.turns ?? 4,
    }));
  }
  if (targetId && effect.targetModifier) {
    addModifier(game, targetId, effect.targetModifier);
  }

  if (typeof effect.relation === 'number' && targetId) {
    adjustRelation(game, actorId, targetId, effect.relation);
  }

  if (effect.relationWith && typeof effect.relationWith === 'object') {
    for (const [otherId, delta] of Object.entries(effect.relationWith)) {
      if (game.nations[otherId]) adjustRelation(game, actorId, otherId, delta);
    }
  }

  if (effect.relationWithBlocs && typeof effect.relationWithBlocs === 'object') {
    for (const [blocId, delta] of Object.entries(effect.relationWithBlocs)) {
      for (const other of sovereignStates(game)) {
        if (other.id === actorId) continue;
        const def = NATIONS_BY_ID[other.id];
        if (def && (def.blocs || []).includes(blocId)) {
          adjustRelation(game, actorId, other.id, delta);
        }
      }
    }
  }

  if (typeof effect.worldTension === 'number' && effect.worldTension !== 0) {
    const delta = effect.worldTension * tensionScale;
    game.worldTension = clamp(game.worldTension + delta, 0, 100);
    changes.push({ nationId: null, field: 'worldTension', delta: Number(delta.toFixed(1)) });
  }

  return { changes, notes };
}

/** Human-readable summary of a change list, e.g. "stability +3, tech +2". */
export function describeChanges(changes, nationId = null) {
  return changes
    .filter((c) => (nationId ? c.nationId === nationId : true))
    .filter((c) => Math.abs(c.delta) >= 0.01)
    .map((c) => {
      const name = tStat(c.field);
      if (c.field === 'treasury') {
        return `${name} ${c.delta >= 0 ? '+' : '−'}$${Math.abs(Math.round(c.delta))}B`;
      }
      if (c.field === 'gdp') {
        return `${name} ${c.delta >= 0 ? '+' : '−'}$${Math.abs(c.delta).toFixed(2)}T`;
      }
      const rounded = Math.abs(c.delta) < 1 ? c.delta.toFixed(1) : Math.round(c.delta);
      return `${name} ${c.delta >= 0 ? '+' : '−'}${Math.abs(rounded)}`;
    });
}
