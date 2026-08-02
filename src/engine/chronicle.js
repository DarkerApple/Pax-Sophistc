// How history remembers you.
//
// A page from a textbook that does not exist, assembled from the run's own
// event log: the wars it recorded, the states that appeared and disappeared,
// the rivalry that defined the decade, the settlement it ended with, and the
// seed that would produce it all again.
//
// Nothing here invents a fact. Every sentence is built from something the
// simulation actually recorded, which is what makes it worth screenshotting —
// the breakaway republic named in the third paragraph is a state the player
// watched declare itself.

import { areaOf, startingAreaOf } from './territory.js';
import { achieved, ambitionOf } from './ambitions.js';
import { congressOutcome } from './congress.js';
import { threatOf } from './coalitions.js';
import {
  blocsOf,
  dateLabel,
  defOf,
  getRelation,
  isSovereign,
  livePower,
  sovereignIds,
} from './state.js';
import { t, tNation } from '../i18n/index.js';

/**
 * Build the closing page.
 *
 * @returns {{title: string, era: string, paragraphs: string[],
 *            ledger: Array<{label: string, value: string}>,
 *            epitaph: string, seed: string}}
 */
export function chronicle(game, score) {
  const def = defOf(game, game.playerId);
  const player = game.nations[game.playerId];
  const nation = tNation(def);
  const startYear = game.year - Math.floor(game.turn / 4);

  const paragraphs = [
    opening(game, nation, startYear, score),
    theEconomy(game, nation, score),
    theWars(game, nation),
    theMap(game, nation),
    theRivalry(game, nation),
    theSettlement(game, nation),
    theVerdict(game, nation, score),
  ].filter(Boolean);

  return {
    title: t('chronicle.title', '{nation}, {from}–{to}', {
      nation,
      from: startYear,
      to: game.year,
    }),
    era: t('chronicle.era', 'From the standard history of the period'),
    paragraphs,
    ledger: ledgerOf(game, score),
    epitaph: epitaph(game, score),
    seed: game.seed,
  };
}

// ── Paragraphs ──────────────────────────────────────────────────────────────

function opening(game, nation, startYear, score) {
  const terms = game.term || 1;
  const def = defOf(game, game.playerId);
  const title = tNation(def, 'leaderTitle');

  const shape = score.total >= 78 ? t('chronicle.shapeStrong', 'is generally treated as a success')
    : score.total >= 60 ? t('chronicle.shapeFair', 'is treated as a competent if unremarkable period')
      : score.total >= 45 ? t('chronicle.shapeMixed', 'is remembered as a period of drift')
        : t('chronicle.shapeBad', 'is remembered badly');

  return terms > 1
    ? t('chronicle.openingTerms',
        'The {title}’s {terms} terms in office, from {from} to {to}, {shape}. Later accounts disagree about almost everything except the dates.',
        { title, terms, from: startYear, to: game.year, shape })
    : t('chronicle.opening',
        'The {title}’s single term, from {from} to {to}, {shape}. Later accounts disagree about almost everything except the dates.',
        { title, from: startYear, to: game.year, shape });
}

function theEconomy(game, nation, score) {
  const player = game.nations[game.playerId];
  const start = game.startSnapshot;
  const change = (player.gdp / start.gdp - 1) * 100;
  const direction = change >= 25 ? t('chronicle.boom', 'grew sharply')
    : change >= 6 ? t('chronicle.grew', 'grew steadily')
      : change >= -3 ? t('chronicle.flat', 'went almost nowhere')
        : t('chronicle.shrank', 'contracted');

  const debt = player.treasury < 0
    ? t('chronicle.inDebt', ' It was left in debt, a fact successive governments were still arguing about years later.')
    : '';

  const commitments = (game.commitments || []).filter((c) => c.completed).length;
  const built = commitments > 0
    ? t('chronicle.built', ' {n} of the period’s large programmes were carried through to completion.', { n: commitments })
    : '';

  return t('chronicle.economy',
    'The economy {direction} over the decade, ending {pct}% {above} where it began.',
    {
      direction,
      pct: Math.abs(change).toFixed(0),
      above: change >= 0 ? t('chronicle.above', 'above') : t('chronicle.below', 'below'),
    }) + built + debt;
}

function theWars(game, nation) {
  const wars = game.wars.filter(
    (w) => w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId),
  );
  if (!wars.length) {
    return t('chronicle.noWars',
      '{nation} fought no wars in this period — an outcome that reads as luck in some accounts and as policy in others.',
      { nation });
  }

  const started = wars.filter((w) => w.attackers.includes(game.playerId)).length;
  const casualties = wars.reduce((sum, w) => sum + (w.casualties || 0), 0);
  const ongoing = wars.filter((w) => w.active).length;
  const names = wars.slice(0, 3).map((w) => w.name).join(', ');

  const opener = started === 0
    ? t('chronicle.warsDefensive', 'Every war of the period was one it was brought into rather than one it chose.', { nation })
    : started === wars.length
      ? t('chronicle.warsOffensive', 'Every war of the period was one {nation} chose.', { nation })
      : t('chronicle.warsMixed', '{n} of the period’s {total} wars were {nation}’s own choice.',
          { n: started, total: wars.length, nation });

  const cost = casualties > 0
    ? t('chronicle.casualties', ' The recorded cost was roughly {n} thousand dead.',
        { n: Math.round(casualties / 1000).toLocaleString() })
    : '';

  const unfinished = ongoing
    ? t('chronicle.unfinished', ' {n} of them had not ended when the term did.', { n: ongoing })
    : '';

  return `${opener} ${t('chronicle.warList', 'They are usually listed as: {names}.', { names })}${cost}${unfinished}`;
}

