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
  livePower,
  logEvent,
  sovereignIds,
  sovereignStates,
} from './state.js';
import {
  areaOf,
  cellArea,
  cellsOf,
  frontAnchor,
  hasNoLand,
  landCells,
  setOwner,
  transferLand,
} from './territory.js';
import { annexNation, isSovereign } from './statecraft.js';
import { balancingChance, opposingCoalition, recordAggression } from './coalitions.js';
import { alliedAid, alliesOf, invoke, treatyBetween } from './treaties.js';
import { nameWar } from './warnames.js';
import { MIN_REACH, occupiersFor, reach, theatreOf, theatrePower, theatreWeight } from './reach.js';
import { blocCall, mergeWars, tickWorldWar } from './worldwar.js';
import { aiRally } from './rally.js';
import { breakthrough, drawFronts, frontsOf, terrainOf, tickFronts } from './fronts.js';
import { produce } from './arsenal.js';
import { noteTradeBreak as severTiesNote, restoreTies, severTies } from './dependency.js';

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

export function declareWar(game, attackerId, defenderId, { rng, reason = 'unspecified aims', mods = {} } = {}) {
  if (findWar(game, attackerId, defenderId)) return null;
  const attacker = NATIONS_BY_ID[attackerId];
  const defender = NATIONS_BY_ID[defenderId];
  if (!attacker || !defender) return null;

  // Named for the ground, the cause or the season rather than by joining two
  // adjectives with a dash — and numbered if this theatre has seen it before.
  const naming = nameWar(game, attackerId, defenderId, { reason, rng });

  const war = {
    id: `war-${game.turn}-${attackerId}-${defenderId}`,
    name: naming.name,
    baseName: naming.name.replace(/^The (Second |Third |Fourth |Fifth |Sixth )?/, ''),
    theatre: naming.theatre,
    shape: naming.shape,
    startYear: game.year,
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

  // Who else takes a side. Treaties still bind, but so does alarm: a country
  // that has been taking other people's territory finds the region joining in
  // whether or not anybody signed anything. See engine/coalitions.js.
  const joiners = rng ? opposingCoalition(game, rng, attackerId, defenderId, mods) : [];
  for (const joiner of joiners) war.defenders.push(joiner.id);
  war.balancers = joiners.filter((j) => j.reason === 'balance').map((j) => j.id);

  // And the attacker's own allies, if they signed something that covers a war
  // their friend started. Most defence pacts do not.
  if (rng) {
    for (const ally of alliesOf(game, attackerId)) {
      if (war.attackers.includes(ally.id) || war.defenders.includes(ally.id)) continue;
      if (ally.kind !== 'alliance') continue;
      if (rng.bool(0.55 + getRelation(game, attackerId, ally.id) / 400)) {
        war.attackers.push(ally.id);
        const paper = treatyBetween(game, attackerId, ally.id, 'alliance');
        if (paper) paper.credibility = clamp(paper.credibility + 8, 0, 100);
      }
    }
  }

  recordAggression(game, attackerId, 'war', 1.4);

  // Nobody ships through a front. Trade between the two sides stops the quarter
  // the shooting starts, and both economies feel it in proportion to how much
  // of themselves ran through the other one.
  for (const a of war.attackers) {
    for (const d of war.defenders) {
      const cut = severTies(game, a, d, 1, 0, { by: attackerId, label: naming.name });
      if (a === game.playerId || d === game.playerId) severTiesNote(game, a, d, cut, naming.name);
    }
  }

  // The ground this will actually be fought over, drawn once from the border
  // the two of them share.
  war.fronts = drawFronts(game, war);

  game.wars.push(war);
  game.worldTension = clamp(game.worldTension + 18, 0, 100);
  adjustRelation(game, attackerId, defenderId, -70);
  for (const id of war.defenders) {
    if (id !== defenderId) adjustRelation(game, attackerId, id, -30);
  }

  const others = war.defenders.filter((d) => d !== defenderId);
  const balancing = war.balancers.length;
  logEvent(game, {
    type: 'war',
    severity: 'critical',
    text: `${attacker.name} opens hostilities against ${defender.name}${
      others.length
        ? `. ${others.map((d) => defOf(game, d).name).join(', ')} ${
            balancing
              ? 'come in against it — most of them owe nobody anything, and say so'
              : `honour ${defender.adjective} commitments`
          }.`
        : '.'
    }`,
    nations: [attackerId, ...war.defenders],
  });

  return war;
}

/**
 * What a side is worth *in this war*.
 *
 * Not the sum of its armies — the sum of what each of them can get to the
 * theatre. A coalition of twelve counts for very little if eleven of them are
 * an ocean away with no lift and no bases, which is the difference between a
 * coalition and a communiqué.
 */
function sidePower(game, ids, war = null) {
  if (!war) return ids.reduce((sum, id) => sum + combatPower(game, id), 0);
  return theatrePower(game, ids, war);
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

  const edge = sidePower(game, war[winning], war) / Math.max(0.01, sidePower(game, war[losing], war));
  if (edge < 2.4 && !war.pressed) return false;

  // Nothing left to overrun means nothing left to fight for — and nothing you
  // can reach is the same thing as nothing left, whatever the map says.
  return war[losing].some(
    (id) =>
      areaOf(game, id) > 0 &&
      isSovereign(game, id) &&
      war[winning].some((w) => reach(game, w, id) >= MIN_REACH),
  );
}

/**
 * Advance every active war one quarter.
 * @returns {Array<object>} report entries for the turn briefing
 */
export function tickWars(game, rng, mods) {
  const reports = [];

  // Two wars with the same countries on the same sides are one war. Do this
  // first, so a merged front is fought as a front rather than as two ledgers.
  reports.push(...mergeWars(game));

  for (const war of game.wars) {
    if (!war.active) continue;

    const atkPower = sidePower(game, war.attackers, war) * (1 - war.exhaustion.attackers / 170);
    const defPower = sidePower(game, war.defenders, war) * HOME_GROUND_BONUS * (1 - war.exhaustion.defenders / 170);
    const total = Math.max(1, atkPower + defPower);

    // Each sector is fought on its own terms and its own line moves; the war's
    // headline score is what they add up to. The old single-number swing is
    // still here as the floor, because coalitions and theatre reach are not a
    // property of any one front — but the fronts are what actually decide it.
    const sectors = tickFronts(game, war, rng, mods);
    war.frontNotes = sectors;

    const ratio = Math.log2(Math.max(atkPower, 0.01) / Math.max(defPower, 0.01));
    const swing = Math.max(-32, Math.min(32, ratio * 13)) + rng.normal(0, 5.5);
    // A quarter of the strategic balance, so a coalition still tells; the rest
    // is what happened in the sectors.
    war.warScore = clamp(war.warScore * 0.75 + (war.warScore + swing) * 0.25, -100, 100);

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

    // A war does not have a fixed cast. Every quarter it runs, the aggressor's
    // record grows and somebody else decides they cannot sit this one out.
    const joined = recruitToWar(game, war, rng, mods);
    if (joined) reports.push(joined);

    // …and the organisations people belong to answer for their members, which
    // is the whole point of belonging to one.
    reports.push(...blocCall(game, war, rng));

    // Governments other than yours also work the telephone.
    const rallied = aiRally(game, war, rng, mods);
    if (rallied) reports.push(rallied);

    // Once enough of the world is in, it stops being somebody's war.
    reports.push(...tickWorldWar(game, war, rng, mods));

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
      const theatre = theatreOf(game, war);
      reports.push({
        type: 'war',
        warId: war.id,
        title: war.name,
        text: advance
          ? `${frontLineSummary(war)} ${advance.text}`
          : war.unreachable
            ? `${frontLineSummary(war)} ${t('war.outOfReach',
                'Neither side can put an army on the other’s ground. This is being fought at sea, in the air and over the accounts.')}`
            : frontLineSummary(war),
        warScore: Math.round(war.warScore),
        casualties: war.casualties,
        ground: advance || null,
        worldWar: Boolean(war.worldWar),
        theatre,
        // What each belligerent is actually worth here, which is rarely what it
        // is worth at home.
        weights: [...war.attackers, ...war.defenders]
          .filter((id) => isSovereign(game, id))
          .map((id) => ({
            id,
            side: war.attackers.includes(id) ? 'attackers' : 'defenders',
            weight: Number(theatreWeight(game, id, war).toFixed(2)),
          }))
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 10),
      });
    }
  }

  // Ground you are holding starts paying for itself once it has been held long
  // enough to be administered rather than merely occupied. Taking land is meant
  // to be worth doing.
  reports.push(...occupationDividend(game));

  // "Press the advantage" buys one quarter of momentum, not a standing policy.
  for (const war of game.wars) war.pressed = false;

  game.wars = game.wars.filter((w) => w.active || game.turn - (w.endedTurn ?? 0) < 24);
  return reports;
}

