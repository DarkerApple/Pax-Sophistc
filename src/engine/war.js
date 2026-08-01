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
  sovereignIds,
  sovereignStates,
} from './state.js';
import {
  areaOf,
  cellArea,
  frontAnchor,
  hasNoLand,
  landCells,
  setOwner,
  transferLand,
} from './territory.js';
import { annexNation, isSovereign } from './statecraft.js';

const HOME_GROUND_BONUS = 1.18;
// Wars used to grind for twenty quarters. They now reach a verdict in roughly
// six to ten, and the verdict costs the loser considerably more.
const DECISIVE_SCORE = 52;
const EXHAUSTION_LIMIT = 82;
// Above this the winner is not negotiating, it is dictating.
const OVERWHELMING_SCORE = 84;

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
  for (const other of sovereignStates(game)) {
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
 * Is this a war one side can still finish outright?
 *
 * Only when the winner outclasses the loser several times over, the loser
 * still holds ground worth taking, and the winner is not itself worn out —
 * `pressWar` lets the player force the answer to yes for one more quarter.
 */
function rout(game, war) {
  const winning = war.warScore > 0 ? 'attackers' : 'defenders';
  const losing = winning === 'attackers' ? 'defenders' : 'attackers';
  if (war.exhaustion[winning] > 62 && !war.pressed) return false;

  const edge = sidePower(game, war[winning]) / Math.max(0.01, sidePower(game, war[losing]));
  if (edge < 2.4 && !war.pressed) return false;

  // Nothing left to overrun means nothing left to fight for.
  return war[losing].some((id) => areaOf(game, id) > 0 && isSovereign(game, id));
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

    // Swing on the *ratio*, not the share of the total. Share saturates: a 3:1
    // advantage and a 30:1 advantage both read as "nearly all of it", and the
    // superpower took as long to beat the small country as the near-peer did.
    // A log ratio does not saturate, so overwhelming force overwhelms.
    const ratio = Math.log2(Math.max(atkPower, 0.01) / Math.max(defPower, 0.01));
    const swing = Math.max(-32, Math.min(32, ratio * 13)) + rng.normal(0, 5.5);
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
    const overwhelming = Math.abs(war.warScore) >= OVERWHELMING_SCORE;
    const spent =
      war.exhaustion.attackers >= EXHAUSTION_LIMIT || war.exhaustion.defenders >= EXHAUSTION_LIMIT;
    // Nothing is settled inside a single quarter, however lopsided it looks.
    const longEnough = game.turn - war.startTurn >= 2;

    // A rout does not stop at "decisive". If one side is being overrun and the
    // other has the strength to finish it — and wants to — the war runs on
    // until the country is taken or the winner runs out of will. This is what
    // makes conquest possible at all: a war that always halts the moment it is
    // decided can never take anybody's capital.
    const routing = decisive && !overwhelming && !spent && rout(game, war);

    if (longEnough && (overwhelming || spent || (decisive && !routing))) {
      reports.push(concludeWar(game, war, rng, overwhelming || decisive ? 'decisive' : 'exhaustion'));
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

  // "Press the advantage" buys one quarter of momentum, not a standing policy.
  for (const war of game.wars) war.pressed = false;

  game.wars = game.wars.filter((w) => w.active || game.turn - (w.endedTurn ?? 0) < 24);
  return reports;
}

/**
 * Push the front.
 *
 * The bite scales with how far ahead you are *and* with the force ratio, so a
 * superpower rolling a small neighbour eats a third of it a quarter while two
 * near-peers trade districts. Once a side is beaten badly enough, the front
 * stops being a front and becomes an occupation of the whole country.
 */
function advanceFront(game, war, rng) {
  const lead = war.warScore;
  if (Math.abs(lead) < 10) return null;

  const gaining = lead > 0 ? war.attackers : war.defenders;
  const yielding = lead > 0 ? war.defenders : war.attackers;
  // The ground goes to whoever is doing the fighting, not to whoever is listed
  // first. A coalition war used to end with the small country that was attacked
  // occupying the great power, because its name headed the array.
  const gainer = [...gaining].sort((a, b) => combatPower(game, b) - combatPower(game, a))[0];
  // Take from whichever opponent still holds the most — the war's centre of
  // gravity, not whoever happens to be listed first.
  const target = [...yielding].sort((a, b) => areaOf(game, b) - areaOf(game, a))[0];
  if (!target || target === gainer) return null;

  const held = areaOf(game, target) * 1000;
  if (held <= 0) return null;

  // 0 at the threshold, 1 at a total rout.
  const pressure = (Math.abs(lead) - 10) / 90;
  const forceEdge = Math.min(
    2.5,
    Math.max(0.4, sidePower(game, gaining) / Math.max(0.01, sidePower(game, yielding))),
  );
  // Up to ~45% of what is left, in one quarter, when the rout is total and the
  // attacker outclasses the defender several times over.
  const fraction = Math.min(0.45, 0.04 + pressure * pressure * 0.34 * Math.sqrt(forceEdge));
  const wanted = held * fraction;

  // Beyond this the defender has no army left in the field and the rest of the
  // country is simply occupied.
  const total = Math.abs(lead) >= OVERWHELMING_SCORE && game.turn - war.startTurn >= 1;
  if (wanted < 800 && !total) return null;

  const anchor = frontAnchor(game, target, gainer);
  const moved = transferLand(game, target, gainer, total ? held * 2 : wanted, anchor, { total });
  if (!moved.cells.length) return null;

  if (!war.occupied) war.occupied = [];
  war.occupied.push(...moved.cells.map((slot) => [slot, target, gainer]));

  const gainerName = tNation(defOf(game, gainer));
  const targetName = tNation(defOf(game, target));
  const remaining = areaOf(game, target);
  return {
    from: target,
    to: gainer,
    area: Math.round(moved.area),
    overrun: moved.emptied,
    text: moved.emptied
      ? t('war.groundOverrun', '{a} forces are in {b}\u2019s capital. Organised resistance has ended.',
          { a: gainerName, b: targetName })
      : t('war.groundTaken',
          '{a} forces now occupy roughly {n},000 km\u00b2 of {b} territory \u2014 {left},000 km\u00b2 still in {b} hands.',
          { a: gainerName, b: targetName, n: Math.round(moved.area), left: Math.round(remaining) }),
  };
}

/**
 * What the peace does with occupied ground.
 *
 * A negotiated end hands it back. A decisive victory keeps all of it. An
 * overwhelming one — the defender routed and overrun — takes the country.
 */
function settleOccupation(game, war, rng, kind, winners, losers) {
  const result = { annexed: 0, returned: 0, absorbed: [] };
  const decisive = Math.abs(war.warScore) >= DECISIVE_SCORE && kind !== 'nuclear';
  const overwhelming = Math.abs(war.warScore) >= OVERWHELMING_SCORE && kind === 'decisive';

  if (overwhelming && winners.length) {
    // Anyone who has been pushed off the map, or nearly, stops being a country.
    for (const loserId of losers) {
      if (!isSovereign(game, loserId)) continue;
      const left = areaOf(game, loserId);
      const started = Math.max(1, startingArea(game, loserId));
      if (hasNoLand(game, loserId) || left / started < 0.12) {
        // To whoever actually took the ground — not to whichever ally happens
        // to head the list. A coalition war should not end with the small
        // country that was attacked formally annexing the great power that
        // attacked it, because its name came first.
        const done = annexNation(game, loserId, occupierOf(war, loserId, winners), rng, { reason: 'conquest' });
        if (done) result.absorbed.push(done);
      }
    }
  }

  if (!war.occupied?.length) return result;

  const returning = [];
  for (const [slot, original, holder] of war.occupied) {
    // Ground belonging to a country that no longer exists is not handed back.
    if (!isSovereign(game, original)) continue;
    if (decisive && winners.includes(holder)) {
      result.annexed += 1;
      continue;
    }
    returning.push([slot, original]);
    result.returned += 1;
  }
  for (const [slot, original] of returning) setOwner(game, [slot], original);
  war.occupied = [];
  return result;
}

/** Which of the winners is holding most of this loser's ground. */
function occupierOf(war, loserId, winners) {
  const counts = new Map();
  for (const [, from, holder] of war.occupied || []) {
    if (from !== loserId || !winners.includes(holder)) continue;
    counts.set(holder, (counts.get(holder) || 0) + 1);
  }
  let best = winners[0];
  let bestCount = -1;
  for (const [holder, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = holder;
    }
  }
  return best;
}

/** Cheap wrapper so war.js does not have to import the territory baseline API. */
function startingArea(game, id) {
  const def = defOf(game, id);
  return def?.area || 1;
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
  // Nobody reaches for the arsenal in week three. Desperation is cumulative,
  // and it takes a couple of quarters of losing to accumulate — without this,
  // sharpened force ratios put a great-power war over the threshold in its
  // first quarter and every one of them ended in a mushroom cloud.
  if (game.turn - war.startTurn < 2) return 0;

  const ids = war[losingSide];
  const arsenal = ids.reduce((sum, id) => sum + (game.nations[id]?.nukes || 0), 0);
  if (arsenal <= 0) return 0;

  const spent = war.exhaustion[losingSide] / 100;
  if (spent < 0.18) return 0;

  const desperation = (Math.abs(war.warScore) - 55) / 45;
  const base = 0.02 + desperation * 0.1 * spent;
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
  for (const other of sovereignStates(game)) {
    if (other.id === userId) continue;
    adjustRelation(game, userId, other.id, -45);
  }

  concludeWar(game, war, rng, 'nuclear');

  const text = `NUCLEAR RELEASE. ${NATIONS_BY_ID[userId].name} employs nuclear weapons against ${NATIONS_BY_ID[victimId].name}. The post-1945 taboo is over.`;
  logEvent(game, { type: 'nuclear', severity: 'critical', text, nations: [userId, victimId] });
  return { type: 'nuclear', title: 'Nuclear Release', text, warId: war.id };
}

/**
 * Make the ground you are standing on yours, before any peace can hand it back.
 *
 * This is the player's direct route to taking territory: everything currently
 * occupied stops being occupied and starts being owned. It is not free —
 * annexation is the thing the rest of the world reacts to, not the occupation.
 *
 * @returns {{cells: number, area: number} | null}
 */
export function annexOccupied(game, war, actorId) {
  if (!war?.occupied?.length) return null;
  const mine = war.occupied.filter(([, , holder]) => holder === actorId);
  if (!mine.length) return null;

  const cells = landCells();
  let area = 0;
  for (const [slot] of mine) area += cellArea(cells[slot]);
  // Dropping them from the occupation list is what makes it permanent: the
  // peace only ever hands back what is still on that list.
  war.occupied = war.occupied.filter(([, , holder]) => holder !== actorId);

  const state = game.nations[actorId];
  if (state) {
    state.unrest = clamp(state.unrest + 4);
    state.influence = clamp(state.influence - 3);
  }
  game.worldTension = clamp(game.worldTension + 8, 0, 100);
  for (const otherId of sovereignIds(game)) {
    if (otherId === actorId) continue;
    adjustRelation(game, actorId, otherId, -6);
  }

  logEvent(game, {
    type: 'territory',
    severity: 'critical',
    text: t('war.annexOccupied',
      '{nation} formally annexes the occupied territories — roughly {n},000 km². The maps are reprinted the same week.',
      { nation: tNation(defOf(game, actorId)), n: Math.round(area / 1000) }),
    nations: [actorId],
  });
  return { cells: mine.length, area: area / 1000 };
}

/** Refuse to stop at a decided war. One quarter of it, at a price. */
export function pressWar(game, war, actorId) {
  if (!war?.active) return null;
  war.pressed = true;
  const side = war.attackers.includes(actorId) ? 'attackers' : 'defenders';
  war.exhaustion[side] = clamp(war.exhaustion[side] + 6, 0, 100);
  game.worldTension = clamp(game.worldTension + 5, 0, 100);
  return { pressed: true };
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
  const ground = settleOccupation(game, war, rng, kind, winners, losers);
  war.annexedCells = ground.annexed;
  war.absorbed = ground.absorbed.map((a) => a.id);

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

  const borders = ground.absorbed.length
    ? ` ${t('war.endConquest', '{list} no longer exists as an independent state.', {
        list: ground.absorbed.map((a) => tNation(defOf(game, a.id))).join(', '),
      })}`
    : ground.annexed
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
    absorbed: ground.absorbed,
  };
}
