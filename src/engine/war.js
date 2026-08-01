// War: declaration, the quarterly grind, and how it ends.
//
// warScore runs -100 (defenders winning outright) to +100 (attackers winning
// outright). Exhaustion is what actually stops most wars.

import { NATIONS_BY_ID } from '../data/nations.js';
import {
  addModifier,
  adjustRelation,
  clamp,
  combatPower,
  getRelation,
  logEvent,
} from './state.js';

const HOME_GROUND_BONUS = 1.18;
const DECISIVE_SCORE = 68;
const EXHAUSTION_LIMIT = 88;

export function findWar(game, a, b) {
  return game.wars.find(
    (w) =>
      w.active &&
      ((w.attackers.includes(a) && w.defenders.includes(b)) ||
        (w.attackers.includes(b) && w.defenders.includes(a))),
  );
}

export function declareWar(game, attackerId, defenderId, { rng, reason = 'unspecified aims' } = {}) {
  if (findWar(game, attackerId, defenderId)) return null;
  const attacker = NATIONS_BY_ID[attackerId];
  const defender = NATIONS_BY_ID[defenderId];
  if (!attacker || !defender) return null;

  const war = {
    id: `war-${game.turn}-${attackerId}-${defenderId}`,
    name: `${attacker.adjective}–${defender.adjective} War`,
    attackers: [attackerId],
    defenders: [defenderId],
    startTurn: game.turn,
    warScore: 6,
    exhaustion: { attackers: 0, defenders: 0 },
    casualties: 0,
    reason,
    active: true,
    outcome: null,
    nuclearUsed: false,
  };

  // Treaty allies get dragged in, if the relationship is strong enough to hold.
  for (const other of Object.values(game.nations)) {
    if (other.id === attackerId || other.id === defenderId) continue;
    const def = NATIONS_BY_ID[other.id];
    const toDefender = getRelation(game, other.id, defenderId);
    const toAttacker = getRelation(game, other.id, attackerId);
    const sharesDefencePact = (def.blocs || []).some(
      (b) =>
        ['nato', 'csto', 'usAllied'].includes(b) &&
        (NATIONS_BY_ID[defenderId].blocs || []).includes(b),
    );
    const joinChance = sharesDefencePact ? 0.8 : toDefender > 70 && toAttacker < -20 ? 0.3 : 0;
    if (joinChance > 0 && rng && rng.bool(joinChance)) {
      war.defenders.push(other.id);
    }
  }

  game.wars.push(war);
  game.worldTension = clamp(game.worldTension + 18, 0, 100);
  adjustRelation(game, attackerId, defenderId, -70);
  for (const id of war.defenders) {
    if (id !== defenderId) adjustRelation(game, attackerId, id, -30);
  }

  logEvent(game, {
    type: 'war',
    severity: 'critical',
    text: `${attacker.name} opens hostilities against ${defender.name}${
      war.defenders.length > 1
        ? `. ${war.defenders
            .filter((d) => d !== defenderId)
            .map((d) => NATIONS_BY_ID[d].name)
            .join(', ')} honour ${defender.adjective} commitments.`
        : '.'
    }`,
    nations: [attackerId, ...war.defenders],
  });

  return war;
}

function sidePower(game, ids) {
  return ids.reduce((sum, id) => sum + combatPower(game, id), 0);
}

/**
 * Advance every active war one quarter.
 * @returns {Array<object>} report entries for the turn briefing
 */
