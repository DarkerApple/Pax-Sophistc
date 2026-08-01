// World events. Two kinds:
//   - ambient events, which simply happen and apply their effects
//   - decisions, which land on the player's desk and wait for an answer
//
// Weights are evaluated against live game state, so a stable rich country sees
// a different event stream than a fragile one.

import { BLOCS, NATIONS_BY_ID } from '../data/nations.js';
import { causeFor } from './causes.js';
import { activeWarsFor, blocsOf, clamp, defOf, getRelation, livePower, rankedNations } from './state.js';
import { joinableBlocs, realign, secede } from './statecraft.js';
import { areaOf, neighboursOf } from './territory.js';
import { t, tNation } from '../i18n/index.js';

const anyNation = (game, rng, filter = () => true) => {
  const pool = Object.values(game.nations).filter((n) => filter(n, NATIONS_BY_ID[n.id]));
  return pool.length ? rng.pick(pool) : null;
};

/** Countries that share a land border with the player, for "next door" events. */
function playerNeighbours(game) {
  return neighboursOf(game, game.playerId).filter((id) => game.nations[id]);
}

/** Weight helper: a country's exposure to something, floored so it never zeroes out. */
const risk = (value, floor = 0.05) => Math.max(floor, value);

/** @type {Array<object>} */
export const EVENTS = [
  // ─── Ambient world events ────────────────────────────────────────────────
  {
    id: 'commodity-shock',
    kind: 'global',
    title: 'Commodity Price Shock',
    weight: (game) => 1.2 + game.worldTension / 60,
    build: (game, rng) => {
      const up = rng.bool(0.55);
      return {
        textKey: up ? 'event.commodity-shock.up' : 'event.commodity-shock.down',
        text: up
          ? 'Energy and food prices spike on supply disruption. Importers are squeezed; exporters bank the windfall.'
          : 'A demand slump collapses commodity prices. Exporters face budget holes; importers get relief.',
        global: {
          growth: up ? -0.12 : 0.08,
          unrest: up ? 1.6 : -0.6,
        },
        favoured: up ? ['energy-exporter', 'gas-to-europe', 'opec-producer', 'swing-producer', 'lng-giant'] : ['export-machine', 'entrepot', 'trade-hub'],
      };
    },
  },
  {
    id: 'pandemic-scare',
    kind: 'global',
    title: 'Novel Pathogen Detected',
    weight: 0.35,
    build: (game, rng) => ({
      text: 'A novel respiratory pathogen surfaces and borders start closing before the science is in.',
      global: { growth: -0.22, unrest: 2.2, stability: -1.2 },
      severityScaled: true,
      rng,
    }),
  },
  {
    id: 'financial-stress',
    kind: 'global',
    title: 'Credit Market Seizure',
    weight: (game) => 0.7 + (game.worldTension > 65 ? 0.6 : 0),
    build: () => ({
      text: 'Funding markets seize. Highly indebted sovereigns discover their creditors have opinions.',
      global: { growth: -0.28, unrest: 1.4 },
      punishesTags: ['debt-heavy', 'imf-programme', 'serial-defaulter', 'debt-stress'],
    }),
  },
  {
    id: 'tech-breakthrough',
    kind: 'nation',
    title: 'Research Breakthrough',
    weight: 1.0,
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => Math.max(0.1, (n.tech - 45) ** 1.6 / 200)),
    build: (game, rng, nation) => ({
      text: `${NATIONS_BY_ID[nation.id].name} announces a breakthrough with clear commercial and defence applications.`,
      self: { tech: rng.float(2, 4), influence: 1.5 },
      modifier: { label: 'Breakthrough dividend', turns: 6, growth: 0.18 },
    }),
  },
  {
    id: 'natural-disaster',
    kind: 'nation',
    title: 'Major Natural Disaster',
    weight: 1.1,
    domain: 'disaster',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => {
        const def = NATIONS_BY_ID[n.id];
        return 1 + ((def.tags || []).includes('climate-exposed') || (def.tags || []).includes('delta') ? 2.5 : 0);
      }),
    build: (game, rng, nation) => {
      const kind = rng.pick([
        ['earthquake', 'An earthquake levels a provincial capital in {nation}'],
        ['flood', 'Weeks of flooding put a third of {nation}\'s farmland under water'],
        ['cyclone', 'A cyclone makes landfall on {nation}\'s most populous coast'],
        ['wildfire', 'Wildfires burn through {nation}\'s interior for eleven days'],
        ['heatwave', 'A heat dome sits over {nation} for a fortnight and does not move'],
      ]);
      const dead = Math.round(rng.float(1.2, 46) * 1000);
      const displaced = Math.round(dead * rng.float(9, 40));
      const cost = rng.float(0.3, 1.2);
      return {
        textKey: `event.natural-disaster.${kind[0]}`,
        text: `${kind[1].replace('{nation}', NATIONS_BY_ID[nation.id].name)}. Roughly ${dead.toLocaleString()} dead, ${(displaced / 1000).toFixed(0)},000 displaced, and a reconstruction bill near ${(cost * nation.gdp * 10).toFixed(0)}bn.`,
        self: { unrest: rng.float(3, 8), stability: -rng.float(1, 4), gdpPct: -cost },
        modifier: { label: 'Disaster recovery', turns: 4, growth: -0.2 },
        figures: { dead, displaced },
      };
    },
  },
  {
    id: 'mass-protest',
    kind: 'nation',
    title: 'Mass Protests',
    weight: 1.4,
    domain: 'unrest',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => Math.max(0.05, ((n.unrest - 35) / 12) ** 2)),
    build: (game, rng, nation) => {
      const crowd = Math.round(rng.float(0.08, 2.4) * Math.max(4, nation.population) * 10) / 10;
      const cities = rng.int(3, 34);
      return {
        text: `Sustained protests fill the streets of ${NATIONS_BY_ID[nation.id].name}'s major cities — an estimated ${crowd.toFixed(1)}m people across ${cities} cities on the largest day. The government is losing control of the narrative.`,
        self: { unrest: rng.float(4, 10), stability: -rng.float(2, 6), approval: -rng.float(3, 8) },
        figures: { crowd, cities },
      };
    },
  },
  {
    id: 'riots',
    kind: 'nation',
    title: 'Riots',
    weight: 1.2,
    domain: 'riot',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => risk(((n.unrest - 45) / 10) ** 2)),
    build: (game, rng, nation) => {
      const nights = rng.int(2, 9);
      const arrests = Math.round(rng.float(0.4, 14) * 1000);
      const dead = rng.int(0, 90);
      return {
        text: `${nights} nights of rioting in ${NATIONS_BY_ID[nation.id].name}. ${arrests.toLocaleString()} arrests, ${dead} dead, and whole commercial districts burnt out. The army is on the streets by the fourth night.`,
        self: {
          unrest: rng.float(6, 14),
          stability: -rng.float(4, 10),
          approval: -rng.float(4, 11),
          gdpPct: -rng.float(0.1, 0.5),
        },
        modifier: { label: 'Emergency policing', turns: 3, growth: -0.14, unrest: 0.8 },
        figures: { nights, arrests, dead },
      };
    },
  },
  {
    id: 'epidemic',
    kind: 'nation',
    title: 'Epidemic',
    weight: 0.8,
    domain: 'epidemic',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) =>
        risk((80 - n.tech) / 30 + n.population / 300)),
    build: (game, rng, nation) => {
      const disease = rng.pick([
        ['cholera', 'A cholera outbreak'],
        ['measles', 'A measles resurgence'],
        ['influenza', 'A severe influenza wave'],
        ['haemorrhagic', 'A viral haemorrhagic fever'],
        ['drugResistant', 'A drug-resistant tuberculosis cluster'],
      ]);
      const cases = Math.round(rng.float(4, 900) * 1000);
      const dead = Math.round(cases * rng.float(0.004, 0.06));
      const districts = rng.int(2, 40);
      return {
        textKey: `event.epidemic.${disease[0]}`,
        text: `${disease[1]} spreads through ${districts} districts of ${NATIONS_BY_ID[nation.id].name}: ${cases.toLocaleString()} confirmed cases and ${dead.toLocaleString()} dead so far. Hospitals in the affected provinces are turning people away.`,
        self: {
          unrest: rng.float(3, 9),
          stability: -rng.float(2, 6),
          gdpPct: -rng.float(0.3, 1.6),
          approval: -rng.float(2, 8),
        },
        modifier: { label: 'Public health emergency', turns: 5, growth: -0.28, unrest: 0.7 },
        figures: { cases, dead, districts },
      };
    },
  },
  {
    id: 'plant-accident',
    kind: 'nation',
    title: 'Power Plant Accident',
    weight: 0.7,
    domain: 'accident',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) =>
        risk((100 - n.tech) / 45 + (n.sanctionedBy?.length ? 1.4 : 0) + (n.treasury < 0 ? 0.8 : 0))),
    build: (game, rng, nation) => {
      const severe = rng.bool(0.3);
      const nuclear = nation.nukes > 0 || nation.tech > 60;
      const dead = severe ? rng.int(40, 900) : rng.int(2, 60);
      const evacuated = severe ? Math.round(rng.float(20, 340) * 1000) : Math.round(rng.float(1, 25) * 1000);
      const mw = rng.int(400, 4200);
      return {
        textKey: severe ? 'event.plant-accident.severe' : 'event.plant-accident.contained',
        text: severe
          ? `Catastrophic failure at a ${mw}MW ${nuclear ? 'nuclear' : 'thermal'} plant in ${NATIONS_BY_ID[nation.id].name}. ${dead} dead, ${(evacuated / 1000).toFixed(0)},000 evacuated inside a 30km ring, and the grid short ${mw}MW going into winter.`
          : `A containment failure at a ${mw}MW plant in ${NATIONS_BY_ID[nation.id].name} is brought under control in nine hours. ${dead} dead, ${(evacuated / 1000).toFixed(0)},000 evacuated, and an inspection regime nobody believes in.`,
        self: severe
          ? { unrest: rng.float(6, 14), stability: -rng.float(4, 9), gdpPct: -rng.float(0.6, 2.2), approval: -rng.float(6, 15) }
          : { unrest: rng.float(2, 6), stability: -rng.float(1, 3), gdpPct: -rng.float(0.1, 0.5), approval: -rng.float(2, 6) },
        modifier: severe
          ? { label: 'Energy shortfall', turns: 6, growth: -0.34, unrest: 0.9 }
          : { label: 'Energy shortfall', turns: 2, growth: -0.12 },
        figures: { dead, evacuated, mw },
      };
    },
  },
  {
    id: 'industrial-accident',
    kind: 'nation',
    title: 'Industrial Disaster',
    weight: 0.8,
    domain: 'accident',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => risk((90 - n.tech) / 40 + n.population / 400)),
    build: (game, rng, nation) => {
      const site = rng.pick([
        ['chemical', 'A chemical plant'],
        ['mine', 'A deep mine'],
        ['dam', 'A tailings dam'],
        ['port', 'A port ammonium store'],
        ['rail', 'A freight derailment'],
      ]);
      const dead = rng.int(12, 620);
      const injured = Math.round(dead * rng.float(4, 22));
      return {
        textKey: `event.industrial-accident.${site[0]}`,
        text: `${site[1]} in ${NATIONS_BY_ID[nation.id].name} fails catastrophically: ${dead} dead, ${injured.toLocaleString()} injured, and an inspection file that shows three ignored warnings.`,
        self: { unrest: rng.float(3, 9), stability: -rng.float(1, 5), approval: -rng.float(4, 11), gdpPct: -rng.float(0.1, 0.7) },
        figures: { dead, injured },
      };
    },
  },
  {
    id: 'coup-attempt',
    kind: 'nation',
    title: 'Coup Attempt',
    weight: 0.6,
    domain: 'coup',
    pick: (game, rng) => {
      const pool = Object.values(game.nations).filter((n) => n.stability < 45 && n.unrest > 45);
      return pool.length ? rng.weighted(pool, (n) => (50 - n.stability) / 10) : null;
    },
    build: (game, rng, nation) => {
      const succeeds = rng.bool(0.4);
      const dead = rng.int(6, 1400);
      const hours = rng.int(6, 96);
      return {
        textKey: succeeds ? 'event.coup-attempt.succeeds' : 'event.coup-attempt.fails',
        text: succeeds
          ? `Elements of the ${NATIONS_BY_ID[nation.id].adjective} armed forces seize the state broadcaster and the capital. The government falls in ${hours} hours; ${dead} are dead.`
          : `A coup attempt in ${NATIONS_BY_ID[nation.id].name} collapses within ${hours} hours, at a cost of ${dead} lives. The purges begin immediately.`,
        self: succeeds
          ? { stability: -rng.float(10, 20), unrest: rng.float(8, 18), influence: -rng.float(3, 8), gdpPct: -rng.float(1, 3) }
          : { stability: rng.float(1, 5), unrest: rng.float(3, 9), influence: -rng.float(1, 4) },
        figures: { dead, hours },
        // A successful coup in a fragile, unhappy country sometimes takes the
        // country's outer provinces with it.
        follow: succeeds
          ? (g, r) => {
              if (nation.unrest > 58 && nation.stability < 35 && r.bool(0.35)) {
                return secede(g, nation.id, r, { cause: 'coup' });
              }
              return null;
            }
          : null,
      };
    },
  },
  {
    id: 'neighbour-coup',
    kind: 'nation',
    title: 'Coup Next Door',
    weight: (game) => (playerNeighbours(game).length ? 0.7 : 0),
    domain: 'coup',
    pick: (game, rng) => {
      const pool = playerNeighbours(game)
        .map((id) => game.nations[id])
        .filter((n) => n && n.stability < 60);
      return pool.length ? rng.weighted(pool, (n) => risk((65 - n.stability) / 8)) : null;
    },
    build: (game, rng, nation) => {
      const friendly = getRelation(game, game.playerId, nation.id) > 25;
      return {
        textKey: friendly ? 'event.neighbour-coup.friendly' : 'event.neighbour-coup.hostile',
        text: friendly
          ? `The government next door in ${NATIONS_BY_ID[nation.id].name} — one you had an understanding with — is removed overnight by its own general staff. Every agreement you signed is now with somebody else.`
          : `A junta takes power in ${NATIONS_BY_ID[nation.id].name}, on your border, and its first broadcast names you. Your frontier garrisons go to a higher alert state within the hour.`,
        self: { stability: -rng.float(2, 6), unrest: rng.float(2, 7), influence: -rng.float(0, 3) },
        relationShock: friendly ? -rng.float(20, 45) : -rng.float(8, 22),
        worldTension: rng.float(2, 7),
      };
    },
  },
  {
    id: 'separatist-uprising',
    kind: 'nation',
    title: 'Separatist Uprising',
    weight: (game) => (game.worldTension > 45 ? 0.55 : 0.35),
    domain: 'separatist',
    pick: (game, rng) => {
      const pool = Object.values(game.nations).filter(
        (n) => n.unrest > 52 && n.stability < 52 && areaOf(game, n.id) > 120,
      );
      return pool.length ? rng.weighted(pool, (n) => risk((n.unrest - 50) / 8 + (55 - n.stability) / 10)) : null;
    },
    build: (game, rng, nation) => {
      const fighters = Math.round(rng.float(2, 60) * 1000);
      return {
        text: `An armed separatist movement takes control of district capitals in outlying ${NATIONS_BY_ID[nation.id].name}. Perhaps ${fighters.toLocaleString()} fighters, and enough captured materiel to hold what they have taken.`,
        self: { unrest: rng.float(6, 14), stability: -rng.float(6, 14), influence: -rng.float(1, 5), gdpPct: -rng.float(0.4, 1.6) },
        modifier: { label: 'Internal insurgency', turns: 8, growth: -0.3, unrest: 1.4 },
        figures: { fighters },
        follow: (g, r) => (r.bool(0.45) ? secede(g, nation.id, r, { cause: 'uprising' }) : null),
      };
    },
  },
  {
    id: 'strike-wave',
    kind: 'nation',
    title: 'General Strike',
    weight: 0.9,
    domain: 'strike',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => risk((n.unrest - 30) / 14 + (n.treasury < 0 ? 1 : 0))),
    build: (game, rng, nation) => {
      const days = rng.int(2, 21);
      const workers = Math.round(rng.float(0.3, 6) * Math.max(3, nation.population) * 10) / 10;
      return {
        text: `A general strike shuts ${NATIONS_BY_ID[nation.id].name} for ${days} days. ${workers.toFixed(1)}m workers out, ports and rail at a standstill, and a settlement that will cost more than the dispute did.`,
        self: { unrest: rng.float(3, 9), approval: -rng.float(3, 9), gdpPct: -rng.float(0.2, 0.9) },
        modifier: { label: 'Industrial action', turns: 3, growth: -0.22 },
        figures: { days, workers },
      };
    },
  },
  {
    id: 'currency-crisis',
    kind: 'nation',
    title: 'Currency Crisis',
    weight: 0.8,
    domain: 'economic',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) =>
        risk((n.treasury < 0 ? 3 : 0) + (60 - n.stability) / 30)),
    build: (game, rng, nation) => {
      const fall = rng.int(11, 62);
      const rate = rng.int(9, 85);
      return {
        text: `${NATIONS_BY_ID[nation.id].name}'s currency falls ${fall}% in eleven trading days. The central bank takes the policy rate to ${rate}% and the queues form outside the banks the same afternoon.`,
        self: { unrest: rng.float(4, 12), stability: -rng.float(2, 7), gdpPct: -rng.float(0.5, 2.4), approval: -rng.float(5, 14) },
        modifier: { label: 'Currency collapse', turns: 6, growth: -0.4, unrest: 1.1 },
        figures: { fall, rate },
      };
    },
  },
  {
    id: 'harvest-failure',
    kind: 'nation',
    title: 'Harvest Failure',
    weight: 0.8,
    domain: 'disaster',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => {
        const def = NATIONS_BY_ID[n.id];
        return risk(1 + ((def.tags || []).some((tg) => /grain|agri|climate|breadbasket/.test(tg)) ? 2.4 : 0));
      }),
    build: (game, rng, nation) => {
      const down = rng.int(14, 58);
      const priceUp = rng.int(20, 140);
      return {
        text: `${NATIONS_BY_ID[nation.id].name}'s main harvest comes in ${down}% below forecast. Domestic staple prices are up ${priceUp}% and the export ban follows within a week.`,
        self: { unrest: rng.float(4, 11), gdpPct: -rng.float(0.2, 1.1), approval: -rng.float(3, 9) },
        modifier: { label: 'Food price shock', turns: 4, growth: -0.2, unrest: 1.2 },
        figures: { down, priceUp },
      };
    },
  },
  {
    id: 'assassination',
    kind: 'nation',
    title: 'Assassination',
    weight: 0.4,
    domain: 'political',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => risk((70 - n.stability) / 25)),
    build: (game, rng, nation) => {
      const def = NATIONS_BY_ID[nation.id];
      const survives = rng.bool(0.45);
      return {
        textKey: survives ? 'event.assassination.survives' : 'event.assassination.killed',
        text: survives
          ? `An attempt on the life of the ${def.adjective} ${def.leaderTitle} fails by a matter of metres. The security services are given powers they will not give back.`
          : `The ${def.adjective} ${def.leaderTitle} is assassinated. The constitutional succession is contested before the funeral.`,
        self: survives
          ? { stability: -rng.float(1, 4), unrest: rng.float(3, 8), approval: rng.float(2, 8) }
          : { stability: -rng.float(8, 18), unrest: rng.float(6, 16), influence: -rng.float(2, 7), approval: -rng.float(2, 8) },
        worldTension: rng.float(1, 6),
      };
    },
  },
  {
    id: 'terror-attack',
    kind: 'nation',
    title: 'Mass-Casualty Attack',
    weight: 0.8,
    domain: 'political',
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => risk(n.unrest / 45 + n.population / 400)),
    build: (game, rng, nation) => {
      const dead = rng.int(8, 340);
      const injured = Math.round(dead * rng.float(2, 9));
      return {
        text: `A coordinated attack on transport and a crowded public square in ${NATIONS_BY_ID[nation.id].name} kills ${dead} and injures ${injured}. Nobody has claimed it, which is its own kind of message.`,
        self: { unrest: rng.float(4, 12), stability: -rng.float(2, 7), approval: rng.float(-4, 6), readiness: rng.float(1, 4) },
        worldTension: rng.float(2, 6),
        figures: { dead, injured },
      };
    },
  },
  {
    id: 'bloc-realignment',
    kind: 'nation',
    title: 'Realignment',
    weight: 0.7,
    domain: 'political',
    pick: (game, rng) => {
      const pool = Object.values(game.nations).filter(
        (n) => n.id !== game.playerId && (joinableBlocs(game, n.id).length || blocsOf(game, n.id).length),
      );
      return pool.length ? rng.pick(pool) : null;
    },
    build: (game, rng, nation) => {
      const held = blocsOf(game, nation.id);
      const options = joinableBlocs(game, nation.id);
      const leaving = held.length > 0 && (!options.length || rng.bool(0.35));
      const blocId = leaving ? rng.pick(held) : options.length ? rng.weighted(options, (b) => b.cohesion).id : null;
      if (!blocId) return null;
      const blocName = t(`bloc.${blocId}`, BLOCS[blocId].name);
      return {
        textKey: leaving ? 'event.bloc-realignment.leaves' : 'event.bloc-realignment.joins',
        text: leaving
          ? `${NATIONS_BY_ID[nation.id].name} gives formal notice of withdrawal from ${blocName}. The other members find out from the press release.`
          : `${NATIONS_BY_ID[nation.id].name} signs an accession protocol with ${blocName} after eighteen months of denying any such talks.`,
        vars: { bloc: blocName },
        worldTension: rng.float(0, 5),
        follow: (g, r) => realign(g, nation.id, blocId, !leaving, r),
      };
    },
  },
  {
    id: 'border-incident',
    kind: 'pair',
    title: 'Border Incident',
    weight: (game) => 1.0 + game.worldTension / 45,
    pickPair: (game, rng) => {
      const pairs = [];
      const nations = Object.values(game.nations);
      for (let i = 0; i < nations.length; i++) {
        for (let j = i + 1; j < nations.length; j++) {
          const rel = getRelation(game, nations[i].id, nations[j].id);
          if (rel < -30) pairs.push([nations[i], nations[j], -rel]);
        }
      }
      return pairs.length ? rng.weighted(pairs, (p) => p[2] / 20) : null;
    },
    build: (game, rng, a, b) => ({
      text: `A shooting incident on the ${NATIONS_BY_ID[a.id].adjective}–${NATIONS_BY_ID[b.id].adjective} frontier leaves personnel dead on both sides. Each blames the other.`,
      relationDelta: -rng.float(6, 16),
      worldTension: rng.float(3, 8),
      bothSides: { readiness: rng.float(1, 3), unrest: rng.float(1, 3) },
    }),
  },
  {
    id: 'alliance-strain',
    kind: 'pair',
    title: 'Alliance Strain',
    weight: 0.9,
    pickPair: (game, rng) => {
      const pairs = [];
      const nations = Object.values(game.nations);
      for (let i = 0; i < nations.length; i++) {
        for (let j = i + 1; j < nations.length; j++) {
          if (getRelation(game, nations[i].id, nations[j].id) > 60) pairs.push([nations[i], nations[j], 1]);
        }
      }
      return pairs.length ? rng.pick(pairs) : null;
    },
    build: (game, rng, a, b) => ({
      text: `A burden-sharing row between ${NATIONS_BY_ID[a.id].name} and ${NATIONS_BY_ID[b.id].name} spills into public view.`,
      relationDelta: -rng.float(4, 12),
    }),
  },
  {
    id: 'proxy-flareup',
    kind: 'global',
    title: 'Proxy Conflict Flares',
    weight: (game) => 0.8 + game.worldTension / 55,
    build: (game, rng) => ({
      text: 'A long-frozen proxy conflict reignites, and the usual patrons quietly resume shipments.',
      global: { unrest: 0.6 },
      worldTension: rng.float(4, 10),
    }),
  },
  {
    id: 'migration-wave',
    kind: 'global',
    title: 'Displacement Wave',
    weight: (game) => 0.6 + game.wars.filter((w) => w.active).length * 0.5,
    build: (game, rng) => ({
      text: 'Conflict and drought push a new displacement wave toward wealthier borders. Politics everywhere gets louder.',
      global: { unrest: 1.8, stability: -0.6 },
      worldTension: rng.float(1, 4),
    }),
  },
  {
    id: 'detente',
    kind: 'global',
    title: 'Diplomatic Thaw',
    weight: (game) => (game.worldTension > 55 ? 0.9 : 0.35),
    build: (game, rng) => ({
      text: 'A back-channel summit produces an unexpected framework agreement. Markets rally on the headline alone.',
      global: { growth: 0.08 },
      worldTension: -rng.float(5, 12),
    }),
  },
  {
    id: 'cyber-wave',
    kind: 'global',
    title: 'Critical Infrastructure Intrusions',
    weight: (game) => 0.8 + game.worldTension / 70,
    build: (game, rng) => ({
      text: 'A coordinated intrusion campaign against water, grid, and port operators is disclosed simultaneously in a dozen countries.',
      global: { stability: -0.8, unrest: 1.0 },
      worldTension: rng.float(2, 6),
      punishesLowTech: true,
    }),
  },

  // ─── Decisions (land on the player's desk) ───────────────────────────────
  // ─── Black swans (Chaotic World only) ────────────────────────────────────
  {
    id: 'swan-alignment-flip',
    kind: 'pair',
    chaosOnly: true,
    title: 'Alignment Reversal',
    weight: 1.6,
    pickPair: (game, rng) => {
      const nations = Object.values(game.nations);
      const a = rng.pick(nations);
      const b = rng.pick(nations.filter((n) => n.id !== a.id));
      return a && b ? [a, b, 1] : null;
    },
    build: (game, rng, a, b) => {
      const warming = rng.bool(0.5);
      return {
        text: warming
          ? `${NATIONS_BY_ID[a.id].name} and ${NATIONS_BY_ID[b.id].name} announce a rapprochement nobody in either foreign ministry saw coming.`
          : `${NATIONS_BY_ID[a.id].name} abruptly repudiates its understanding with ${NATIONS_BY_ID[b.id].name}. Ambassadors are recalled the same afternoon.`,
        relationDelta: warming ? rng.float(35, 70) : -rng.float(35, 70),
        worldTension: warming ? -rng.float(2, 6) : rng.float(5, 12),
      };
    },
  },
  {
    id: 'swan-market-crash',
    kind: 'global',
    chaosOnly: true,
    title: 'Global Market Dislocation',
    weight: 1.2,
    build: (game, rng) => ({
      text: 'Something breaks in the plumbing of global finance and nobody can say what. Every asset class moves at once, in the same direction.',
      global: { growth: -rng.float(0.4, 0.9), unrest: rng.float(2, 5), stability: -1.5 },
      worldTension: rng.float(4, 10),
    }),
  },
  {
    id: 'swan-breakthrough-cascade',
    kind: 'global',
    chaosOnly: true,
    title: 'Technological Discontinuity',
    weight: 1.0,
    build: (game, rng) => ({
      text: 'A capability everyone assumed was a decade away arrives at once, and half the world\'s industrial planning is obsolete by lunchtime.',
      global: { growth: rng.float(0.2, 0.6) },
      favoured: ['semiconductors', 'ai-investment', 'compute', 'lithography-monopoly', 'chip-packaging'],
      punishesLowTech: true,
      worldTension: rng.float(3, 9),
    }),
  },
  {
    id: 'swan-defection-wave',
    kind: 'nation',
    chaosOnly: true,
    title: 'State Failure',
    weight: 1.3,
    pick: (game, rng) => rng.weighted(Object.values(game.nations), (n) => Math.max(0.2, (70 - n.stability) / 8)),
    build: (game, rng, nation) => ({
      text: `Central authority in ${NATIONS_BY_ID[nation.id].name} simply stops functioning. Ministries answer to nobody and the currency goes with it.`,
      self: {
        stability: -rng.float(12, 26),
        unrest: rng.float(10, 24),
        influence: -rng.float(4, 10),
        gdpPct: -rng.float(1.5, 4),
      },
      modifier: { label: 'Collapse of authority', turns: 6, growth: -0.5, unrest: 1.6 },
    }),
  },
  {
    id: 'swan-windfall',
    kind: 'nation',
    chaosOnly: true,
    title: 'Improbable Windfall',
    weight: 1.0,
    pick: (game, rng) => rng.pick(Object.values(game.nations)),
    build: (game, rng, nation) => ({
      text: `A discovery, a settlement, or an accident of timing hands ${NATIONS_BY_ID[nation.id].name} a fortune it did nothing to earn.`,
      self: { influence: rng.float(1, 4), gdpPct: rng.float(1, 3.5), approval: rng.float(2, 6) },
      modifier: { label: 'Windfall revenues', turns: 6, growth: 0.4, revenue: 0 },
    }),
  },
  {
    id: 'swan-general-strike',
    kind: 'global',
    chaosOnly: true,
    title: 'Simultaneous Unrest',
    weight: 1.1,
    build: (game, rng) => ({
      text: 'Unconnected protest movements on four continents converge on the same week, the same slogans, and the same enemies.',
      global: { unrest: rng.float(3, 7), stability: -rng.float(1, 3), growth: -0.2 },
      worldTension: rng.float(3, 8),
    }),
  },

  {
    id: 'decision-ultimatum',
    kind: 'decision',
    title: 'Ultimatum Received',
    weight: (game) => {
      const hostile = Object.values(game.nations).filter(
        (n) => n.id !== game.playerId && getRelation(game, game.playerId, n.id) < -45,
      );
      return hostile.length ? 1.3 : 0;
    },
    build: (game, rng) => {
      const hostile = Object.values(game.nations).filter(
        (n) => n.id !== game.playerId && getRelation(game, game.playerId, n.id) < -45,
      );
      const rival = rng.weighted(hostile, (n) => livePower(game, n.id));
      if (!rival) return null;
      const name = NATIONS_BY_ID[rival.id].name;
      return {
        targetId: rival.id,
        prompt: `${name} issues a public ultimatum over a disputed zone, with a deadline of ninety days. Your cabinet is split.`,
        choices: [
          {
            id: 'concede',
            label: 'Concede the point',
            detail: 'Defuse it. Take the domestic hit.',
            effect: { relation: 20, self: { approval: -9, influence: -5, unrest: 3 }, worldTension: -6 },
          },
          {
            id: 'stall',
            label: 'Stall and negotiate',
            detail: 'Neither yield nor refuse. Buy time.',
            chance: 0.6,
            effect: { relation: 6, self: { influence: 1 } },
            failEffect: { relation: -10, self: { approval: -4 }, worldTension: 5 },
          },
          {
            id: 'refuse',
            label: 'Reject it publicly',
            detail: 'Call the bluff. Mobilise.',
            effect: {
              relation: -22, self: { approval: 6, readiness: 4, influence: 2 }, worldTension: 12,
            },
            escalates: true,
          },
        ],
      };
    },
  },
  {
    id: 'decision-scandal',
    kind: 'decision',
    title: 'Corruption Scandal',
    weight: (game) => (game.nations[game.playerId].stability < 70 ? 1.1 : 0.6),
    build: () => ({
      prompt:
        'Documents surface tying senior figures in your government to a procurement kickback scheme. The story is already running.',
      choices: [
        {
          id: 'sack',
          label: 'Sack them immediately',
          detail: 'Cut it off. Lose the faction.',
          effect: { self: { approval: 4, stability: -2, unrest: -3, influence: 1 } },
        },
        {
          id: 'inquiry',
          label: 'Announce an independent inquiry',
          detail: 'Slow, credible, and out of your control.',
          chance: 0.62,
          effect: { self: { approval: 2, stability: 4, unrest: -4, influence: 2 } },
          failEffect: { self: { approval: -8, stability: -5, unrest: 6 } },
        },
        {
          id: 'bury',
          label: 'Bury the story',
          detail: 'Lean on the outlets. Hope it holds.',
          chance: 0.5,
          effect: { self: { approval: 1, unrest: -1 } },
          failEffect: { self: { approval: -14, stability: -8, unrest: 12, influence: -5 } },
        },
      ],
    }),
  },
  {
    id: 'decision-defection',
    kind: 'decision',
    title: 'Defector Requests Asylum',
    weight: 0.8,
    build: (game, rng) => {
      const others = Object.values(game.nations).filter((n) => n.id !== game.playerId);
      const source = rng.weighted(others, (n) => livePower(game, n.id));
      if (!source) return null;
      return {
        targetId: source.id,
        prompt: `A senior ${NATIONS_BY_ID[source.id].adjective} official lands at your border requesting asylum, carrying material your services describe as "extraordinary".`,
        choices: [
          {
            id: 'accept',
            label: 'Grant asylum, debrief fully',
            detail: 'Take the intelligence. Take the diplomatic hit.',
            effect: { self: { tech: 2, influence: 2 }, relation: -18, worldTension: 4 },
          },
          {
            id: 'quiet',
            label: 'Handle it quietly',
            detail: 'Debrief, then move them on to a third country.',
            chance: 0.6,
            effect: { self: { tech: 1, influence: 1 }, relation: -4 },
            failEffect: { relation: -22, self: { influence: -4, approval: -3 }, worldTension: 6 },
          },
          {
            id: 'return',
            label: 'Return them',
            detail: 'Buy goodwill at a price your press will name.',
            effect: { relation: 16, self: { approval: -7, influence: -4 } },
          },
        ],
      };
    },
  },
  {
    id: 'decision-strait',
    kind: 'decision',
    title: 'Chokepoint Closure',
    weight: (game) => (game.worldTension > 55 ? 1.1 : 0.4),
    build: () => ({
      prompt:
        'A strategic strait is effectively closed by a regional actor. Insurance rates triple overnight and your imports are exposed.',
      choices: [
        {
          id: 'convoy',
          label: 'Escort convoys',
          detail: 'Naval assets forward. Expensive and irreversible.',
          chance: 0.7,
          cost: { pctGdp: 0.8 },
          effect: { self: { influence: 5, readiness: 2 }, worldTension: 8 },
          failEffect: { self: { influence: -3, readiness: -4, approval: -5 }, worldTension: 12 },
        },
        {
          id: 'reroute',
          label: 'Reroute and absorb the cost',
          detail: 'Longer voyages, higher prices, no casualties.',
          effect: { modifier: { label: 'Rerouted trade', turns: 4, growth: -0.22 }, self: { unrest: 2 } },
        },
        {
          id: 'coalition',
          label: 'Build a coalition response',
          detail: 'Slower, shared, and it needs friends.',
          chance: 0.55,
          effect: { self: { influence: 7 }, worldTension: -4 },
          failEffect: { self: { influence: -4 }, modifier: { label: 'Rerouted trade', turns: 3, growth: -0.18 } },
        },
      ],
    }),
  },
  {
    id: 'decision-tech-export',
    kind: 'decision',
    title: 'Export Control Demand',
    weight: (game) => (game.nations[game.playerId].tech > 60 ? 1.0 : 0.25),
    build: (game, rng) => {
      const powers = rankedNations(game).filter((n) => n.state.id !== game.playerId).slice(0, 6);
      const demander = rng.pick(powers);
      if (!demander) return null;
      return {
        targetId: demander.state.id,
        prompt: `${demander.def.name} demands you join its export-control regime against a third country. Your exporters are already calling.`,
        choices: [
          {
            id: 'comply',
            label: 'Comply fully',
            detail: 'Alignment now, market access lost.',
            effect: { relation: 16, modifier: { label: 'Lost export licences', turns: 5, growth: -0.2 }, self: { influence: 1 } },
          },
          {
            id: 'partial',
            label: 'Comply on paper only',
            detail: 'Sign it, enforce it loosely.',
            chance: 0.55,
            effect: { relation: 8 },
            failEffect: { relation: -18, self: { influence: -4 }, modifier: { label: 'Secondary sanctions', turns: 5, growth: -0.35 } },
          },
          {
            id: 'refuse',
            label: 'Refuse outright',
            detail: 'Keep the market, lose the friend.',
            effect: { relation: -20, self: { influence: 2, approval: 3 }, modifier: { label: 'Independent trade line', turns: 6, growth: 0.12 } },
          },
        ],
      };
    },
  },
  {
    id: 'decision-succession',
    kind: 'decision',
    title: 'Neighbouring Regime Collapses',
    weight: (game) => {
      const fragile = Object.values(game.nations).filter(
        (n) => n.id !== game.playerId && n.stability < 40,
      );
      return fragile.length ? 0.9 : 0;
    },
    build: (game, rng) => {
      const fragile = Object.values(game.nations).filter(
        (n) => n.id !== game.playerId && n.stability < 40,
      );
      const target = rng.pick(fragile);
      if (!target) return null;
      return {
        targetId: target.id,
        prompt: `The government of ${NATIONS_BY_ID[target.id].name} has effectively ceased to function. Factions are forming and everyone is looking for a patron.`,
        choices: [
          {
            id: 'back',
            label: 'Back a faction',
            detail: 'Money, arms, recognition. High risk, high return.',
            chance: 0.5,
            cost: { pctGdp: 0.9 },
            effect: { relation: 30, self: { influence: 6 }, worldTension: 6 },
            failEffect: { relation: -20, self: { influence: -6, approval: -4 }, worldTension: 10 },
          },
          {
            id: 'humanitarian',
            label: 'Lead the humanitarian response',
            detail: 'Visible, cheap in blood, slow in returns.',
            cost: { pctGdp: 0.4 },
            effect: { self: { influence: 4, approval: 2 }, relation: 12, worldTension: -3 },
          },
          {
            id: 'seal',
            label: 'Seal the border and wait',
            detail: 'Not your problem until it is.',
            effect: { self: { unrest: 2, influence: -2 }, relation: -6 },
          },
        ],
      };
    },
  },
];

