// Numbers, framed.
//
// "Stability 58" tells a player almost nothing. "Stability 58, ▲2 this quarter,
// 21st of 56, holding" tells them where they stand, which way they are going,
// and whether to worry. Every figure the interface shows should be able to
// answer at least two of those three, and this module is where that framing
// lives so it reads the same everywhere.

import { defOf, livePower, rankedNations } from '../engine/state.js';
import { areaOf, startingAreaOf } from '../engine/territory.js';
import { t, tNation } from '../i18n/index.js';

/** Where a country sits on one statistic, 1 = highest. */
export function rankOf(game, id, pick) {
  const values = Object.values(game.nations).map((s) => ({ id: s.id, v: pick(s, game) }));
  values.sort((a, b) => b.v - a.v);
  return values.findIndex((r) => r.id === id) + 1;
}

export function totalNations(game) {
  return Object.keys(game.nations).length;
}

/** "21st of 56" — the same phrasing wherever a rank appears. */
export function rankLabel(game, rank) {
  return t('context.rank', '#{n} of {total}', { n: rank, total: totalNations(game) });
}

const BANDS = {
  stability: [
    [78, 'stability.solid', 'solid'],
    [60, 'stability.holding', 'holding'],
    [45, 'stability.strained', 'strained'],
    [30, 'stability.fragile', 'fragile'],
    [0, 'stability.failing', 'failing'],
  ],
  unrest: [
    [75, 'unrest.boiling', 'boiling'],
    [58, 'unrest.angry', 'angry'],
    [40, 'unrest.restless', 'restless'],
    [22, 'unrest.grumbling', 'grumbling'],
    [0, 'unrest.calm', 'calm'],
  ],
  approval: [
    [70, 'approval.commanding', 'commanding'],
    [55, 'approval.comfortable', 'comfortable'],
    [42, 'approval.narrow', 'a narrow lead'],
    [28, 'approval.weak', 'weak'],
    [0, 'approval.collapsed', 'collapsed'],
  ],
  military: [
    [80, 'military.firstRate', 'first-rate'],
    [60, 'military.capable', 'capable'],
    [40, 'military.regional', 'regional'],
    [20, 'military.limited', 'limited'],
    [0, 'military.token', 'token'],
  ],
  readiness: [
    [80, 'readiness.deployable', 'deployable now'],
    [60, 'readiness.mostly', 'mostly ready'],
    [40, 'readiness.patchy', 'patchy'],
    [0, 'readiness.hollow', 'hollow'],
  ],
  tech: [
    [82, 'tech.frontier', 'at the frontier'],
    [65, 'tech.advanced', 'advanced'],
    [48, 'tech.catching', 'catching up'],
    [30, 'tech.behind', 'behind'],
    [0, 'tech.farBehind', 'far behind'],
  ],
  influence: [
    [80, 'influence.global', 'global reach'],
    [60, 'influence.major', 'a major voice'],
    [40, 'influence.regional', 'regional'],
    [20, 'influence.limited', 'limited'],
    [0, 'influence.marginal', 'marginal'],
  ],
  tension: [
    [80, 'tension.brink', 'on the brink'],
    [62, 'tension.dangerous', 'dangerous'],
    [45, 'tension.uneasy', 'uneasy'],
    [28, 'tension.manageable', 'manageable'],
    [0, 'tension.calm', 'calm'],
  ],
};

/** A plain word for where a 0-100 figure sits. */
export function bandOf(key, value) {
  const table = BANDS[key];
  if (!table) return '';
  for (const [floor, id, english] of table) {
    if (value >= floor) return t(`band.${id}`, english);
  }
  return '';
}

/** Change since last quarter, from the country's own history. */
export function deltaOf(state, key) {
  const history = state.history || [];
  const previous = history[history.length - 2];
  if (!previous || !(key in previous)) return null;
  const now = Number(state[key]);
  const then = Number(previous[key]);
  if (!Number.isFinite(now) || !Number.isFinite(then)) return null;
  const change = now - then;
  return Math.abs(change) < 0.5 ? null : change;
}

/** GDP per head, in dollars. */
export function perCapita(state) {
  return (state.gdp / Math.max(state.population, 0.01)) * 1e6;
}