export function tickWars(game, rng, mods) {
  const reports = [];

  for (const war of game.wars) {
    if (!war.active) continue;

    const atkPower = sidePower(game, war.attackers) * (1 - war.exhaustion.attackers / 170);
    const defPower = sidePower(game, war.defenders) * HOME_GROUND_BONUS * (1 - war.exhaustion.defenders / 170);
    const total = Math.max(1, atkPower + defPower);

    const swing = ((atkPower - defPower) / total) * 17 + rng.normal(0, 4.5);
    war.warScore = clamp(war.warScore + swing, -100, 100);

    const intensity = 1 + Math.min(1.2, total / 160);
    war.casualties += Math.round(intensity * rng.float(8, 26) * mods.eventSeverity * 1000);

    // Both sides pay, the losing side pays more.
    for (const [side, ids] of [['attackers', war.attackers], ['defenders', war.defenders]]) {
      const losing = side === 'attackers' ? war.warScore < 0 : war.warScore > 0;
      const pressure = losing ? 1.45 : 1;
      war.exhaustion[side] = clamp(
        war.exhaustion[side] + rng.float(4, 9) * pressure * mods.eventSeverity,
        0,
        100,
      );
      for (const id of ids) {
        const state = game.nations[id];
        if (!state) continue;
        state.treasury -= state.gdp * 1000 * 0.018 * pressure;
        state.readiness = clamp(state.readiness - rng.float(1.2, 3.4) * pressure);
        state.unrest = clamp(state.unrest + rng.float(0.8, 3) * pressure * mods.unrestMultiplier);
        state.stability = clamp(state.stability - rng.float(0.4, 1.6) * pressure);
        state.gdp = Math.max(0.005, state.gdp * (1 - 0.006 * pressure));
        state.military = clamp(state.military - rng.float(0.2, 1.1) * pressure);
      }
    }

    const nuclearRisk = nuclearEscalationRisk(game, war, mods);
    if (nuclearRisk > 0 && rng.next() < nuclearRisk) {
      reports.push(detonate(game, war, rng));
      continue;
    }

    const decisive = Math.abs(war.warScore) >= DECISIVE_SCORE;
    const spent =
      war.exhaustion.attackers >= EXHAUSTION_LIMIT || war.exhaustion.defenders >= EXHAUSTION_LIMIT;

    if (decisive || spent) {
      reports.push(concludeWar(game, war, rng, decisive ? 'decisive' : 'exhaustion'));
    } else {
      reports.push({
        type: 'war',
        warId: war.id,
        title: war.name,
        text: frontLineSummary(war),
        warScore: Math.round(war.warScore),
        casualties: war.casualties,
      });
    }
  }

  game.wars = game.wars.filter((w) => w.active || game.turn - (w.endedTurn ?? 0) < 24);
  return reports;
}

function frontLineSummary(war) {
  const s = war.warScore;
  const attacker = NATIONS_BY_ID[war.attackers[0]].adjective;
  const defender = NATIONS_BY_ID[war.defenders[0]].adjective;
  if (s > 40) return `${attacker} forces are advancing on every axis; ${defender} lines are buckling.`;
  if (s > 15) return `${attacker} forces hold the initiative but are paying for every kilometre.`;
  if (s > -15) return `The front has not meaningfully moved. Both sides are grinding.`;
  if (s > -40) return `${defender} counter-attacks have taken back ground; the offensive has stalled.`;
  return `The ${attacker} offensive has collapsed. ${defender} forces are pushing into held territory.`;
}

function nuclearEscalationRisk(game, war, mods) {
  const losingSide = war.warScore > 55 ? 'defenders' : war.warScore < -55 ? 'attackers' : null;
  if (!losingSide) return 0;
  const ids = war[losingSide];
  const arsenal = ids.reduce((sum, id) => sum + (game.nations[id]?.nukes || 0), 0);
  if (arsenal <= 0) return 0;
  const desperation = (Math.abs(war.warScore) - 55) / 45;
  const base = 0.02 + desperation * 0.09;
  // nuclearThreshold falls as difficulty rises, so the check gets easier to pass.
  return Math.max(0, base * (1.02 - mods.nuclearThreshold) * 12);
}

