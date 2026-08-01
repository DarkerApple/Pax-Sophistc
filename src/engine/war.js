// War: declaration, the quarterly grind, and how it ends.
//
// warScore runs -100 (defenders winning outright) to +100 (attackers winning
// outright). Exhaustion is what actually stops most wars.

import { NATIONS_BY_ID } from '../data/nations.js';
import { t, tNation } from '../i18n/index.js';
import {
  addModifier,
  adjustRelation,
  clamp,
  combatPower,
  defOf,
  getRelation,
  logEvent,
} from './state.js';
import { areaOf, frontAnchor, setOwner, transferLand } from './territory.js';

const HOME_GROUND_BONUS = 1.18;
// Wars used to grind for twenty quarters. They now reach a verdict in roughly
// six to ten, and the verdict costs the loser considerably more.
const DECISIVE_SCORE = 52;
const EXHAUSTION_LIMIT = 82;

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
    name: t('war.name', '{a}–{b} War', { a: tNation(attacker, 'adjective'), b: tNation(defender, 'adjective') }),
    attackers: [attackerId],
    defenders: [defenderId],
    startTurn: game.turn,
    warScore: 6,
    exhaustion: { attackers: 0, defenders: 0 },
    casualties: 0,
    // Ground currently under occupation: [cell, whose it was, who holds it].
    // Kept on the war so a stalemate can hand every acre back.
    occupied: [],
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

    const swing = ((atkPower - defPower) / total) * 23 + rng.normal(0, 5.5);
    war.warScore = clamp(war.warScore + swing, -100, 100);

    const intensity = 1 + Math.min(1.2, total / 160);
    war.casualties += Math.round(intensity * rng.float(14, 38) * mods.eventSeverity * 1000);

    // Both sides pay, the losing side pays more.
    for (const [side, ids] of [['attackers', war.attackers], ['defenders', war.defenders]]) {
      const losing = side === 'attackers' ? war.warScore < 0 : war.warScore > 0;
      const pressure = losing ? 1.45 : 1;
      war.exhaustion[side] = clamp(
        war.exhaustion[side] + rng.float(5, 9.5) * pressure * mods.eventSeverity,
        0,
        100,
      );
      for (const id of ids) {
        const state = game.nations[id];
        if (!state) continue;
        state.treasury -= state.gdp * 1000 * 0.026 * pressure;
        state.readiness = clamp(state.readiness - rng.float(1.2, 3.4) * pressure);
        state.unrest = clamp(state.unrest + rng.float(0.8, 3) * pressure * mods.unrestMultiplier);
        state.stability = clamp(state.stability - rng.float(0.4, 1.6) * pressure);
        state.gdp = Math.max(0.005, state.gdp * (1 - 0.009 * pressure));
        state.military = clamp(state.military - rng.float(0.2, 1.1) * pressure);
      }
    }

    const advance = advanceFront(game, war, rng);

    const nuclearRisk = nuclearEscalationRisk(game, war, mods);
    if (nuclearRisk > 0 && rng.next() < nuclearRisk) {
      reports.push(detonate(game, war, rng));
      continue;
    }

    const decisive = Math.abs(war.warScore) >= DECISIVE_SCORE;
    const spent =
      war.exhaustion.attackers >= EXHAUSTION_LIMIT || war.exhaustion.defenders >= EXHAUSTION_LIMIT;
    // Nothing is settled inside a single quarter, however lopsided it looks.
    const longEnough = game.turn - war.startTurn >= 2;

    if (longEnough && (decisive || spent)) {
      reports.push(concludeWar(game, war, rng, decisive ? 'decisive' : 'exhaustion'));
    } else {
      reports.push({
        type: 'war',
        warId: war.id,
        title: war.name,
        text: advance ? `${frontLineSummary(war)} ${advance.text}` : frontLineSummary(war),
        warScore: Math.round(war.warScore),
        casualties: war.casualties,
        ground: advance || null,
      });
    }
  }

  game.wars = game.wars.filter((w) => w.active || game.turn - (w.endedTurn ?? 0) < 24);
  return reports;
}

/**
 * Push the front. Whoever is ahead takes ground from whoever is behind, in
 * proportion to how far ahead they are — so a war you are winning visibly
 * eats into the map quarter by quarter instead of resolving in one jump.
 */
function advanceFront(game, war, rng) {
  const lead = war.warScore;
  if (Math.abs(lead) < 14) return null;

  const gaining = lead > 0 ? war.attackers : war.defenders;
  const yielding = lead > 0 ? war.defenders : war.attackers;
  const gainer = gaining[0];
  // Take from whichever opponent still holds the most — the war's centre of
  // gravity, not whoever happens to be listed first.
  const target = [...yielding].sort((a, b) => areaOf(game, b) - areaOf(game, a))[0];
  if (!target || target === gainer) return null;

  const pressure = (Math.abs(lead) - 14) / 86;
  const held = areaOf(game, target) * 1000;
  const wanted = held * pressure * 0.075 * rng.float(0.55, 1.35);
  if (wanted < 5000) return null;

  const anchor = frontAnchor(game, target, gainer);
  const moved = transferLand(game, target, gainer, wanted, anchor);
  if (!moved.cells.length) return null;

  if (!war.occupied) war.occupied = [];
  war.occupied.push(...moved.cells.map((slot) => [slot, target, gainer]));

  const gainerName = tNation(defOf(game, gainer));
  const targetName = tNation(defOf(game, target));
  return {
    from: target,
    to: gainer,
    area: Math.round(moved.area),
    text: t('war.groundTaken', '{a} forces now occupy roughly {n},000 km² of {b} territory.', {
      a: gainerName,
      b: targetName,
      n: Math.round(moved.area),
    }),
  };
}

