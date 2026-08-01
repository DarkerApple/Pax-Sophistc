// World events. Two kinds:
//   - ambient events, which simply happen and apply their effects
//   - decisions, which land on the player's desk and wait for an answer
//
// Weights are evaluated against live game state, so a stable rich country sees
// a different event stream than a fragile one.

import { NATIONS_BY_ID } from '../data/nations.js';
import { clamp, getRelation, livePower, rankedNations } from './state.js';

const anyNation = (game, rng, filter = () => true) => {
  const pool = Object.values(game.nations).filter((n) => filter(n, NATIONS_BY_ID[n.id]));
  return pool.length ? rng.pick(pool) : null;
};

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
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => {
        const def = NATIONS_BY_ID[n.id];
        return 1 + (def.tags.includes('climate-exposed') || def.tags.includes('delta') ? 2.5 : 0);
      }),
    build: (game, rng, nation) => ({
      text: `A major natural disaster strikes ${NATIONS_BY_ID[nation.id].name}. Reconstruction will run into the tens of billions.`,
      self: { unrest: rng.float(3, 8), stability: -rng.float(1, 4), gdpPct: -rng.float(0.3, 1.2) },
      modifier: { label: 'Disaster recovery', turns: 4, growth: -0.2 },
    }),
  },
  {
    id: 'mass-protest',
    kind: 'nation',
    title: 'Mass Protests',
    weight: 1.4,
    pick: (game, rng) =>
      rng.weighted(Object.values(game.nations), (n) => Math.max(0.05, ((n.unrest - 35) / 12) ** 2)),
    build: (game, rng, nation) => ({
      text: `Sustained protests fill the streets of ${NATIONS_BY_ID[nation.id].name}'s major cities. The government is losing control of the narrative.`,
      self: { unrest: rng.float(4, 10), stability: -rng.float(2, 6), approval: -rng.float(3, 8) },
    }),
  },
  {
    id: 'coup-attempt',
    kind: 'nation',
    title: 'Coup Attempt',
    weight: 0.5,
    pick: (game, rng) => {
      const pool = Object.values(game.nations).filter((n) => n.stability < 45 && n.unrest > 45);
      return pool.length ? rng.weighted(pool, (n) => (50 - n.stability) / 10) : null;
    },
    build: (game, rng, nation) => {
      const succeeds = rng.bool(0.4);
      return {
        text: succeeds
          ? `Elements of the ${NATIONS_BY_ID[nation.id].adjective} armed forces seize the state broadcaster and the capital. The government falls.`
          : `A coup attempt in ${NATIONS_BY_ID[nation.id].name} collapses within 48 hours. The purges begin immediately.`,
        self: succeeds
          ? { stability: -rng.float(10, 20), unrest: rng.float(8, 18), influence: -rng.float(3, 8), gdpPct: -rng.float(1, 3) }
          : { stability: rng.float(1, 5), unrest: rng.float(3, 9), influence: -rng.float(1, 4) },
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

  const count = rng.bool(0.55 * mods.eventFrequency) ? 2 : rng.bool(0.85 * mods.eventFrequency) ? 1 : 0;

  const wantDecision = !game.pendingDecision && rng.bool(0.4 * mods.eventFrequency);
  const pool = EVENTS.filter((e) => (e.kind === 'decision') === wantDecision);

  for (let i = 0; i < Math.max(count, wantDecision ? 1 : 0); i++) {
    const candidates = pool.filter((e) => weightOf(e, game, rng) > 0);
    if (!candidates.length) break;
    const event = rng.weighted(candidates, (e) => weightOf(e, game, rng));
    if (!event) break;
    const result = fireEvent(game, rng, mods, event);
    if (!result) continue;
    if (result.decision) {
      decision = result.decision;
      break;
    }
    entries.push(result.entry);
    // Only ever one decision per turn; ambient events can stack.
    if (wantDecision) break;
  }

  return { entries, decision };
}

function weightOf(event, game, rng) {
  const w = typeof event.weight === 'function' ? event.weight(game, rng) : event.weight;
  return Number.isFinite(w) ? Math.max(0, w) : 0;
}

function fireEvent(game, rng, mods, event) {
  if (event.kind === 'decision') {
    const built = event.build(game, rng);
    if (!built) return null;
    return {
      decision: {
        eventId: event.id,
        title: event.title,
        prompt: built.prompt,
        targetId: built.targetId || null,
        choices: built.choices,
        turn: game.turn,
      },
    };
  }

  if (event.kind === 'nation') {
    const nation = event.pick ? event.pick(game, rng) : anyNation(game, rng);
    if (!nation) return null;
    const built = event.build(game, rng, nation);
    if (!built) return null;
    return {
      entry: {
        type: 'event',
        eventId: event.id,
        title: event.title,
        text: built.text,
        nationId: nation.id,
        effect: {
          self: scaleStats(built.self, mods.eventSeverity),
          modifier: built.modifier,
        },
        appliesTo: nation.id,
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
        title: event.title,
        text: built.text,
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
      text: built.text,
      global: built.global,
      favoured: built.favoured,
      punishesTags: built.punishesTags,
      punishesLowTech: built.punishesLowTech,
      worldTension: (built.worldTension || 0) * mods.eventSeverity,
      severity: mods.eventSeverity,
    },
  };
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
