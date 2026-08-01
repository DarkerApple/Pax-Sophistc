// States are not permanent.
//
// Countries here can break apart, hand a province to a neighbour, switch sides,
// and walk out of the alliances they helped found. This module owns all four,
// so the rest of the engine can trigger them from an event, a war, a coup or a
// player order without knowing how a new country gets built.
//
// Everything a generated state needs — name, flag, position, statistics,
// Korean translation — is produced here and stored on the save, so a run stays
// reproducible from its seed and a reload does not lose the map's new borders.

import { BLOCS, NATIONS_BY_ID, registerNation } from '../data/nations.js';
import { t, tNation, tNationIn } from '../i18n/index.js';
import {
  adjustRelation,
  blocsOf,
  clamp,
  defOf,
  getRelation,
  joinBloc,
  leaveBloc,
  logEvent,
  proximity,
  setRelation,
} from './state.js';
import {
  areaOf,
  baseCellsOf,
  carveOutlyingRegion,
  cellCentre,
  centroidOf,
  frontAnchor,
  hasNoLand,
  landCells,
  ownerAt,
  seizeAll,
  setOwner,
  transferLand,
} from './territory.js';

// ── Naming ──────────────────────────────────────────────────────────────────

const COMPASS = [
  { id: 'north', en: 'Northern', ko: '북부' },
  { id: 'south', en: 'Southern', ko: '남부' },
  { id: 'east', en: 'Eastern', ko: '동부' },
  { id: 'west', en: 'Western', ko: '서부' },
  { id: 'upper', en: 'Upper', ko: '상부' },
  { id: 'lower', en: 'Lower', ko: '하부' },
];

// Invented toponyms, so not every breakaway is "Northern Somewhere".
const STEMS = [
  ['Kara', '카라'], ['Vasso', '바소'], ['Terra', '테라'], ['Aldan', '알단'],
  ['Meru', '메루'], ['Zaran', '자란'], ['Orlek', '오를레크'], ['Sabet', '사베트'],
  ['Kaldis', '칼디스'], ['Novin', '노빈'], ['Ferra', '페라'], ['Tayan', '타얀'],
  ['Ilmar', '일마르'], ['Doran', '도란'], ['Bresk', '브레스크'], ['Anteh', '안테'],
];
const ENDINGS = [
  ['ia', '이아'], ['land', '란트'], ['stan', '스탄'], ['mark', '마르크'],
  ['ova', '오바'], ['esia', '에시아'], ['or', '오르'], ['une', '윈'],
];

const FORMS = [
  { en: 'Republic of {x}', ko: '{x} 공화국' },
  { en: '{x} Republic', ko: '{x} 공화국' },
  { en: 'Free State of {x}', ko: '{x} 자유국' },
  { en: '{x} Federation', ko: '{x} 연방' },
  { en: 'Provisional Government of {x}', ko: '{x} 임시정부' },
  { en: 'Democratic Republic of {x}', ko: '{x} 민주공화국' },
  { en: '{x} Confederation', ko: '{x} 연합국' },
  { en: 'Union of {x}', ko: '{x} 동맹' },
];

const GOVERNMENTS = [
  { en: 'Provisional council', ko: '임시 평의회', title: { en: 'Chairman', ko: '의장' } },
  { en: 'Military junta', ko: '군사 정권', title: { en: 'General', ko: '장군' } },
  { en: 'Revolutionary republic', ko: '혁명 공화국', title: { en: 'President', ko: '대통령' } },
  { en: 'Parliamentary republic', ko: '의회 공화국', title: { en: 'Prime Minister', ko: '총리' } },
  { en: 'One-party state', ko: '일당 국가', title: { en: 'First Secretary', ko: '제1서기' } },
];

const NEW_STATE_FLAG = '🏴';

/** Which way the breakaway lies from the capital it is leaving. */
function bearing(parentSeat, centre) {
  const dLat = centre.lat - parentSeat.lat;
  let dLon = centre.lon - parentSeat.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  if (Math.abs(dLat) >= Math.abs(dLon)) {
    return COMPASS.find((c) => c.id === (dLat > 0 ? 'north' : 'south'));
  }
  return COMPASS.find((c) => c.id === (dLon > 0 ? 'east' : 'west'));
}

/**
 * A name in both languages, plus the adjective the war reports will use.
 * Roughly half the time the new state names itself after the region it left,
 * and the rest of the time it invents something.
 */