export function formatPerCapita(state) {
  const value = perCapita(state);
  return value >= 1000
    ? `$${(value / 1000).toFixed(1)}k`
    : `$${Math.round(value)}`;
}

/** Human-sized land area with its share of the world's claimed land. */
export function formatArea(game, id) {
  const now = areaOf(game, id);
  const text = now >= 1000 ? `${(now / 1000).toFixed(2)}M km²` : `${Math.round(now).toLocaleString()}k km²`;
  const start = startingAreaOf(game, id);
  if (!start) return { text, change: null };
  const change = ((now - start) / start) * 100;
  return { text, change: Math.abs(change) < 1 ? null : change };
}

/** Everything the interface wants to say about one 0-100 statistic. */
export function statContext(game, id, key) {
  const state = game.nations[id];
  if (!state) return null;
  return {
    value: Math.round(state[key]),
    delta: deltaOf(state, key),
    rank: rankOf(game, id, (s) => s[key] || 0),
    total: totalNations(game),
    band: bandOf(key, state[key]),
  };
}

/** Overall standing, used where one number has to stand for the whole country. */
export function powerContext(game, id) {
  const ranked = rankedNations(game);
  const rank = ranked.findIndex((r) => r.state.id === id) + 1;
  const top = ranked[0] ? livePower(game, ranked[0].state.id) : 1;
  return {
    rank,
    total: ranked.length,
    share: top > 0 ? livePower(game, id) / top : 0,
  };
}

/** "+2 this quarter" / "−1 this quarter", or nothing when it did not move. */
export function deltaLabel(delta, digits = 0) {
  if (delta === null || delta === undefined) return '';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta).toFixed(digits)}`;
}

/**
 * How much of the quarter is actually yours to shape.
 *
 * The player asked to be able to feel more or less in control depending on the
 * scenario, so this is that feeling made into a number: what you can spend, how
 * far your government can push, and how much is already moving without you.
 * High grip means your orders mostly land. Low grip means you are answering the
 * world rather than setting it.
 *
 * @returns {{value: number, band: string, pressures: Array<{id: string, label: string, weight: number}>}}
 */
export function gripOn(game, ladders = [], wars = []) {
  const state = game.nations[game.playerId];
  if (!state) return { value: 0, band: '', pressures: [] };

  // What you have: capital to spend, a public that will follow, institutions
  // that can execute, and money that is not already spoken for.
  const capital = Math.min(1, game.politicalCapital / 9);
  const consent = state.approval / 100;
  const machinery = state.stability / 100;
  const purse = state.treasury >= 0 ? 1 : Math.max(0, 1 + state.treasury / (state.gdp * 300));

  // What is happening regardless: crises on your desk, ladders you are standing
  // on, wars you are in, and a world that is already tense.
  const pressures = [];
  if (game.pendingDecision) pressures.push({ id: 'decision', label: game.pendingDecision.title, weight: 0.12 });
  for (const ladder of ladders.filter((l) => l.value >= 4).slice(0, 3)) {
    pressures.push({
      id: `ladder-${ladder.id}`,
      label: `${tNation(defOf(game, ladder.id))} — ${ladder.label.toLowerCase()}`,
      weight: 0.05 + ladder.value * 0.012,
    });
  }
  for (const war of wars) pressures.push({ id: war.id, label: war.name, weight: 0.16 });
  if (state.unrest > 60) pressures.push({ id: 'unrest', label: bandOf('unrest', state.unrest), weight: 0.1 });
  if (game.worldTension > 70) pressures.push({ id: 'tension', label: bandOf('tension', game.worldTension), weight: 0.08 });

  const drag = Math.min(0.72, pressures.reduce((sum, p) => sum + p.weight, 0));
  const raw = (capital * 0.3 + consent * 0.24 + machinery * 0.3 + purse * 0.16) * (1 - drag);
  const value = Math.round(Math.max(0, Math.min(1, raw)) * 100);

  const band = value >= 72
    ? t('band.grip.firm', 'you are setting the agenda')
    : value >= 54
      ? t('band.grip.workable', 'you can still choose your fights')
      : value >= 36
        ? t('band.grip.reactive', 'you are mostly reacting')
        : value >= 20
          ? t('band.grip.slipping', 'events are ahead of you')
          : t('band.grip.lost', 'you are being carried');

  return { value, band, pressures };
}