function theMap(game, nation) {
  const born = Object.values(game.customNations || {});
  const gone = Object.keys(game.nations).filter((id) => game.nations[id].sovereign === false);
  const yours = areaOf(game, game.playerId) / Math.max(1, startingAreaOf(game, game.playerId)) - 1;

  const parts = [];

  if (Math.abs(yours) > 0.02) {
    parts.push(yours > 0
      ? t('chronicle.gained', '{nation} ended the decade {pct}% larger than it began it.',
          { nation, pct: (yours * 100).toFixed(0) })
      : t('chronicle.lost', '{nation} ended the decade {pct}% smaller than it began it.',
          { nation, pct: (Math.abs(yours) * 100).toFixed(0) }));
  }

  if (born.length) {
    const names = born.slice(0, 3).map((d) => tNation(d)).join(', ');
    parts.push(t('chronicle.newStates',
      'The map itself changed: {names}{more} appeared where no state had been.',
      { names, more: born.length > 3 ? t('chronicle.andOthers', ' and {n} others', { n: born.length - 3 }) : '' }));
  }

  if (gone.length) {
    const names = gone.slice(0, 3).map((id) => tNation(defOf(game, id))).join(', ');
    parts.push(t('chronicle.gone',
      '{names}{more} ceased to govern {pronoun} own affairs.',
      {
        names,
        more: gone.length > 3 ? t('chronicle.andOthers', ' and {n} others', { n: gone.length - 3 }) : '',
        pronoun: gone.length > 1 ? t('chronicle.their', 'their') : t('chronicle.its', 'its'),
      }));
  }

  if (!parts.length) {
    return t('chronicle.mapStill',
      'The borders of the period are, unusually, the borders it started with.');
  }
  return parts.join(' ');
}

function theRivalry(game, nation) {
  const past = Object.values(game.pastNemeses || {});
  const current = game.nemesis;
  const all = [...past, ...(current ? [current] : [])];
  if (!all.length) return null;

  const main = all.sort((a, b) => (b.peak ?? 0) - (a.peak ?? 0))[0];
  const rival = defOf(game, main.id);
  if (!rival) return null;

  const ended = !isSovereign(game, main.id)
    ? t('chronicle.rivalGone', 'It ended when {rival} stopped existing as a state.', { rival: tNation(rival) })
    : getRelation(game, game.playerId, main.id) > 20
      ? t('chronicle.rivalMended', 'It ended, improbably, in something close to a working relationship.')
      : t('chronicle.rivalOpen', 'It had not ended when the term did.');

  const origin = main.origin === 'yours'
    ? t('chronicle.rivalYours', 'Contemporary accounts on both sides agree it began with something {nation} did.', { nation })
    : main.origin === 'theirs'
      ? t('chronicle.rivalTheirs', 'It began, by most accounts, with something done to {nation}.', { nation })
      : t('chronicle.rivalMutual', 'Neither side ever agreed on who started it.');

  return t('chronicle.rivalry',
    'The decade is usually taught through one relationship: {nation} and {rival} — the file the government of the day called {codename}. {origin} {ended}',
    { nation, rival: tNation(rival), codename: main.codename, origin, ended });
}

function theSettlement(game, nation) {
  const outcome = congressOutcome(game);
  if (!outcome) return null;
  const congress = game.congress;
  const carried = (congress?.results || []).filter((r) => r.passed).map((r) => r.clause.title);

  if (!carried.length) {
    return t('chronicle.congressNothing',
      'The congress that closed the period agreed on nothing, which most historians treat as the more honest outcome.');
  }

  const yours = outcome.yoursCarried > 0
    ? t('chronicle.congressYours', ' One of the clauses was {nation}’s own.', { nation })
    : '';

  return t('chronicle.congress',
    'The settlement that closed the period carried {n} clause(s): {list}.',
    { n: carried.length, list: carried.join('; ') }) + yours;
}