function inventName(parentDef, centre, rng) {
  let coreEn;
  let coreKo;
  if (rng.bool(0.5)) {
    const dir = bearing(parentDef, centre);
    coreEn = `${dir.en} ${parentDef.name}`;
    coreKo = `${dir.ko} ${tNationIn(parentDef, 'ko')}`;
  } else {
    const [stemEn, stemKo] = rng.pick(STEMS);
    const [endEn, endKo] = rng.pick(ENDINGS);
    coreEn = `${stemEn}${endEn}`;
    coreKo = `${stemKo}${endKo}`;
  }
  const form = rng.pick(FORMS);
  return {
    en: form.en.replace('{x}', coreEn),
    ko: form.ko.replace('{x}', coreKo),
    shortEn: coreEn,
    shortKo: coreKo,
    adjectiveEn: adjectivise(coreEn),
    adjectiveKo: coreKo,
  };
}

function adjectivise(core) {
  if (/(ia|a)$/.test(core)) return `${core}n`;
  if (/(land|mark|stan)$/.test(core)) return `${core}ic`;
  if (/e$/.test(core)) return `${core}an`;
  return `${core}ian`;
}

/** Ids come from the save's own contents, so a seed replays to the same ids. */
function uniqueId(parentId, game) {
  let n = Object.keys(game.customNations || {}).length + 1;
  let id = `${parentId}-ns${game.turn}-${n}`;
  while (NATIONS_BY_ID[id]) {
    n += 1;
    id = `${parentId}-ns${game.turn}-${n}`;
  }
  return id;
}

// ── Secession ───────────────────────────────────────────────────────────────

/**
 * Break a slice off a country and stand it up as a state of its own.
 *
 * The new state inherits from its parent in proportion to the ground it takes:
 * a fifth of the land is roughly a fifth of the people, rather less of the
 * economy, and much less of the army — new states are poorer and weaker than
 * the arithmetic suggests, because the split itself destroys value.
 *
 * @param {object} game
 * @param {string} parentId
 * @param {import('./rng.js').Rng} rng
 * @param {{cause?: string, share?: number}} options
 * @returns {{id: string, def: object, share: number, cause: string} | null}
 */