/**
 * Roll this turn's events.
 * @returns {{entries: Array, decision: object|null}}
 */
export function rollEvents(game, rng, mods) {
  const entries = [];
  let decision = null;

  const allowed = (e) => !e.chaosOnly || mods.blackSwans;
  const ambientPool = EVENTS.filter((e) => e.kind !== 'decision' && allowed(e));
  const decisionPool = EVENTS.filter((e) => e.kind === 'decision' && allowed(e));

  // Ambient events and desk decisions are rolled independently. They used to
  // share one budget, which meant a high-frequency world spent every turn on a
  // decision and never produced a single ambient event.
  const expected = 0.85 * mods.eventFrequency;
  let count = Math.min(4, Math.floor(expected) + (rng.bool(expected % 1) ? 1 : 0));

  for (let i = 0; i < count; i++) {
    const candidates = ambientPool.filter((e) => weightOf(e, game, rng) > 0);
    if (!candidates.length) break;
    const event = rng.weighted(candidates, (e) => weightOf(e, game, rng));
    if (!event) break;
    const result = fireEvent(game, rng, mods, event);
    if (result?.entry) entries.push(result.entry);
  }

  if (!game.pendingDecision && rng.bool(Math.min(0.8, 0.4 * mods.eventFrequency))) {
    const candidates = decisionPool.filter((e) => weightOf(e, game, rng) > 0);
    if (candidates.length) {
      const event = rng.weighted(candidates, (e) => weightOf(e, game, rng));
      const result = event ? fireEvent(game, rng, mods, event) : null;
      if (result?.decision) decision = result.decision;
    }
  }

  return { entries, decision };
}