/**
 * What occupied ground is worth once it is actually being run.
 *
 * The whole point of taking territory was, until now, that the map looked
 * different. Ground held for two quarters starts producing: its output, its
 * people and its resources are yours while you hold it, which is why countries
 * do this. It is not free — the occupation burden is applied elsewhere — but it
 * is no longer purely a cost.
 */
function occupationDividend(game) {
  const reports = [];
  const seen = new Map();
  for (const war of game.wars) {
    if (!war.active) continue;
    for (const [, from, holder] of war.occupied || []) {
      if (!isSovereign(game, holder)) continue;
      const key = `${holder}|${from}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    war.heldFor = (war.heldFor || 0) + 1;
  }

  for (const [key, cells] of seen) {
    const [holder, from] = key.split('|');
    const state = game.nations[holder];
    const victim = game.nations[from];
    if (!state || !victim || cells < 2) continue;
    // Value scaled by how much of them you are holding — a district is a
    // district, half a country is an economy.
    const share = Math.min(0.4, cells / Math.max(6, cellsOf(game, from).length + cells));
    const yield_ = victim.gdp * share * 0.09;
    if (yield_ <= 0.0005) continue;
    state.gdp += yield_;
    if (holder === game.playerId) {
      reports.push({
        type: 'occupation',
        title: t('war.dividendTitle', 'What the Occupied Districts Are Worth'),
        text: t('war.dividend',
          'The territory you hold is producing again under your administration: ${n}B a quarter, against the cost of holding it.',
          { n: Math.round(yield_ * 1000) }),
      });
    }
  }
  return reports;
}

/**
 * One more country picks a side, mid-war.
 *
 * Coalitions are not assembled once at the declaration and then frozen. The
 * longer an aggressor is winning, the heavier its record and the more likely
 * the next country along decides it would rather fight now than later.
 */
function recruitToWar(game, war, rng, mods) {
  if (game.turn - war.startTurn < 1) return null;
  // Only against whoever is doing the taking.
  const winning = war.warScore > 0 ? 'attackers' : 'defenders';
  const losing = winning === 'attackers' ? 'defenders' : 'attackers';
  if (Math.abs(war.warScore) < 20) return null;

  const aggressor = war[winning][0];
  const victim = war[losing][0];
  const already = new Set([...war.attackers, ...war.defenders]);

  const candidates = sovereignIds(game).filter((id) => !already.has(id));
  if (!candidates.length) return null;

  // One draw a quarter, weighted — a war should gather a coalition over
  // several quarters, not acquire one wholesale.
  const pick = rng.pick(candidates);
  // A declared armed neutrality is not a magic word, but it is a position, and
  // people who have taken it are much harder to talk into somebody's war.
  const neutral = (game.nations[pick]?.neutralUntil ?? 0) > game.turn ? 0.3 : 1;
  const chance = balancingChance(game, pick, aggressor, victim, mods) * 0.5 * neutral;
  if (!rng.bool(chance)) return null;

  war[losing].push(pick);
  if (!war.balancers) war.balancers = [];
  war.balancers.push(pick);
  adjustRelation(game, pick, aggressor, -45);
  game.worldTension = clamp(game.worldTension + 5, 0, 100);

  const text = t('war.joins',
    '{joiner} enters the war against {aggressor}. It is owed nothing by {victim} and says so plainly.',
    {
      joiner: tNation(defOf(game, pick)),
      aggressor: tNation(defOf(game, aggressor)),
      victim: tNation(defOf(game, victim)),
    });
  logEvent(game, { type: 'war', severity: 'major', text, nations: [pick, aggressor] });
  return { type: 'war-join', warId: war.id, title: 'A Third Party Enters', text, joinerId: pick };
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

  // Who gives ground, and to whom. Both halves of this used to be decided by
  // array order and raw strength, which is how a coalition war ended with a
  // landlocked country administering an island chain it could not have sailed
  // to. Ground now goes to somebody who could actually have marched onto it:
  // every pairing is scored by the taker's reach, and if nobody on the winning
  // side can get to a country, that country is not losing ground this quarter
  // however badly it is losing the war.
  let pick = null;
  for (const candidate of [...yielding].sort((a, b) => areaOf(game, b) - areaOf(game, a))) {
    if (!isSovereign(game, candidate) || areaOf(game, candidate) <= 0) continue;
    const able = occupiersFor(game, gaining, candidate);
    if (!able.length) continue;
    // Prefer the front where the winning side is strongest relative to what it
    // is taking, but only ever among places it can get to.
    const score = able[0].power * able[0].reach * Math.sqrt(areaOf(game, candidate));
    if (!pick || score > pick.score) pick = { target: candidate, gainer: able[0].id, reach: able[0].reach, score };
  }

  if (!pick) {
    // The side that is winning cannot touch the side that is losing. This is a
    // real outcome — an air and naval war, a war of exhaustion, a war decided
    // by blockade — and it is why oceans matter.
    war.unreachable = (war.unreachable || 0) + 1;
    return null;
  }
  war.unreachable = 0;

  const { target, gainer } = pick;
  if (!target || target === gainer) return null;

  const held = areaOf(game, target) * 1000;
  if (held <= 0) return null;

  // 0 at the threshold, 1 at a total rout.
  const pressure = (Math.abs(lead) - 10) / 90;
  const rawEdge = sidePower(game, gaining, war) / Math.max(0.01, sidePower(game, yielding, war));
  // Capped for the size of the bite — beyond a certain advantage you are limited
  // by roads and fuel, not by the enemy — but the uncapped ratio still decides
  // whether the country can be overrun at all.
  const forceEdge = Math.min(2.5, Math.max(0.4, rawEdge));
  // Up to ~45% of what is left, in one quarter, when the rout is total and the
  // attacker outclasses the defender several times over.
  let fraction = Math.min(0.45, 0.04 + pressure * pressure * 0.34 * Math.sqrt(forceEdge));

  // Ground moves through a sector that has broken open, not through an average.
  // A front that is genuinely through is worth far more than the headline score
  // suggests — which is what makes choosing where to attack pay.
  const open = breakthrough(game, war);
  if (open) {
    const through = Math.abs(open.line);
    // A sector that is genuinely through is worth a great deal of ground. This
    // is the reward half of the design: picking the right front, sending the
    // right arms and breaking it open should take more territory in a quarter
    // than four quarters of grinding along the whole line.
    fraction *= through >= 90 ? 3.2 : through >= 70 ? 2.2 : through >= 45 ? 1.55 : 1.15;
    war.brokenFront = open.id;
  } else {
    // No sector is open. Whatever the strategic balance says, an unbroken line
    // does not give up much ground, and this is most of why losing is slow.
    fraction *= 0.6;
    war.brokenFront = null;
  }

  // And a country defends its own heartland harder the less of it is left.
  // Somebody down to a third of their territory is not collapsing faster, they
  // are fighting in their own streets with nowhere to go.
  //
  // It is a defence, not a force field: against an enemy several times their
  // size the last redoubt buys weeks, not the war, or a superpower could never
  // finish a small neighbour at all.
  const left = areaOf(game, target) / Math.max(1, startingArea(game, target));
  if (rawEdge < 4) {
    fraction *= left < 0.35 ? 0.5 : left < 0.6 ? 0.75 : 1;
  }

  // The ceiling rises with the breakthrough: a collapsed sector can give up
  // most of what is behind it in one quarter.
  fraction = Math.min(open && Math.abs(open.line) >= 70 ? 0.68 : 0.45, fraction);

  // And a hard floor. A country being beaten by somebody roughly its own size
  // can be pushed back to a rump, but it cannot be ground out of existence: the
  // last tenth of a homeland costs more than a near-peer has. Only a genuinely
  // overwhelming power gets past this.
  let wanted = held * fraction;
  if (powerGap(game, gaining, [target]) < ERASE_GAP) {
    const floorKm2 = startingArea(game, target) * 1000 * 0.1;
    wanted = Math.max(0, Math.min(wanted, held - floorKm2));
    if (wanted <= 0) {
      war.redoubt = target;
      return null;
    }
  }

  // Beyond this the defender has no army left in the field and the rest of the
  // country is simply occupied. Being beaten badly is not the same as being
  // erased: overrunning a country outright also needs a genuine capability gap,
  // or every near-peer war that went one way would end with a country missing.
  const total =
    Math.abs(lead) >= OVERWHELMING_SCORE &&
    rawEdge >= 3 &&
    game.turn - war.startTurn >= 1;
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

  // Being beaten badly is not the same as being erased. Absorbing a state
  // outright needs a real capability gap as well as a won war — otherwise a
  // near-peer that loses a long war stops existing, which is not how the last
  // two centuries went and is not a thing a player should have happen to them
  // for being outfought by a country their own size.
  if (overwhelming && winners.length) {
    // Anyone who has been pushed off the map, or nearly, stops being a country
    // — as long as whoever is doing it genuinely outclasses *them*. Being
    // beaten badly is not the same as being erased, and the gap is measured
    // against the country being absorbed rather than against everybody who
    // happened to be on its side of the war.
    for (const loserId of losers) {
      if (!isSovereign(game, loserId)) continue;
      if (powerGap(game, winners, [loserId]) < ERASE_GAP) continue;
      const left = areaOf(game, loserId);
      const started = Math.max(1, startingArea(game, loserId));
      if (hasNoLand(game, loserId) || left / started < 0.12) {
        // To whoever actually took the ground — not to whichever ally happens
        // to head the list. A coalition war should not end with the small
        // country that was attacked formally annexing the great power that
        // attacked it, because its name came first.
        const holder = occupierOf(game, war, loserId, winners);
        // And nobody administers a country they could not have reached. If the
        // only winners are an ocean away, the state survives its own defeat —
        // beaten, occupied by nobody, and still on the map.
        if (!holder) continue;
        const done = annexNation(game, loserId, holder, rng, { reason: 'conquest' });
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

/** How much bigger one side is than the other, structurally. */
function powerGap(game, winners, losers) {
  const mine = winners.reduce((sum, id) => sum + livePower(game, id), 0);
  const theirs = losers.reduce((sum, id) => sum + livePower(game, id), 0);
  return mine / Math.max(1, theirs);
}

/** The gap it takes to erase a country rather than merely beat it. */
const ERASE_GAP = 2.6;

/**
 * Which of the winners is holding most of this loser's ground — and, failing
 * that, which of them could plausibly march in. Returns null when the answer is
 * nobody, which is a legitimate answer.
 */
function occupierOf(game, war, loserId, winners) {
  const counts = new Map();
  for (const [, from, holder] of war.occupied || []) {
    if (from !== loserId || !winners.includes(holder)) continue;
    counts.set(holder, (counts.get(holder) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [holder, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = holder;
    }
  }
  if (best) return best;
  const able = occupiersFor(game, winners, loserId);
  return able.length ? able[0].id : null;
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
  recordAggression(game, userId, 'nuclear', 5);

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
  war.endedYear = game.year;

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

  // Everyone stops shooting; nobody forgets. Commerce restarts more slowly than
  // the guns stop: a quarter of what was there comes straight back, the rest
  // has to be rebuilt by somebody.
  for (const a of war.attackers) {
    for (const d of war.defenders) {
      adjustRelation(game, a, d, 18);
      restoreTies(game, a, d, 0.6);
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