export function secede(game, parentId, rng, { cause = 'unrest', share = null } = {}) {
  const parentDef = defOf(game, parentId);
  const parentState = game.nations[parentId];
  if (!parentDef || !parentState) return null;
  if (!game.customNations) game.customNations = {};
  if (!game.blocMembership) game.blocMembership = {};

  const wanted = share ?? rng.float(0.16, 0.38);
  const cells = carveOutlyingRegion(game, parentId, wanted);
  if (cells.length < 3) return null;

  const grid = landCells();
  const centre = averageCentre(cells.map((slot) => cellCentre(grid[slot])));
  const beforeArea = areaOf(game, parentId) || 1;

  const id = uniqueId(parentId, game);
  setOwner(game, cells, id);
  const takenShare = clamp(areaOf(game, id) / beforeArea, 0.02, 0.75);

  const name = inventName(parentDef, centre, rng);
  const government = rng.pick(GOVERNMENTS);

  const def = registerNation({
    id,
    name: name.en,
    adjective: name.adjectiveEn,
    flag: NEW_STATE_FLAG,
    lat: Number(centre.lat.toFixed(2)),
    lon: Number(centre.lon.toFixed(2)),
    region: parentDef.region,
    government: government.en,
    leaderTitle: government.title.en,
    area: Math.round(areaOf(game, id)),
    population: 0,
    gdp: 0,
    growth: Math.max(0.1, (parentDef.growth ?? 0.5) * rng.float(0.4, 0.9)),
    military: 0,
    readiness: 0,
    tech: 0,
    stability: 0,
    influence: 0,
    unrest: 0,
    nukes: 0,
    blocs: [],
    doctrine: rng.pick(['survivalist', 'fortress', 'revisionist', 'isolationist']),
    tags: ['new-state', `seceded-from-${parentId}`],
    brief: `Declared independence from ${parentDef.name}. Recognised by few, governed by less.`,
    bornTurn: game.turn,
    parentId,
    i18n: {
      ko: {
        name: name.ko,
        adjective: name.adjectiveKo,
        government: government.ko,
        leaderTitle: government.title.ko,
        brief: `${tNationIn(parentDef, 'ko')}에서 독립을 선언했습니다. 인정한 나라는 거의 없고, 통치는 더 없습니다.`,
      },
    },
  });
  game.customNations[id] = def;

  // Take the parent's share of everything that can be divided.
  const peopleShare = takenShare * rng.float(0.6, 1.25);
  const wealthShare = peopleShare * rng.float(0.45, 0.85);
  const forceShare = Math.pow(takenShare, 0.6) * rng.float(0.2, 0.55);

  const state = {
    id,
    sovereign: true,
    gdp: Math.max(0.004, parentState.gdp * wealthShare),
    baseGrowth: def.growth,
    population: Math.max(0.4, parentState.population * peopleShare),
    treasury: Math.round(parentState.gdp * 1000 * wealthShare * 0.02),
    military: clamp(parentState.military * forceShare, 1, 100),
    readiness: clamp(parentState.readiness * rng.float(0.45, 0.8), 5, 100),
    tech: clamp(parentState.tech * rng.float(0.7, 0.95), 3, 100),
    stability: clamp(rng.float(16, 38)),
    influence: clamp(parentState.influence * rng.float(0.04, 0.18), 1, 100),
    unrest: clamp(rng.float(48, 76)),
    nukes: 0,
    approval: clamp(rng.float(45, 72)),
    modifiers: [],
    atWarWith: [],
    sanctionedBy: [],
    doctrine: def.doctrine,
    lastAction: null,
    history: [{ turn: game.turn, gdp: 0, military: 0, stability: 0 }],
  };

  // A warhead on seceding soil is the nightmare scenario, and occasionally it
  // is exactly what happens.
  if (parentState.nukes > 0 && rng.bool(0.18)) {
    state.nukes = Math.max(1, Math.round(parentState.nukes * takenShare * rng.float(0.1, 0.4)));
    parentState.nukes = Math.max(0, parentState.nukes - state.nukes);
  }

  state.history[0] = { turn: game.turn, gdp: state.gdp, military: state.military, stability: state.stability };
  game.nations[id] = state;

  // The definition sheet is also the country's structural baseline — the level
  // the quarterly drift pulls its stability and unrest back toward. Fill it in
  // from the state we just built, or the new country would be dragged toward
  // zero every quarter and fail before it had a chance to exist.
  Object.assign(def, {
    population: Number(state.population.toFixed(1)),
    gdp: Number(state.gdp.toFixed(3)),
    military: Math.round(state.military),
    readiness: Math.round(state.readiness),
    tech: Math.round(state.tech),
    stability: Math.round(clamp(state.stability + rng.float(8, 20))),
    influence: Math.round(state.influence),
    unrest: Math.round(clamp(state.unrest - rng.float(8, 20))),
    nukes: state.nukes,
  });
  game.blocMembership[id] = [];

  // What the new state took, the parent no longer has.
  parentState.gdp = Math.max(0.005, parentState.gdp - state.gdp);
  parentState.population = Math.max(0.5, parentState.population - state.population);
  parentState.military = clamp(parentState.military - state.military * 0.7, 1, 100);
  parentState.influence = clamp(parentState.influence - rng.float(4, 12));
  parentState.stability = clamp(parentState.stability - rng.float(8, 18));
  parentState.unrest = clamp(parentState.unrest + rng.float(6, 16));
  parentState.approval = clamp(parentState.approval - rng.float(8, 20));

  seedRelationsFor(game, id, parentId, rng);

  logEvent(game, {
    type: 'secession',
    severity: 'critical',
    text: t('statecraft.secession',
      '{child} declares independence from {parent}, taking roughly {pct}% of its territory.',
      { child: tNation(def), parent: tNation(parentDef), pct: Math.round(takenShare * 100) }),
    nations: [parentId, id],
  });

  return { id, def, share: takenShare, cause };
}

function averageCentre(points) {
  let lat = 0;
  let x = 0;
  let y = 0;
  for (const p of points) {
    lat += p.lat;
    x += Math.cos((p.lon * Math.PI) / 180);
    y += Math.sin((p.lon * Math.PI) / 180);
  }
  return {
    lat: lat / points.length,
    lon: (Math.atan2(y / points.length, x / points.length) * 180) / Math.PI,
  };
}

/**
 * A newborn state has no history with anyone, so its relations come from
 * geography and from one very large grievance.
 */
