// What the world looks like from outside your own country.
//
// The engine has been able to redraw borders, invent states and move countries
// between blocs for a while, but none of it was anywhere a player could see it —
// which, from the desk, is indistinguishable from it not happening. This module
// assembles those facts into the shape the world panel renders.
//
// Everything here is derived. Nothing is stored, so a save from before the
// panel existed reads exactly the same as one made after it.

import { BLOCS } from '../data/nations.js';
import { blocsOf, defOf, livePower, sovereignIds } from '../engine/state.js';
import { areaOf, startingAreaOf } from '../engine/territory.js';
import { threatOf } from '../engine/coalitions.js';

/**
 * Every bloc on the board with its live membership, ordered by weight.
 *
 * @returns {Array<{bloc: object, members: string[], playerIn: boolean, powerShare: number}>}
 */
export function blocStandings(game) {
  const live = sovereignIds(game);
  const totalPower = live.reduce((sum, id) => sum + livePower(game, id), 0) || 1;

  return Object.values(BLOCS)
    .map((bloc) => {
      const members = live.filter((id) => blocsOf(game, id).includes(bloc.id));
      const power = members.reduce((sum, id) => sum + livePower(game, id), 0);
      return {
        bloc,
        members,
        playerIn: members.includes(game.playerId),
        powerShare: power / totalPower,
      };
    })
    .filter((entry) => entry.members.length > 0)
    .sort((a, b) => b.powerShare - a.powerShare);
}

/** The blocs the player currently belongs to, in the same order. */
export function playerBlocs(game) {
  return blocStandings(game).filter((entry) => entry.playerIn);
}

/**
 * States that did not exist when the run started, with what they inherited.
 * The stats are the derived ones the split produced, not the parent's.
 */
export function newStates(game) {
  return Object.values(game.customNations || {})
    .map((def) => {
      const state = game.nations[def.id];
      if (!state) return null;
      return {
        id: def.id,
        def,
        parent: defOf(game, def.parentId),
        bornTurn: def.bornTurn ?? 0,
        sovereign: state.sovereign !== false,
        gdp: state.gdp,
        population: state.population,
        military: state.military,
        stability: state.stability,
        area: areaOf(game, def.id),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.bornTurn - a.bornTurn);
}

/** Countries that are no longer their own, and who administers them now. */
export function formerStates(game) {
  return Object.keys(game.nations)
    .filter((id) => game.nations[id].sovereign === false)
    .map((id) => ({
      id,
      def: defOf(game, id),
      holder: defOf(game, game.nations[id].annexedBy),
      holderId: game.nations[id].annexedBy || null,
      turn: game.nations[id].annexedTurn ?? 0,
      byPlayer: game.nations[id].annexedBy === game.playerId,
    }))
    .sort((a, b) => b.turn - a.turn);
}

/**
 * Who has gained and lost ground since the first quarter, in thousand km².
 * This is the honest measure of "the map changed": it survives a province
 * changing hands twice and lands on the net position.
 */
export function landMovers(game, limit = 5) {
  const moved = sovereignIds(game)
    .map((id) => {
      const start = startingAreaOf(game, id);
      const now = areaOf(game, id);
      return { id, def: defOf(game, id), start, now, delta: now - start };
    })
    // A thousand km² either way is rounding on a continental scale.
    .filter((entry) => Math.abs(entry.delta) >= 1);

  const gained = [...moved].sort((a, b) => b.delta - a.delta).filter((e) => e.delta > 0).slice(0, limit);
  const lost = [...moved].sort((a, b) => a.delta - b.delta).filter((e) => e.delta < 0).slice(0, limit);
  return { gained, lost };
}

/** Log entries of a given kind from the last few quarters, newest first. */
export function recentOfType(game, types, within = 8, limit = 6) {
  const wanted = new Set(Array.isArray(types) ? types : [types]);
  return [...(game.log || [])]
    .filter((entry) => wanted.has(entry.type) && game.turn - entry.turn <= within)
    .reverse()
    .slice(0, limit);
}

/** The countries the rest of the world is currently most wary of. */
export function feared(game, limit = 3) {
  return sovereignIds(game)
    .map((id) => ({ id, def: defOf(game, id), threat: threatOf(game, id) }))
    .filter((entry) => entry.threat >= 0.25)
    .sort((a, b) => b.threat - a.threat)
    .slice(0, limit);
}