function detonate(game, war, rng) {
  const losingSide = war.warScore > 0 ? 'defenders' : 'attackers';
  const winningSide = losingSide === 'attackers' ? 'defenders' : 'attackers';
  const userId = war[losingSide].find((id) => (game.nations[id]?.nukes || 0) > 0) || war[losingSide][0];
  const victimId = war[winningSide][0];

  war.nuclearUsed = true;
  game.stats.nukesUsed += 1;
  game.worldTension = 100;

  for (const [id, factor] of [[victimId, 1], [userId, 0.55]]) {
    const state = game.nations[id];
    if (!state) continue;
    state.gdp = Math.max(0.005, state.gdp * (1 - 0.22 * factor));
    state.population = Math.max(0.1, state.population * (1 - 0.02 * factor));
    state.stability = clamp(state.stability - 28 * factor);
    state.unrest = clamp(state.unrest + 34 * factor);
    state.military = clamp(state.military - 18 * factor);
    addModifier(game, id, {
      label: 'Nuclear devastation',
      turns: 16,
      growth: -0.9 * factor,
      unrest: 2 * factor,
      source: 'nuclear',
    });
  }

  // The rest of the world reacts to the user, permanently.
  for (const other of Object.values(game.nations)) {
    if (other.id === userId) continue;
    adjustRelation(game, userId, other.id, -45);
  }

  concludeWar(game, war, rng, 'nuclear');

  const text = `NUCLEAR RELEASE. ${NATIONS_BY_ID[userId].name} employs nuclear weapons against ${NATIONS_BY_ID[victimId].name}. The post-1945 taboo is over.`;
  logEvent(game, { type: 'nuclear', severity: 'critical', text, nations: [userId, victimId] });
  return { type: 'nuclear', title: 'Nuclear Release', text, warId: war.id };
}

export function concludeWar(game, war, rng, kind = 'decisive') {
  war.active = false;
  war.endedTurn = game.turn;

  const attackersWon = war.warScore > 15;
  const defendersWon = war.warScore < -15;
  const winners = attackersWon ? war.attackers : defendersWon ? war.defenders : [];
  const losers = attackersWon ? war.defenders : defendersWon ? war.attackers : [];
  war.outcome = kind === 'nuclear'
    ? 'nuclear'
    : winners.length
      ? `${NATIONS_BY_ID[winners[0]].adjective} victory`
      : 'Stalemate';

  for (const id of winners) {
    const state = game.nations[id];
    if (!state) continue;
    state.influence = clamp(state.influence + rng.float(3, 8));
    state.approval = clamp(state.approval + rng.float(4, 10));
    state.stability = clamp(state.stability + 2);
    if (id === game.playerId) game.stats.warsWon += 1;
  }
  for (const id of losers) {
    const state = game.nations[id];
    if (!state) continue;
    state.influence = clamp(state.influence - rng.float(5, 12));
    state.approval = clamp(state.approval - rng.float(8, 16));
    state.stability = clamp(state.stability - rng.float(4, 10));
    state.gdp = Math.max(0.005, state.gdp * (1 - rng.float(0.02, 0.06)));
    addModifier(game, id, {
      label: 'Post-war reconstruction',
      turns: 8,
      growth: -0.25,
      unrest: 0.8,
      source: 'war',
    });
  }

  // Everyone stops shooting; nobody forgets.
  for (const a of war.attackers) {
    for (const d of war.defenders) {
      adjustRelation(game, a, d, 18);
    }
  }

  game.worldTension = clamp(game.worldTension - 12, 0, 100);

  const summary =
    kind === 'nuclear'
      ? `${war.name} ends in nuclear catastrophe.`
      : winners.length
        ? `${war.name} ends: ${NATIONS_BY_ID[winners[0]].name} prevails after ${game.turn - war.startTurn} quarters and roughly ${(war.casualties / 1000).toFixed(0)}k casualties.`
        : `${war.name} ends in exhausted stalemate after ${game.turn - war.startTurn} quarters.`;

  logEvent(game, { type: 'war', severity: 'major', text: summary, nations: [...war.attackers, ...war.defenders] });
  return { type: 'war-end', warId: war.id, title: 'War Ends', text: summary, outcome: war.outcome };
}