function seedRelationsFor(game, id, parentId, rng) {
  const def = defOf(game, id);
  for (const otherId of Object.keys(game.nations)) {
    if (otherId === id) continue;
    if (otherId === parentId) {
      setRelation(game, id, parentId, -78 + rng.int(-8, 8));
      continue;
    }
    const other = defOf(game, otherId);
    if (!other) continue;
    // Neighbours notice you; distant powers wait and see. Anyone who dislikes
    // the country you left is inclined to like you.
    const near = (proximity(def, other) - 0.4) * 20;
    const enemyOfMyEnemy = -getRelation(game, otherId, parentId) * 0.25;
    setRelation(game, id, otherId, Math.round(near + enemyOfMyEnemy + rng.normal(0, 10)));
  }
}

// ── Conquest ────────────────────────────────────────────────────────────────

/**
 * A conquered state is not deleted — the run has to be able to say what
 * happened to it, and somebody may yet liberate it — but it stops being a
 * player on the board. Everything that iterates countries asks this first.
 */
export function isSovereign(game, id) {
  const state = game.nations[id];
  return Boolean(state) && state.sovereign !== false;
}

/** Every country still running its own affairs. */
export function sovereignIds(game) {
  return Object.keys(game.nations).filter((id) => isSovereign(game, id));
}

/**
 * Absorb a country outright: all its ground, most of its people and economy,
 * a fraction of its army, and a very long tail of resentment.
 *
 * @returns {{id: string, into: string, area: number, population: number} | null}
 */
export function annexNation(game, victimId, conquerorId, rng, { reason = 'conquest' } = {}) {
  const victim = game.nations[victimId];
  const winner = game.nations[conquerorId];
  if (!victim || !winner || victimId === conquerorId) return null;
  if (victim.sovereign === false) return null;

  const seized = seizeAll(game, victimId, conquerorId);

  const people = victim.population;
  const economy = victim.gdp;
  // Occupation is not acquisition: a conquered economy runs at a fraction of
  // what it did, and the army mostly goes home or into the hills.
  winner.population += people;
  winner.gdp += economy * (rng ? rng.float(0.45, 0.75) : 0.6);
  winner.military = clamp(winner.military + victim.military * 0.12, 0, 100);
  winner.influence = clamp(winner.influence + (rng ? rng.float(2, 7) : 4));
  winner.unrest = clamp(winner.unrest + (rng ? rng.float(6, 16) : 10));
  winner.stability = clamp(winner.stability - (rng ? rng.float(3, 9) : 6));

  addOccupationBurden(game, conquerorId, victimId, rng);

  victim.sovereign = false;
  victim.annexedBy = conquerorId;
  victim.annexedTurn = game.turn;
  victim.gdp = 0.004;
  victim.population = 0;
  victim.military = 0;
  victim.readiness = 0;
  victim.influence = 0;
  victim.nukes = 0;
  victim.modifiers = [];

  // Everyone else takes a view, and it is not a warm one.
  for (const otherId of sovereignIds(game)) {
    if (otherId === conquerorId) continue;
    adjustRelation(game, conquerorId, otherId, -(rng ? rng.int(10, 30) : 18));
  }
  // Its wars are over, one way or another.
  for (const war of game.wars) {
    if (!war.active) continue;
    war.attackers = war.attackers.filter((id) => id !== victimId);
    war.defenders = war.defenders.filter((id) => id !== victimId);
    if (!war.attackers.length || !war.defenders.length) {
      war.active = false;
      war.endedTurn = game.turn;
      war.outcome = war.outcome || 'Conquest';
    }
  }

  logEvent(game, {
    type: 'conquest',
    severity: 'critical',
    text: t('statecraft.annexed',
      '{victim} ceases to exist as an independent state. {winner} now administers all {n},000 km² of it.',
      {
        victim: tNation(defOf(game, victimId)),
        winner: tNation(defOf(game, conquerorId)),
        n: Math.round(seized.area),
      }),
    nations: [conquerorId, victimId],
  });

  return { id: victimId, into: conquerorId, area: seized.area, population: people, reason };
}

