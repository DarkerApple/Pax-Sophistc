// Scenarios: which world you are playing in.
//
// The engine never imports a roster directly. It asks this registry for one,
// which means a second era — an old-world mode, a cold-war mode, a fictional
// one — arrives as a data file that calls registerScenario(), not as a change
// to the simulation.
//
// A scenario supplies:
//   id         stable key, stored in the save
//   name       what the setup screen calls it
//   blurb      one line under that name
//   startYear  the year turn 0 begins in
//   nations    the roster: full definition sheets, same shape as data/nations.js
//   anchors    [a, b, value] relationship facts history has already settled
//   blocs      the alliance and grouping table for this era
//
// Everything else — territory, events, war, escalation — reads from the roster
// and the live game state, so it works unchanged in any era.

import { BLOCS, NATIONS, RELATION_ANCHORS, registerNation } from './nations.js';

/** @type {Map<string, object>} */
const REGISTRY = new Map();

/**
 * Add a scenario. Its nations are taught to the global lookup immediately, so
 * anything that resolves an id to a flag or a name works the moment the pack is
 * imported — before any game using it is created.
 */
export function registerScenario(def) {
  if (!def?.id) throw new Error('A scenario needs an id.');
  const scenario = {
    startYear: 2026,
    anchors: [],
    blocs: BLOCS,
    ...def,
  };
  if (!Array.isArray(scenario.nations) || !scenario.nations.length) {
    throw new Error(`Scenario ${def.id} has no nations.`);
  }
  for (const nation of scenario.nations) registerNation(nation);
  REGISTRY.set(scenario.id, scenario);
  return scenario;
}

export function scenarios() {
  return [...REGISTRY.values()];
}

/** Look up a scenario, falling back to the current world rather than throwing. */
export function scenarioOf(id) {
  return REGISTRY.get(id) || REGISTRY.get(DEFAULT_SCENARIO);
}

export function hasScenario(id) {
  return REGISTRY.has(id);
}

export const DEFAULT_SCENARIO = 'current-world';

registerScenario({
  id: DEFAULT_SCENARIO,
  name: 'Current World',
  blurb: 'Earth as it actually stands at the start of 2026.',
  startYear: 2026,
  nations: NATIONS,
  anchors: RELATION_ANCHORS,
  blocs: BLOCS,
});