function weightOf(event, game, rng) {
  const w = typeof event.weight === 'function' ? event.weight(game, rng) : event.weight;
  return Number.isFinite(w) ? Math.max(0, w) : 0;
}

/**
 * Localise one event's text. English uses the already-interpolated sentence the
 * event built; other languages use a template keyed by event id, with the
 * countries involved passed in as variables so word order can differ.
 */
function eventText(event, built, vars) {
  return t(built.textKey || `event.${event.id}`, built.text, vars);
}

function fireEvent(game, rng, mods, event) {
  if (event.kind === 'decision') {
    const built = event.build(game, rng);
    if (!built) return null;
    return {
      decision: {
        eventId: event.id,
        title: t(`eventTitle.${event.id}`, event.title),
        prompt: t(`decision.${event.id}.prompt`, built.prompt, {
          nation: built.targetId ? tNation(NATIONS_BY_ID[built.targetId]) : '',
        }),
        targetId: built.targetId || null,
        choices: built.choices.map((choice) => ({
          ...choice,
          label: t(`decision.${event.id}.${choice.id}.label`, choice.label),
          detail: t(`decision.${event.id}.${choice.id}.detail`, choice.detail),
        })),
        turn: game.turn,
      },
    };
  }

  if (event.kind === 'nation') {
    const nation = event.pick ? event.pick(game, rng) : anyNation(game, rng);
    if (!nation) return null;
    const built = event.build(game, rng, nation);
    if (!built) return null;
    const cause = event.domain ? causeFor(game, nation, event.domain, rng) : null;
    return {
      entry: {
        type: 'event',
        eventId: event.id,
        title: t(`eventTitle.${event.id}`, event.title),
        // Figures are passed through as variables so a translated template can
        // put them wherever that language wants them, rather than being stuck
        // with English word order.
        text: eventText(event, built, {
          nation: tNation(defOf(game, nation.id)),
          ...formatFigures(built.figures),
          ...(built.vars || {}),
        }),
        cause: cause ? { id: cause.id, text: t(`cause.${cause.id}`, cause.text) } : null,
        figures: built.figures || null,
        nationId: nation.id,
        effect: {
          self: scaleStats(built.self, mods.eventSeverity),
          modifier: built.modifier,
        },
        appliesTo: nation.id,
        // Some events do more than move statistics — they split a country or
        // change which camp it is in. The turn loop runs this once the numbers
        // have landed.
        follow: built.follow || null,
        relationShock: built.relationShock || 0,
        worldTension: (built.worldTension || 0) * mods.eventSeverity,
      },
    };
  }

  if (event.kind === 'pair') {
    const pair = event.pickPair(game, rng);
    if (!pair) return null;
    const [a, b] = pair;
    const built = event.build(game, rng, a, b);
    if (!built) return null;
    return {
      entry: {
        type: 'event',
        eventId: event.id,
        title: t(`eventTitle.${event.id}`, event.title),
        text: eventText(event, built, {
          a: tNation(NATIONS_BY_ID[a.id]),
          b: tNation(NATIONS_BY_ID[b.id]),
        }),
        pair: [a.id, b.id],
        relationDelta: (built.relationDelta || 0) * mods.eventSeverity,
        worldTension: (built.worldTension || 0) * mods.eventSeverity,
        bothSides: scaleStats(built.bothSides, mods.eventSeverity),
      },
    };
  }

  // Global
  const built = event.build(game, rng);
  if (!built) return null;
  return {
    entry: {
      type: 'event',
      eventId: event.id,
      title: event.title,
      text: eventText(event, built, {}),
      global: built.global,
      favoured: built.favoured,
      punishesTags: built.punishesTags,
      punishesLowTech: built.punishesLowTech,
      worldTension: (built.worldTension || 0) * mods.eventSeverity,
      severity: mods.eventSeverity,
    },
  };
}