/** Holding somebody else's country costs you, every quarter, for years. */
function addOccupationBurden(game, conquerorId, victimId, rng) {
  const state = game.nations[conquerorId];
  if (!state) return;
  state.modifiers.push({
    id: `occupation-${victimId}`,
    label: 'Occupation duties',
    turnsLeft: 16,
    growth: -0.22,
    stability: -0.25,
    unrest: 1.1,
    influence: 0,
    readiness: -0.4,
    tech: 0,
    revenue: -(state.gdp * 1000 * 0.004),
    source: 'conquest',
  });
  if (rng && rng.bool(0.5)) {
    state.modifiers.push({
      id: `insurgency-${victimId}`,
      label: 'Insurgency in occupied territory',
      turnsLeft: 12,
      growth: -0.18,
      unrest: 1.4,
      stability: -0.3,
      influence: 0, readiness: -0.6, tech: 0, revenue: 0,
      source: 'conquest',
    });
  }
}

/**
 * The reverse: somebody takes the ground back, and the state is on the map
 * again. Called when a conquered country's land ends up in other hands.
 */
export function restoreNation(game, id, rng) {
  const state = game.nations[id];
  const def = defOf(game, id);
  if (!state || !def || state.sovereign !== false) return null;

  state.sovereign = true;
  state.annexedBy = null;
  state.gdp = Math.max(0.01, def.gdp * (rng ? rng.float(0.2, 0.45) : 0.3));
  state.population = Math.max(0.5, def.population * (rng ? rng.float(0.6, 0.9) : 0.75));
  state.military = clamp(def.military * (rng ? rng.float(0.1, 0.3) : 0.2), 1, 100);
  state.readiness = clamp(def.readiness * 0.5, 5, 100);
  state.stability = clamp(rng ? rng.float(18, 40) : 28);
  state.unrest = clamp(rng ? rng.float(45, 72) : 58);
  state.approval = clamp(rng ? rng.float(50, 80) : 65);

  logEvent(game, {
    type: 'conquest',
    severity: 'major',
    text: t('statecraft.restored', '{nation} is on the map again, governing from rubble.',
      { nation: tNation(def) }),
    nations: [id],
  });
  return { id };
}

/**
 * Sweep for states that have lost every acre. Called once a quarter so a
 * country pushed off the map by any route — war, secession, sale — is dealt
 * with the same way.
 */
export function reconcileSovereignty(game, rng) {
  const changes = [];
  for (const id of Object.keys(game.nations)) {
    const state = game.nations[id];
    if (!state) continue;
    const landless = hasNoLand(game, id);
    if (state.sovereign !== false && landless) {
      // Whoever holds the most of its former ground is the occupier.
      const successor = largestHolderOfFormerLand(game, id);
      if (successor) {
        const done = annexNation(game, id, successor, rng, { reason: 'attrition' });
        if (done) changes.push(done);
      }
    } else if (state.sovereign === false && !landless) {
      const done = restoreNation(game, id, rng);
      if (done) changes.push(done);
    }
  }
  return changes;
}