function theVerdict(game, nation, score) {
  const ambition = ambitionOf(game, game.playerId);
  const got = ambition ? achieved(game, game.playerId) : null;
  const threat = threatOf(game, game.playerId);

  const how = threat > 0.5
    ? t('chronicle.feared', 'Other governments spent the decade organising around {nation} rather than with it.', { nation })
    : game.nations[game.playerId].influence > 70
      ? t('chronicle.heard', '{nation} ended the period as a government other governments listened to.', { nation })
      : t('chronicle.ordinary', '{nation} ended the period much as it began it: one state among many.', { nation });

  const secret = ambition
    ? (got
        ? t('chronicle.ambitionMet',
            ' What the government privately wanted — {title} — it got, though it never said so at the time.',
            { title: ambition.title })
        : t('chronicle.ambitionMissed',
            ' What the government privately wanted — {title} — it did not get. The papers were released decades later.',
            { title: ambition.title }))
    : '';

  return how + secret;
}

// ── The ledger ──────────────────────────────────────────────────────────────

function ledgerOf(game, score) {
  const player = game.nations[game.playerId];
  const start = game.startSnapshot;
  const wars = game.wars.filter(
    (w) => w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId),
  );
  const land = areaOf(game, game.playerId) / Math.max(1, startingAreaOf(game, game.playerId)) - 1;

  return [
    { label: t('chronicle.ledgerTerms', 'Terms served'), value: String(game.term || 1) },
    { label: t('chronicle.ledgerQuarters', 'Quarters in office'), value: String(game.turn) },
    {
      label: t('chronicle.ledgerEconomy', 'Economy'),
      value: `${((player.gdp / start.gdp - 1) * 100).toFixed(0)}%`,
    },
    {
      label: t('chronicle.ledgerLand', 'Territory'),
      value: `${land >= 0 ? '+' : '−'}${Math.abs(land * 100).toFixed(0)}%`,
    },
    { label: t('chronicle.ledgerWars', 'Wars'), value: String(wars.length) },
    { label: t('chronicle.ledgerStarted', 'Of which begun by you'), value: String(game.stats.warsStarted) },
    { label: t('chronicle.ledgerOrders', 'Orders issued'), value: String(game.stats.actionsTaken) },
    { label: t('chronicle.ledgerCrises', 'Crises resolved'), value: String(game.stats.crisesResolved) },
    {
      label: t('chronicle.ledgerBlocs', 'Organisations held'),
      value: String(blocsOf(game, game.playerId).length),
    },
    {
      label: t('chronicle.ledgerNew', 'States created in the period'),
      value: String(Object.keys(game.customNations || {}).length),
    },
    {
      label: t('chronicle.ledgerAmendments', 'Constitutional amendments'),
      value: String((game.constitution?.amendments || []).length),
    },
    { label: t('chronicle.ledgerGrade', 'Grade'), value: `${score.grade} (${score.total})` },
  ];
}

/**
 * The line at the bottom of the page. Deliberately short — it is the part that
 * gets read aloud.
 */
function epitaph(game, score) {
  const player = game.nations[game.playerId];
  const threat = threatOf(game, game.playerId);
  const wars = game.wars.filter(
    (w) => w.attackers.includes(game.playerId) || w.defenders.includes(game.playerId),
  );

  if (!isSovereign(game, game.playerId)) {
    return t('chronicle.epitaphConquered', 'The state did not outlive the government.');
  }
  if (score.total >= 88) {
    return t('chronicle.epitaphGreat', 'They were handed a country and left a position.');
  }
  if (threat > 0.55) {
    return t('chronicle.epitaphFeared', 'Feared abroad, and eventually at home, and eventually for the same reason.');
  }
  const grew = areaOf(game, game.playerId) / Math.max(1, startingAreaOf(game, game.playerId)) - 1;
  const absorbed = Object.values(game.nations).filter(
    (s) => s.sovereign === false && s.annexedBy === game.playerId,
  ).length;
  if (absorbed >= 2) {
    return t('chronicle.epitaphConqueror', 'Left a bigger country and a shorter list of countries.');
  }
  if (grew > 0.25) {
    return t('chronicle.epitaphMap', 'Whatever else is disputed, the map is a different shape.');
  }
  if (grew < -0.15) {
    return t('chronicle.epitaphShrunk', 'Handed on a smaller country than they were handed.');
  }
  if (!wars.length && score.total >= 60) {
    return t('chronicle.epitaphQuiet', 'Nothing much happened, which took a great deal of doing.');
  }
  if (wars.length >= 3) {
    return t('chronicle.epitaphWars', 'Fought too many wars to be called cautious and won too few to be called decisive.');
  }
  if (player.treasury < 0) {
    return t('chronicle.epitaphDebt', 'The programmes outlived the money that was supposed to pay for them.');
  }
  if (score.total < 55) {
    return t('chronicle.epitaphWeak', 'Governed for ten years and changed almost nothing anybody can point to.');
  }
  return t('chronicle.epitaphFair', 'Left the country in better order than the decade deserved.');
}

/** A plain-text version, for the clipboard. Screenshots are how this travels. */
export function chronicleText(page) {
  const lines = [page.title, page.era, '', ...page.paragraphs, ''];
  for (const row of page.ledger) lines.push(`${row.label}: ${row.value}`);
  lines.push('', page.epitaph, '', `seed ${page.seed}`);
  return lines.join('\n');
}