/**
 * What the peace does with occupied ground.
 * A decisive win keeps most of it; anything less hands it all back.
 */
function settleOccupation(game, war, rng, decisive, winners) {
  if (!war.occupied?.length) return { annexed: 0, returned: 0 };
  const keep = decisive && winners.length ? rng.float(0.55, 0.9) : 0;
  let annexed = 0;
  let returned = 0;
  const returning = [];

  for (const [slot, original, holder] of war.occupied) {
    const wonIt = winners.includes(holder);
    if (wonIt && rng.next() < keep) {
      annexed += 1;
      continue;
    }
    returning.push([slot, original]);
    returned += 1;
  }
  for (const [slot, original] of returning) setOwner(game, [slot], original);
  war.occupied = [];
  return { annexed, returned };
}

function frontLineSummary(war) {
  const s = war.warScore;
  const a = tNation(NATIONS_BY_ID[war.attackers[0]]);
  const b = tNation(NATIONS_BY_ID[war.defenders[0]]);
  if (s > 40) return t('war.rout', '{a} forces are advancing on every axis; {b} lines are buckling.', { a, b });
  if (s > 15) return t('war.advance', '{a} forces hold the initiative but are paying for every kilometre.', { a, b });
  if (s > -15) return t('war.stalemate', 'The front has not meaningfully moved. Both sides are grinding.', { a, b });
  if (s > -40) return t('war.stalled', '{b} counter-attacks have taken back ground; the offensive has stalled.', { a, b });
  return t('war.collapse', 'The {a} offensive has collapsed. {b} forces are pushing into held territory.', { a, b });
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

  const decisive = Math.abs(war.warScore) >= DECISIVE_SCORE;
  const weight = decisive ? 1.6 : 1;
  const ground = settleOccupation(game, war, rng, decisive && kind !== 'nuclear', winners);
  war.annexedCells = ground.annexed;

  for (const id of winners) {
    const state = game.nations[id];
    if (!state) continue;
    state.influence = clamp(state.influence + rng.float(6, 14) * weight);
    state.approval = clamp(state.approval + rng.float(8, 16));
    state.stability = clamp(state.stability + rng.float(2, 5));
    state.military = clamp(state.military + rng.float(1, 3));
    if (id === game.playerId) game.stats.warsWon += 1;
  }

  for (const id of losers) {
    const state = game.nations[id];
    if (!state) continue;
    state.influence = clamp(state.influence - rng.float(10, 22) * weight);
    state.approval = clamp(state.approval - rng.float(14, 26));
    state.stability = clamp(state.stability - rng.float(8, 18) * weight);
    state.unrest = clamp(state.unrest + rng.float(6, 14) * weight);
    state.military = clamp(state.military - rng.float(4, 10) * weight);
    state.gdp = Math.max(0.005, state.gdp * (1 - rng.float(0.04, 0.11) * weight));
    addModifier(game, id, {
      label: 'Post-war reconstruction',
      turns: 10,
      growth: -0.45,
      unrest: 1.2,
      source: 'war',
    });
  }

  // Reparations: the loser pays, the winners split it.
  if (decisive && winners.length && losers.length) {
    let pot = 0;
    for (const id of losers) {
      const state = game.nations[id];
      if (!state) continue;
      const tribute = state.gdp * 1000 * rng.float(0.03, 0.07);
      state.treasury -= tribute;
      pot += tribute;
      addModifier(game, id, {
        label: 'Reparations',
        turns: 8,
        growth: -0.2,
        source: 'war',
      });
    }
    for (const id of winners) {
      const state = game.nations[id];
      if (state) state.treasury += pot / winners.length;
    }
    war.reparations = Math.round(pot);
  }

  // Everyone stops shooting; nobody forgets.
  for (const a of war.attackers) {
    for (const d of war.defenders) {
      adjustRelation(game, a, d, 18);
    }
  }

  game.worldTension = clamp(game.worldTension - 12, 0, 100);

  const quarters = game.turn - war.startTurn;
  const summary =
    kind === 'nuclear'
      ? t('war.endNuclear', '{war} ends in nuclear catastrophe.', { war: war.name })
      : winners.length
        ? t('war.endVictory', '{war} ends: {winner} prevails after {quarters} quarters and roughly {casualties}k casualties.',
            { war: war.name, winner: tNation(NATIONS_BY_ID[winners[0]]), quarters, casualties: (war.casualties / 1000).toFixed(0) })
        : t('war.endStalemate', '{war} ends in exhausted stalemate after {quarters} quarters.', { war: war.name, quarters });

  const borders = ground.annexed
    ? ` ${t('war.endAnnex', 'The peace redraws the border: {n} occupied districts stay with the victors.', { n: ground.annexed })}`
    : ground.returned
      ? ` ${t('war.endWithdraw', 'Every occupied district is handed back.')}`
      : '';

  logEvent(game, { type: 'war', severity: 'major', text: summary + borders, nations: [...war.attackers, ...war.defenders] });
  return {
    type: 'war-end',
    warId: war.id,
    title: 'War Ends',
    text: summary + borders,
    outcome: war.outcome,
    annexed: ground.annexed,
  };
}