function largestHolderOfFormerLand(game, id) {
  const counts = new Map();
  for (const slot of baseCellsOf(game, id)) {
    const owner = ownerAt(game, slot);
    if (!owner || owner === id) continue;
    counts.set(owner, (counts.get(owner) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [owner, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = owner;
    }
  }
  return best;
}

/** A state with nothing left to govern stops being a state. */
export function isDefunct(game, id) {
  const state = game.nations[id];
  if (!state) return true;
  return state.sovereign === false || (state.stability <= 0 && state.gdp <= 0.01);
}

// ── Selling and ceding ──────────────────────────────────────────────────────

/**
 * A land sale: money one way, ground the other. Used by the province-sale
 * decision and by any order that trades territory.
 *
 * @returns {{area: number, price: number} | null}
 */
export function sellTerritory(game, sellerId, buyerId, { areaKm2, pricePerThousandKm2 = 0.9 }) {
  const seller = game.nations[sellerId];
  const buyer = game.nations[buyerId];
  if (!seller || !buyer) return null;

  const anchor = frontAnchor(game, sellerId, buyerId) || centroidOf(game, buyerId);
  const moved = transferLand(game, sellerId, buyerId, areaKm2, anchor);
  if (!moved.cells.length) return null;

  const price = moved.area * pricePerThousandKm2;
  seller.treasury += price;
  buyer.treasury -= price;
  // Selling your own soil is never popular at home.
  seller.approval = clamp(seller.approval - 6);
  seller.unrest = clamp(seller.unrest + 4);
  adjustRelation(game, sellerId, buyerId, 10);

  logEvent(game, {
    type: 'territory',
    severity: 'major',
    text: t('statecraft.sale',
      '{seller} cedes roughly {n},000 km² to {buyer} for ${price}B.',
      {
        seller: tNation(defOf(game, sellerId)),
        buyer: tNation(defOf(game, buyerId)),
        n: Math.round(moved.area),
        price: Math.round(price).toLocaleString(),
      }),
    nations: [sellerId, buyerId],
  });
  return { area: moved.area, price };
}

// ── Changing sides ──────────────────────────────────────────────────────────

/** Blocs a country could plausibly be invited into right now. */
export function joinableBlocs(game, id) {
  const held = blocsOf(game, id);
  return Object.values(BLOCS).filter((bloc) => {
    if (held.includes(bloc.id)) return false;
    // You need a friend inside to get an invitation.
    const members = Object.keys(game.nations).filter((n) => n !== id && blocsOf(game, n).includes(bloc.id));
    if (!members.length) return false;
    const warmth = members.reduce((sum, m) => sum + getRelation(game, id, m), 0) / members.length;
    return warmth >= 25;
  });
}

/**
 * Move a country into or out of a bloc, with the diplomatic wash that follows:
 * fellow members warm to you, the bloc's rivals cool.
 *
 * @returns {{blocId: string, joined: boolean} | null}
 */
export function realign(game, id, blocId, joined, rng) {
  const bloc = BLOCS[blocId];
  if (!bloc) return null;
  const changed = joined ? joinBloc(game, id, blocId) : leaveBloc(game, id, blocId);
  if (!changed) return null;

  const members = Object.keys(game.nations).filter((n) => n !== id && blocsOf(game, n).includes(blocId));
  const swing = (bloc.cohesion / 100) * (joined ? 1 : -1);
  for (const member of members) {
    adjustRelation(game, id, member, Math.round(swing * (rng ? rng.float(14, 26) : 20)));
    // And everyone the bloc is at odds with reads it the other way.
    for (const other of Object.keys(game.nations)) {
      if (other === id || other === member) continue;
      if (getRelation(game, member, other) <= -40) {
        adjustRelation(game, id, other, Math.round(-swing * 4));
      }
    }
  }

  const state = game.nations[id];
  if (state) {
    state.influence = clamp(state.influence + (joined ? 3 : -4));
    state.unrest = clamp(state.unrest + (joined ? 1.5 : 3));
  }

  logEvent(game, {
    type: 'alignment',
    severity: 'major',
    text: joined
      ? t('statecraft.joinBloc', '{nation} accedes to {bloc}.',
          { nation: tNation(defOf(game, id)), bloc: t(`bloc.${blocId}`, bloc.name) })
      : t('statecraft.leaveBloc', '{nation} withdraws from {bloc}.',
          { nation: tNation(defOf(game, id)), bloc: t(`bloc.${blocId}`, bloc.name) }),
    nations: [id, ...members.slice(0, 4)],
  });

  return { blocId, joined };
}

/**
 * Countries drift between camps on their own. Called once a quarter: a country
 * whose friendships have moved a long way from its formal commitments will
 * eventually make the paperwork match.
 *
 * @returns {Array<{id: string, blocId: string, joined: boolean}>}
 */
export function driftAlignments(game, rng, mods) {
  const changes = [];
  const churn = 0.02 * (mods?.aiAggression ?? 1);

  for (const id of Object.keys(game.nations)) {
    if (id === game.playerId) continue; // The player changes sides by choosing to.
    const state = game.nations[id];
    if (!state) continue;

    for (const blocId of [...blocsOf(game, id)]) {
      const members = Object.keys(game.nations)
        .filter((n) => n !== id && blocsOf(game, n).includes(blocId));
      if (!members.length) continue;
      const warmth = members.reduce((s, m) => s + getRelation(game, id, m), 0) / members.length;
      // You do not leave an alliance you are merely annoyed with.
      if (warmth < -20 && rng.bool(churn * (1 + Math.abs(warmth) / 60))) {
        const done = realign(game, id, blocId, false, rng);
        if (done) changes.push({ id, ...done });
      }
    }

    if (rng.bool(churn * 0.7)) {
      const options = joinableBlocs(game, id);
      if (options.length) {
        const bloc = rng.weighted(options, (b) => b.cohesion);
        const done = realign(game, id, bloc.id, true, rng);
        if (done) changes.push({ id, ...done });
      }
    }
  }
  return changes;
}