/** Numbers an event generated, formatted once so every language reads alike. */
function formatFigures(figures) {
  if (!figures) return {};
  const out = {};
  for (const [key, value] of Object.entries(figures)) {
    out[key] = typeof value === 'number' && Math.abs(value) >= 1000
      ? Math.round(value).toLocaleString()
      : value;
    if (typeof value === 'number') out[`${key}K`] = Math.round(value / 1000).toLocaleString();
  }
  return out;
}

function scaleStats(block, factor) {
  if (!block) return null;
  const out = {};
  for (const [k, v] of Object.entries(block)) out[k] = typeof v === 'number' ? v * factor : v;
  return out;
}

/** Apply a global event's spread across every nation. */
export function applyGlobalEvent(game, entry) {
  const severity = entry.severity || 1;
  for (const state of Object.values(game.nations)) {
    const def = NATIONS_BY_ID[state.id];
    let growth = (entry.global?.growth || 0) * severity;
    const favoured = (entry.favoured || []).some((tag) => def.tags.includes(tag));
    const punished = (entry.punishesTags || []).some((tag) => def.tags.includes(tag));
    if (favoured) growth = Math.abs(growth) * 0.8;
    if (punished) growth -= 0.2 * severity;
    if (entry.punishesLowTech && state.tech < 55) growth -= 0.1 * severity;

    if (growth) {
      state.modifiers.push({
        id: `${entry.eventId}-${state.id}-${game.turn}`,
        label: entry.title,
        turnsLeft: 3,
        growth,
        stability: (entry.global?.stability || 0) * severity * 0.4,
        unrest: (entry.global?.unrest || 0) * severity * 0.5,
        influence: 0, readiness: 0, tech: 0, revenue: 0,
        source: 'event',
      });
    }
    if (entry.global?.unrest) {
      state.unrest = clamp(state.unrest + entry.global.unrest * severity * 0.5);
    }
    if (entry.global?.stability) {
      state.stability = clamp(state.stability + entry.global.stability * severity * 0.5);
    }
  }
  if (entry.worldTension) {
    game.worldTension = clamp(game.worldTension + entry.worldTension, 0, 100);
  }
}
