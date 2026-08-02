// The command screen: dashboard, inspector, map, briefing feed, order planner.

import { BLOCS, NATIONS_BY_ID } from '../data/nations.js';
import {
  ACTIONS,
  ACTIONS_BY_ID as ACTIONS_BY_ID_UI,
  CATEGORIES,
  actionAvailability,
  actionCost,
  actionsInCategory,
  reasonFor,
  situationTags,
  targetedActionsFor,
} from '../engine/actions.js';
import { successChance } from '../engine/resolve.js';
import {
  activeWarsFor,
  blocsOf,
  combatPower,
  dateLabel,
  defOf,
  getRelation,
  isSovereign,
  livePower,
  rankedNations,
  sovereignIds,
} from '../engine/state.js';
import {
  bandOf,
  deltaLabel,
  gripOn,
  formatArea,
  formatPerCapita,
  perCapita,
  powerContext,
  rankLabel,
  rankOf,
  statContext,
} from './context.js';
import {
  blocStandings,
  feared,
  formerStates,
  landMovers,
  newStates,
  recentOfType,
} from './worldview.js';
import { areaOf } from '../engine/territory.js';
import { growthOutlook, ledgerFor, scoreRun } from '../engine/turn.js';
import { LADDER_MAX, playerLadders } from '../engine/consequences.js';
import { availableFunds, creditLimit, debtOf, describeFinances } from '../engine/finance.js';
import { gameModifiers } from '../engine/worldmodes.js';
import { h, money, mount, relationColour, relationLabel, sparkline, statColour } from './dom.js';
import { threatOf } from '../engine/coalitions.js';
import {
  FACTIONS,
  poles,
  politicalCapitalFrom,
  snapshotStandings,
  standingBand,
} from '../engine/factions.js';
import { dossierOn, nemesisReport } from '../engine/nemesis.js';
import { confidenceBand, estimate, estimatedBalance, intelOn } from '../engine/intel.js';
import { REVIEW_EVERY, liveObjectives, nextReviewTurn } from '../engine/mandate.js';
import {
  amend,
  amendmentOptions,
  amendmentsLeft,
  describeConstitution,
  electionBand,
} from '../engine/constitution.js';
import { breakCost, cancel, commitmentsOf, committedSpend } from '../engine/commitments.js';
import { CLAUSE_TYPES, congressOf, lobby, propose, tally } from '../engine/congress.js';
import { ambitionProgress, revealAmbitions } from '../engine/ambitions.js';
import { chronicle, chronicleText } from '../engine/chronicle.js';
import { concludeTerm, electionState, inheritance } from '../engine/lifecycle.js';
import { canQueue, leadership, nextSlotAt, orderSlots } from '../engine/leadership.js';
import { TREATY_KINDS, alliesOf, treatyReport } from '../engine/treaties.js';
import { leverage, tiesReport } from '../engine/dependency.js';
import { exchangeReport } from '../engine/exchanges.js';
import { brinkOfGeneralWar, worldWarReport } from '../engine/worldwar.js';
import { reachDetail, theatreOf, theatreWeight } from '../engine/reach.js';
import { formalName } from '../engine/warnames.js';
import { MAP_FOCUSES, VIEW_MODES, WorldMap, alignmentOf, legendFor } from './map.js';
import { KEY_GROUPS, groupLabel, keyLabel, keybindsIn } from './keys.js';
import { LANGUAGES, currentLanguage, t, tAction, tLabel, tModifier, tNation } from '../i18n/index.js';

const STAT_ROWS = [
  { key: 'stability', label: 'Stability', hint: 'How well your institutions hold. At zero your government falls.' },
  { key: 'approval', label: 'Approval', hint: 'Public support. More approval means more political capital next quarter.' },
  { key: 'unrest', label: 'Unrest', hint: 'Street-level anger. High unrest drags down everything else.', invert: true },
  { key: 'military', label: 'Military', hint: 'Raw hard power, 0 to 100.' },
  { key: 'readiness', label: 'Readiness', hint: 'How much of that force you could actually use this quarter.' },
  { key: 'tech', label: 'Technology', hint: 'Research and industrial sophistication. Raises growth and success odds.' },
  { key: 'influence', label: 'Influence', hint: 'Diplomatic reach. Makes diplomacy and mediation work.' },
].map((row) => ({
  ...row,
  labelOf: () => t(`stat.${row.key}`, row.label),
  hintOf: () => t(`stat.${row.key}Hint`, row.hint),
}));

/** Which way the commercial leverage runs, in words rather than a ratio. */
const GRIP_WORDS = {
  yours: 'they need you more',
  'slightly-yours': 'slightly your way',
  even: 'evenly matched',
  'slightly-theirs': 'slightly theirs',
  theirs: 'you need them more',
};

/** Short names for the four factions, for the two chips on every order card. */
const SHORT_FACTION = {
  staff: 'staff', capital: 'capital', street: 'street', party: 'party',
};

/** An action name that may only exist in a grievance file as free text. */
function tActionName(label, actionId) {
  const action = actionId ? ACTIONS_BY_ID_UI[actionId] : null;
  return action ? tAction(action) : label;
}

const STAT_LABELS = {
  military: 'Military', readiness: 'Readiness', tech: 'Tech', stability: 'Stability',
  influence: 'Influence', unrest: 'Unrest', approval: 'Approval', nukes: 'Warheads',
};

const statLabel = (key) => t(`stat.${key}`, STAT_LABELS[key]);

/**
 * What the "why is this here" chip on an order card says. Every situation the
 * world can produce needs a phrase a player can read at a glance.
 */
const WHY_LABELS = {
  unrest: 'unrest', boiling: 'the streets', riot: 'the riots', calm: 'the calm',
  unpopular: 'your standing', popular: 'your standing', fragile: 'fragility',
  solid: 'your position', debt: 'the debt', tight: 'the budget', rich: 'the surplus',
  inflation: 'prices', stagnant: 'stagnation', growing: 'the boom',
  tension: 'world tension', peaceful: 'the calm', isolated: 'isolation',
  influential: 'your reach', sanctioned: 'the sanctions',
  techLead: 'your lead', techLag: 'falling behind', hollowArmy: 'readiness',
  strongArmy: 'your army', weakArmy: 'your army', nuclear: 'the arsenal',
  energy: 'energy', maritime: 'the sea', agrarian: 'the harvest',
  exporter: 'exports', resource: 'resources', aging: 'demographics', young: 'demographics',
  war: 'the war', warWinning: 'winning', warLosing: 'losing', warExhausted: 'exhaustion',
  warStalled: 'the stalemate', casualties: 'the casualties',
  occupier: 'the occupation', occupied: 'occupied ground',
  peace: 'peacetime', escalation: 'escalation', brink: 'the brink',
  neighbourCrisis: 'next door', hostileNeighbour: 'the neighbour', warNextDoor: 'next door',
  newState: 'the new state', conquest: 'the conquest', borderChange: 'the border',
  nuclearUsed: 'the detonation', disaster: 'the disaster', famine: 'the harvest',
  epidemic: 'the outbreak', accident: 'the accident', coup: 'the coup',
  attack: 'the attack', financial: 'the markets', cyber: 'the intrusions',
  commodityShock: 'prices', refugees: 'the refugees', breakthrough: 'the breakthrough',
  feared: 'how you are seen', pariah: 'how you are seen',
};

/**
 * The league tables. Each one has to answer "compared with whom, and by how
 * much" — a rank on its own is the flat number this interface exists to avoid.
 */
const RANK_METRICS = [
  { id: 'power', name: 'Power', hint: 'Everything weighed together: economy, army, technology, reach.',
    pick: (game, s, id) => livePower(game, id), format: (v) => v.toFixed(0) },
  { id: 'gdp', name: 'Economy', hint: 'Annual output, nominal.',
    pick: (game, s) => s.gdp, format: (v) => `$${v.toFixed(2)}T` },
  { id: 'perCapita', name: 'Per head', hint: 'Output divided by people — wealth rather than size.',
    pick: (game, s) => perCapita(s), format: (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`) },
  { id: 'military', name: 'Army', hint: 'Hard power actually deployable: force weighted by readiness.',
    pick: (game, s, id) => combatPower(game, id), format: (v) => v.toFixed(0) },
  { id: 'land', name: 'Land', hint: 'Ground held right now, not ground held at the start.',
    pick: (game, s, id) => areaOf(game, id),
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}M km²` : `${Math.round(v).toLocaleString()}k km²`) },
  { id: 'population', name: 'People', hint: 'Population, in millions.',
    pick: (game, s) => s.population, format: (v) => `${Math.round(v)}M` },
  { id: 'influence', name: 'Influence', hint: 'Diplomatic reach — who returns your calls.',
    pick: (game, s) => s.influence, format: (v) => v.toFixed(0) },
  { id: 'tech', name: 'Technology', hint: 'Research and industrial sophistication.',
    pick: (game, s) => s.tech, format: (v) => v.toFixed(0) },
  { id: 'stability', name: 'Stability', hint: 'How well the institutions hold.',
    pick: (game, s) => s.stability, format: (v) => v.toFixed(0) },
  { id: 'nukes', name: 'Warheads', hint: 'Deployed and stockpiled warheads.',
    pick: (game, s) => s.nukes, format: (v) => v.toLocaleString() },
];

/** Plain-language notes for the category strip. */
const CATEGORY_HINTS = {
  quick: 'One-capital orders, chosen for what is happening this quarter.',
  economy: 'Growth, money, industry and the books.',
  society: 'Health, schools, housing, culture — the people rather than the police.',
  domestic: 'Order, the constitution, the machinery of governing.',
  military: 'Force: what you build, where you put it, how ready it is.',
  diplomacy: 'Standing, mediation, aid, and pressure short of force.',
  alliances: 'Treaties and blocs: signing them, keeping them, calling them in.',
  trade: 'Commercial statecraft: what you close, what you open, and who feels it.',
  intelligence: 'What you know about them, and what they know about you.',
  technology: 'Research, industry and the long bets.',
  war: 'Only while you are fighting. These move the front itself.',
};

/** The ways an order shelf can be ordered. */
const SORTS = [
  { id: 'relevance', name: 'Relevance', hint: 'What the quarter is actually doing, most pressing first.' },
  { id: 'odds', name: 'Odds', hint: 'Most likely to succeed first.' },
  { id: 'cost', name: 'Cost', hint: 'Cheapest first.' },
  { id: 'capital', name: 'Capital', hint: 'Least political capital first.' },
  { id: 'name', name: 'A–Z', hint: 'Alphabetical, for when you know what you are looking for.' },
];

/**
 * Order the shelf.
 *
 * Relevance keeps the situational ranking and merely floats the suggestions;
 * everything else is a stable sort on one figure, so the situational order is
 * still the tie-break underneath.
 */
function sortCatalogue(catalogue, sortBy, { game, state, mods, recommended }) {
  const byRecommended = (a, b) => Number(recommended.has(b.id)) - Number(recommended.has(a.id));
  switch (sortBy) {
    case 'odds':
      return [...catalogue].sort((a, b) =>
        successChance(game, b, game.playerId, null, mods) - successChance(game, a, game.playerId, null, mods));
    case 'cost':
      return [...catalogue].sort((a, b) => actionCost(a, state) - actionCost(b, state));
    case 'capital':
      return [...catalogue].sort((a, b) => (a.pc || 0) - (b.pc || 0));
    case 'name':
      return [...catalogue].sort((a, b) => tAction(a).localeCompare(tAction(b)));
    default:
      return [...catalogue].sort(byRecommended);
  }
}

export class GameScreen {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.category = 'economy';
    this.orders = [];
    this.pendingTargetAction = null;
    this.customDraft = '';
    this.customPriced = null;
    this.customBusy = false;
    this.decisionChoice = null;
    this.feedTab = 'briefing';
    this.detailNationId = null;
    this.advisorLog = [];
    this.advisorBusy = false;
    this.busy = false;
    this.mapMode = 'relations';
    this.showTerritory = true;
    this.hoverId = null;
    this.pinnedId = null;
    this.helpOpen = false;
    // Which face of the world panel is showing, and which league table.
    this.worldTab = 'alignments';
    // The amendment desk and the congress floor are both modal and both opened
    // deliberately; the closing page is opened for you.
    this.amendOpen = false;
    this.congressOpen = false;
    this.endTab = 'verdict';
    this.standingAgain = null;
    this.rankMetric = 'power';
    // How the order shelf is ordered. Relevance is what the situational
    // ranking already decided; the rest are for a player with a specific
    // problem — no money, no capital, or one bad quarter to survive.
    this.sortBy = 'relevance';
    // Which pane a phone is showing. Ignored above the breakpoint, where all
    // three columns are on screen at once.
    this.pane = 'map';
  }

  get game() {
    return this.app.game;
  }

  /** The country the inspector is describing: pinned wins, then hover. */
  get inspectId() {
    return this.pinnedId || this.hoverId;
  }

  render() {
    const game = this.game;
    if (!game) return;

    const camera = this.map ? { ...this.map.camera } : null;
    // Re-rendering replaces the DOM, which would otherwise throw every column
    // back to the top every time a modal opens or an order is queued.
    const scrolls = [...this.root.querySelectorAll('[data-scroll]')]
      .map((el) => [el.dataset.scroll, el.scrollTop]);
    const pageScroll = window.scrollY;

    mount(this.root,
      h('div.game',
        this.#topbar(),
        this.#paneTabs(),
        // On a phone one pane is on screen at a time; the tabs above switch
        // them. Above the breakpoint the data-pane attributes do nothing and
        // all three columns are visible together.
        h('div.game__body', { dataset: { pane: this.pane } },
          h('div.col.col--left', { dataset: { scroll: 'left', pane: 'nation' } },
            this.#dashboard(), this.#factionsPanel(), this.#nemesisPanel(),
            this.#inspector(), this.#escalation(), this.#objectives(),
            this.#government(), this.#relations()),
          h('div.col.col--centre', { dataset: { scroll: 'centre' } },
            h('div.pane', { dataset: { pane: 'map' } }, this.#mapPanel()),
            h('div.pane', { dataset: { pane: 'world' } }, this.#worldPanel()),
            h('div.pane', { dataset: { pane: 'briefing' } }, this.#feed()),
          ),
          h('div.col.col--right', { dataset: { scroll: 'right', pane: 'orders' } }, this.#planner()),
        ),
        this.#actionBar(),
      ),
      this.detailNationId ? this.#nationDetail() : null,
      this.amendOpen ? this.#amendModal() : null,
      this.congressOpen ? this.#congressModal() : null,
      game.pendingDecision && !this.decisionChoice ? this.#decisionModal() : null,
      this.helpOpen ? this.#helpModal() : null,
      game.status !== 'active' ? this.#endgameModal() : null,
    );

    for (const [key, top] of scrolls) {
      const el = this.root.querySelector(`[data-scroll="${key}"]`);
      if (el) el.scrollTop = top;
    }
    if (pageScroll) window.scrollTo(0, pageScroll);

    const holder = this.root.querySelector('[data-map]');
    if (holder) {
      this.map = new WorldMap(holder, {
        onSelect: (id) => this.#onMapSelect(id),
        onHover: (id) => this.#onMapHover(id),
        onViewChange: () => this.#syncZoomLabel(),
      });
      this.map.mode = this.mapMode;
      this.map.showTerritory = this.showTerritory;
      if (camera) this.map.camera = camera;
      this.map.render(game);
      this.map.setSelected(this.pinnedId);
      this.#syncZoomLabel();
    }
  }

  /**
   * The phone's pane switcher. Hidden by CSS on anything wide enough to show
   * the three columns side by side, so it costs desktop nothing.
   */
  #paneTabs() {
    const game = this.game;
    const queued = this.orders.length;
    const panes = [
      { id: 'nation', icon: '⌂', label: t('pane.nation', 'Nation') },
      { id: 'map', icon: '◎', label: t('pane.map', 'Map') },
      { id: 'world', icon: '⌗', label: t('pane.world', 'World') },
      { id: 'briefing', icon: '☰', label: t('pane.briefing', 'Briefing') },
      { id: 'orders', icon: '✎', label: t('pane.orders', 'Orders'), badge: queued || null },
    ];
    return h('nav.panetabs', { 'aria-label': t('pane.switch', 'Switch panel') },
      panes.map((pane) =>
        h('button.panetab', {
          class: this.pane === pane.id ? 'panetab is-active' : 'panetab',
          'aria-pressed': String(this.pane === pane.id),
          onclick: () => { this.pane = pane.id; this.render(); },
        },
          h('span.panetab__icon', pane.icon),
          h('span.panetab__label', pane.label),
          pane.badge ? h('span.panetab__badge', String(pane.badge)) : null,
          // A decision waiting on the desk is the one thing worth a dot.
          pane.id === 'briefing' && game.pendingDecision ? h('span.panetab__dot') : null,
        ),
      ),
    );
  }

  /** Refresh only the inspector — hovering the map must not rebuild the map. */
  #refreshInspector() {
    const slot = this.root.querySelector('[data-inspector]');
    if (slot) mount(slot, this.#inspectorBody());
  }

  #syncZoomLabel() {
    const el = this.root.querySelector('[data-zoom-level]');
    if (el && this.map) el.textContent = `${this.map.zoom.toFixed(1)}×`;
  }

  // ── Top bar ──────────────────────────────────────────────────────────────

  #topbar() {
    const game = this.game;
    const def = NATIONS_BY_ID[game.playerId];
    const state = game.nations[game.playerId];
    const mods = gameModifiers(game);
    const score = scoreRun(game, mods);

    return h('header.topbar',
      h('div.topbar__identity',
        h('span.topbar__flag', def.flag),
        h('div',
          h('div.topbar__country', tNation(def)),
          h('div.topbar__role',
            `${tNation(def, 'leaderTitle')} · ${tLabel('modes', mods.mode.id, mods.mode.name)} · ${tLabel('tiers', mods.tier.name, mods.tier.name)} ${game.difficulty}/10`),
        ),
      ),
      h('div.topbar__metrics',
        metric(t('hud.date', 'Date'), dateLabel(game), t('hud.dateHint', 'Quarter {turn} of {total}', { turn: game.turn, total: game.totalTurns })),
        state.treasury >= 0
          ? metric(
              t('hud.treasury', 'Treasury'),
              money(state.treasury),
              t('hud.treasuryHint', 'Cash in hand. You can also borrow against your credit line.'),
              null,
              t('hud.pctOfGdp', '{pct}% of GDP', { pct: ((state.treasury / (state.gdp * 1000)) * 100).toFixed(0) }),
            )
          : metric(
              t('hud.debt', 'Debt'),
              money(-state.treasury),
              `${describeFinances(state).label}. ${describeFinances(state).detail}`,
              'var(--bad)',
              t('hud.pctOfGdp', '{pct}% of GDP', { pct: ((-state.treasury / (state.gdp * 1000)) * 100).toFixed(0) }),
            ),
        metric(t('hud.canSpend', 'Can spend'), money(availableFunds(state)), t('hud.spendHint', 'Cash plus your remaining credit line')),
        metric(t('hud.politicalCapital', 'Political capital'), `${game.politicalCapital}`, t('hud.pcHint', 'Every order costs some. It refills each quarter.')),
        metric(
          t('hud.gdp', 'GDP'),
          `$${state.gdp.toFixed(2)}T`,
          t('hud.gdpHint', 'Your economy, annualised'),
          null,
          `${formatPerCapita(state)}/head · ${rankLabel(game, rankOf(game, game.playerId, (s) => s.gdp))}`,
        ),
        metric(
          t('hud.worldTension', 'World tension'),
          `${Math.round(game.worldTension)}`,
          t('hud.tensionHint', 'How close the world is to a general crisis'),
          statColour(game.worldTension, true),
          bandOf('tension', game.worldTension),
        ),
        metric(
          t('hud.standing', 'Standing'),
          `${score.total} (${score.grade})`,
          t('hud.standingHint', 'Your run graded as it stands right now'),
          null,
          (() => {
            const power = powerContext(game, game.playerId);
            return t('hud.powerRank', 'power {n} of {total}', { n: power.rank, total: power.total });
          })(),
        ),
      ),
      h('div.topbar__actions',
        // Language is one click away mid-game, not buried in Settings.
        h('div.langswitch.langswitch--sm', { role: 'group', 'aria-label': t('setup.language', 'Language') },
          LANGUAGES.map((lang) =>
            h('button.langswitch__btn', {
              class: currentLanguage() === lang.id ? 'langswitch__btn is-active' : 'langswitch__btn',
              'aria-pressed': String(currentLanguage() === lang.id),
              onclick: () => this.app.setLanguage(lang.id),
            }, lang.native),
          ),
        ),
        h('button.btn.btn--ghost.btn--sm', { onclick: () => { this.helpOpen = true; this.render(); }, title: 'How to play (?)' }, t('hud.howToPlay', 'How to play')),
        h('button.btn.btn--ghost.btn--sm', { onclick: () => this.app.openSettings() }, t('hud.settings', 'Settings')),
        h('button.btn.btn--ghost.btn--sm', { onclick: () => this.app.saveNow() }, t('hud.save', 'Save')),
        h('button.btn.btn--ghost.btn--sm', { onclick: () => this.app.quitToMenu() }, t('hud.menu', 'Menu')),
      ),
    );
  }

  // ── Left column ──────────────────────────────────────────────────────────

  #dashboard() {
    const state = this.game.nations[this.game.playerId];
    const wars = activeWarsFor(this.game, this.game.playerId);

    const grip = gripOn(this.game, playerLadders(this.game), wars);

    return h('section.panel',
      h('h2.panel__title', t('panel.nation', 'The state of the nation')),
      // How much of this quarter is actually yours to shape, and what is
      // already moving without you.
      h('div.grip', { title: t('grip.hint', 'Political capital, public consent, institutional capacity and money, minus everything already running without you.') },
        h('div.grip__head',
          h('span.grip__label', t('grip.title', 'Your grip')),
          h('span.grip__value', `${grip.value}`),
        ),
        h('div.stat__track',
          h('div.stat__fill', { style: { width: `${grip.value}%`, background: statColour(grip.value) } }),
        ),
        h('div.grip__band', grip.band),
        grip.pressures.length
          ? h('div.grip__pressures',
              h('span.grip__pressuresLabel',
                t('grip.running', '{n} running without you:', { n: grip.pressures.length })),
              grip.pressures.slice(0, 4).map((p) => h('span.grip__chip', p.label)),
            )
          : h('div.grip__pressures',
              h('span.grip__pressuresLabel', t('grip.clear', 'Nothing is running without you this quarter.'))),
      ),
      // The books, before a single order is issued: what the quarter is set up
      // to do on its own. Growth used to appear only after it had happened.
      (() => {
        const outlook = growthOutlook(this.game, this.game.playerId);
        const books = ledgerFor(this.game, this.game.playerId);
        const land = formatArea(this.game, this.game.playerId);
        return h('div.ledger',
          ledgerCell(t('ledger.growth', 'Growth'),
            `${outlook.growth >= 0 ? '+' : '−'}${Math.abs(outlook.growth).toFixed(2)}%`,
            t('ledger.perQuarter', 'per quarter'),
            outlook.growth >= 0 ? 'var(--good)' : 'var(--bad)'),
          ledgerCell(t('ledger.net', 'Net balance'), `${money(books.net)}`,
            t('ledger.revenueUpkeep', '{rev} in, {up} out', { rev: money(books.revenue), up: money(books.upkeep) }),
            books.net >= 0 ? null : 'var(--warn)'),
          ledgerCell(t('stat.land', 'Land held'), land.text,
            land.change === null
              ? t('ledger.unchanged', 'unchanged')
              : t('context.since', '{delta}% since the start', { delta: deltaLabel(land.change) }),
            land.change === null ? null : land.change > 0 ? 'var(--good)' : 'var(--bad)'),
        );
      })(),
      this.#leadershipBlock(),
      h('div.stats', STAT_ROWS.map((row) => this.#statBar(row))),
      state.modifiers.length
        ? h('div.modifiers',
            h('h3.subhead', t('panel.inEffect', 'In effect')),
            state.modifiers.slice(0, 8).map((m) =>
              h('div.modifier', { class: (m.growth || 0) < 0 ? 'modifier is-bad' : 'modifier' },
                h('span', tModifier(m.label)),
                h('span.modifier__turns', `${m.turnsLeft}q`),
              ),
            ),
          )
        : null,
      wars.length
        ? h('div.wars',
            h('h3.subhead', t('panel.atWar', 'At war')),
            wars.map((war) => {
              const attacking = war.attackers.includes(this.game.playerId);
              const yourScore = attacking ? war.warScore : -war.warScore;
              return h('div.war',
                h('div.war__name', war.name),
                h('div.war__bar',
                  h('div.war__fill', {
                    style: {
                      width: `${Math.min(100, Math.max(0, (yourScore + 100) / 2))}%`,
                      background: yourScore > 10 ? 'var(--good)' : yourScore < -10 ? 'var(--bad)' : 'var(--warn)',
                    },
                  }),
                ),
                h('div.war__meta',
                  `${yourScore > 0 ? t('war.advancing', 'You are advancing') : yourScore < 0 ? t('war.losing', 'You are losing ground') : t('war.deadlocked', 'Deadlocked')} · `,
                  t('war.casualties', '{n}k casualties', { n: (war.casualties / 1000).toFixed(0) }),
                ),
              );
            }),
          )
        : null,
    );
  }

  /**
   * The standing of the office, and what it buys.
   *
   * This is the panel that answers "why can I only issue three orders" — every
   * component is named, and the one holding you back is the one to work on.
   */
  #leadershipBlock() {
    const game = this.game;
    const lead = leadership(game);
    const next = nextSlotAt(game);

    return h('div.leadership', {
      title: t('leadership.hint',
        'How much authority the office commands, and therefore how many orders it can carry in a quarter.'),
    },
      h('div.leadership__head',
        h('span.leadership__label', t('leadership.title', 'Leadership')),
        h('span.leadership__slots',
          t('leadership.slots', '{n} orders', { n: lead.slots })),
      ),
      h('div.stat__track',
        h('div.stat__fill', { style: { width: `${lead.value}%`, background: statColour(lead.value) } }),
      ),
      h('div.leadership__band',
        h('span', t(`leadership.${lead.band.id}`, lead.band.label)),
        h('span.leadership__value', String(lead.value)),
      ),
      h('div.leadership__parts',
        lead.components.map((c) =>
          h('span.leadership__part', { class: c.value >= 55 ? 'leadership__part is-up' : 'leadership__part is-down' },
            `${t(`leadership.${c.id}`, c.label)} ${c.value}`)),
      ),
      next
        ? h('div.leadership__next',
            t('leadership.next', '{n} more buys a fifth order — the weakest leg is {lever}.', {
              n: next.gap,
              lever: t(`leadership.${next.lever.id}`, next.lever.label),
            }))
        : h('div.leadership__next', t('leadership.maxed', 'As many orders as this office can carry.')),
    );
  }

  #statBar(row) {
    const game = this.game;
    const ctx = statContext(game, game.playerId, row.key);
    const v = ctx.value;
    // A bare 0-100 figure means nothing on its own, so every row carries which
    // way it moved, where that puts you in the world, and a word for it.
    const good = row.invert ? -1 : 1;
    return h('div.stat', { title: row.hintOf() },
      h('div.stat__head',
        h('span.stat__label', row.labelOf()),
        h('span',
          h('span.stat__value', String(v)),
          ctx.delta
            ? h('span.stat__delta', {
                class: `stat__delta stat__delta--${ctx.delta * good > 0 ? 'up' : 'down'}`,
              }, ` ${ctx.delta > 0 ? '▲' : '▼'}${Math.abs(Math.round(ctx.delta))}`)
            : null,
        ),
      ),
      h('div.stat__track',
        h('div.stat__fill', { style: { width: `${v}%`, background: statColour(v, row.invert) } }),
      ),
      h('div.stat__context',
        h('span', ctx.band),
        h('span.stat__rank', rankLabel(game, ctx.rank)),
      ),
    );
  }

  /** The map's hover/selection detail, in the sidebar rather than over the map. */
  #inspector() {
    return h('section.panel.inspector',
      h('div.panel__titlebar',
        h('h2.panel__title', t('panel.inspector', 'Country inspector')),
        this.pinnedId
          ? h('button.btn.btn--tiny.btn--ghost', { onclick: () => { this.pinnedId = null; this.map?.setSelected(null); this.#refreshInspector(); } }, t('inspector.unpin', 'Unpin'))
          : null,
      ),
      h('div', { dataset: { inspector: 'true' } }, this.#inspectorBody()),
    );
  }

  #inspectorBody() {
    const id = this.inspectId;
    if (!id || !this.game.nations[id]) {
      return h('p.inspector__hint',
        t('inspector.hint', 'Hover or tap any country on the map to see it here. Tap again to open its full file.'));
    }

    const game = this.game;
    const def = defOf(game, id);
    const state = game.nations[id];
    const isPlayer = id === game.playerId;
    const relation = getRelation(game, game.playerId, id);
    const rank = rankedNations(game).findIndex((r) => r.state.id === id) + 1;
    const atWar = game.wars.some((w) => w.active && (w.attackers.includes(id) || w.defenders.includes(id)));

    // A country that has been conquered still has a card, but it is a record of
    // what happened to it — not a live sheet of statistics that would read as
    // though it were still a going concern.
    if (!isSovereign(game, id)) return this.#conqueredBody(id, def);

    return h('div',
      this.pinnedId === id ? h('div.inspector__pin', t('inspector.pinned', 'Pinned')) : null,
      h('div.inspector__head',
        h('span.inspector__flag', def.flag),
        h('div',
          h('div.inspector__name', tNation(def)),
          h('div.inspector__sub',
            tNation(def, 'capital') ? `◉ ${tNation(def, 'capital')} · ` : '',
            `${tNation(def, 'government')} · #${rank} / ${Object.keys(game.nations).length}`),
        ),
      ),
      isPlayer
        ? h('div.inspector__relation', { style: { color: 'var(--accent)' } }, t('inspector.yourCountry', 'Your country'))
        : h('div.inspector__relation', { style: { color: relationColour(relation) } },
            `${relationLabel(relation)} · relation ${Math.round(relation)}`),
      atWar ? h('div.inspector__relation', { style: { color: 'var(--st-critical)' } }, t('inspector.atWar', '⚔ At war')) : null,
      h('p.inspector__brief', tNation(def, 'brief')),
      // Foreign figures are what your services believe, not what is true. A
      // country you have never looked at reads as a band; one you have an
      // agent inside reads as a number.
      isPlayer ? null : this.#intelLine(id),
      h('div.inspector__grid',
        row(t('stat.gdp', 'GDP'), fog(game, id, 'gdp', isPlayer), `${formatPerCapita(state)}/head`),
        row(t('stat.people', 'People'), `${Math.round(state.population)}M`,
          rankLabel(game, rankOf(game, id, (s) => s.population))),
        row(t('stat.military', 'Military'), fog(game, id, 'military', isPlayer), bandOf('military', state.military)),
        row(t('stat.readiness', 'Readiness'), fog(game, id, 'readiness', isPlayer), bandOf('readiness', state.readiness)),
        row(t('stat.tech', 'Technology'), fog(game, id, 'tech', isPlayer), bandOf('tech', state.tech)),
        row(t('stat.stability', 'Stability'), fog(game, id, 'stability', isPlayer), bandOf('stability', state.stability)),
        row(t('stat.unrest', 'Unrest'), fog(game, id, 'unrest', isPlayer), bandOf('unrest', state.unrest)),
        row(t('stat.influence', 'Influence'), fog(game, id, 'influence', isPlayer), bandOf('influence', state.influence)),
        row(t('stat.nukes', 'Warheads'), state.nukes || '—',
          state.nukes ? rankLabel(game, rankOf(game, id, (s) => s.nukes)) : ''),
        landRow(game, id),
        row(t('stat.alignment', 'Alignment'),
          alignmentOf(id, game) ? t(alignmentOf(id, game).labelKey, alignmentOf(id, game).name) : t('legend.nonAligned', 'Non-aligned')),
      ),
      h('div.inspector__actions',
        h('button.btn.btn--sm.btn--ghost', { onclick: () => { this.map?.centreOn(id, Math.max(3, this.map.zoom)); } }, t('inspector.zoomTo', 'Zoom to')),
        isPlayer ? null : h('button.btn.btn--sm', { onclick: () => this.#openDetail(id) }, t('inspector.openFile', 'Open full file')),
      ),
    );

    // Your own figures are your own; everyone else's are an estimate whose
    // width is set by how much intelligence you have on them.
    function fog(g, nationId, key, mine) {
      if (mine) return String(Math.round(g.nations[nationId][key]));
      const reading = estimate(g, nationId, key, { max: key === 'gdp' ? 40 : 100 });
      return reading.text;
    }

    function row(label, value, context) {
      return h('div.inspector__row',
        h('span', label),
        h('span',
          String(value),
          context ? h('span.inspector__context', context) : null,
        ),
      );
    }

    // Land is the one figure that can move without any statistic changing, so
    // it always shows how far it has drifted from where the run started.
    function landRow(g, nationId) {
      const land = formatArea(g, nationId);
      return row(
        t('stat.land', 'Land held'),
        land.text,
        land.change === null
          ? ''
          : t('context.sinceStart', '{delta}% since {date}', {
              delta: deltaLabel(land.change),
              date: `Q1 ${g.year - Math.floor(g.turn / 4)}`,
            }),
      );
    }
  }

  /** How well your services can actually see this country. */
  #intelLine(id) {
    const game = this.game;
    const confidence = intelOn(game, id);
    const band = confidenceBand(confidence);
    const balance = estimatedBalance(game, id);
    return h('div.intel', { class: `intel is-${band.id}`,
      title: t('intel.hint',
        'Foreign figures are what your services believe. Espionage, cyber operations and a source inside their command all narrow the estimate; it goes stale on its own.') },
      h('div.intel__head',
        h('span.intel__label', t('intel.coverage', 'Intelligence')),
        h('span.intel__band', t(`intel.${band.id}`, band.label)),
      ),
      h('div.stat__track',
        h('div.stat__fill', { style: { width: `${confidence * 100}%`, background: statColour(confidence * 100) } })),
      h('div.intel__balance',
        t('intel.balance', 'Their forces against yours: {n}', { n: balance.text })),
    );
  }

  /** What is left of a country somebody else now administers. */
  #conqueredBody(id, def) {
    const game = this.game;
    const state = game.nations[id];
    const holder = defOf(game, state.annexedBy);
    const byYou = state.annexedBy === game.playerId;
    return h('div',
      h('div.inspector__head',
        h('span.inspector__flag', def.flag),
        h('div',
          h('div.inspector__name', tNation(def)),
          h('div.inspector__sub', t('inspector.formerState', 'Former state')),
        ),
      ),
      h('div.inspector__relation', { style: { color: 'var(--muted)' } },
        holder
          ? (byYou
              ? t('inspector.occupiedByYou', 'Occupied and administered by you.')
              : t('inspector.occupiedBy', 'Occupied and administered by {nation}.', { nation: tNation(holder) }))
          : t('inspector.dissolved', 'Dissolved. Nobody claims it.')),
      h('p.inspector__brief',
        t('inspector.conqueredNote',
          'It no longer takes decisions, appears in the rankings, or answers anything you do. If somebody takes the ground back it will be here again.')),
      h('div.inspector__actions',
        h('button.btn.btn--sm.btn--ghost', {
          onclick: () => { this.map?.centreOn(id, Math.max(3, this.map.zoom)); },
        }, t('inspector.zoomTo', 'Zoom to')),
        this.pinnedId === id
          ? h('button.btn.btn--sm.btn--ghost', {
              onclick: () => { this.pinnedId = null; this.map?.setSelected(null); this.render(); },
            }, t('inspector.unpin', 'Unpin'))
          : null,
      ),
    );
  }

  /**
   * The four creditors of your political capital.
   *
   * This is the panel that gives every order a second axis: the number at the
   * top of the screen is no longer refilled by arithmetic, it is lent to you by
   * four groups who read everything you do and disagree about all of it.
   */
  #factionsPanel() {
    const game = this.game;
    const mods = gameModifiers(game);
    const standings = snapshotStandings(game);
    const capital = politicalCapitalFrom(game, mods);

    return h('section.panel',
      h('div.panel__titlebar',
        h('h2.panel__title', t('panel.factions', 'Who is lending you the votes')),
        h('span.badge', t('factions.pcNext', '{n} next quarter', { n: capital.total })),
      ),
      h('div.factions',
        standings.map((entry) => {
          const spec = FACTIONS.find((f) => f.id === entry.id);
          const source = capital.sources.find((s) => s.id === entry.id);
          return h('div.faction', { class: `faction is-${entry.band.id}`, title: t(`faction.${entry.id}Blurb`, spec.blurb) },
            h('div.faction__head',
              h('span.faction__name', t(`faction.${entry.id}`, spec.name)),
              h('span.faction__band', t(`standing.${entry.band.id}`, entry.band.label)),
            ),
            h('div.stat__track',
              h('div.stat__fill', {
                style: { width: `${entry.mood}%`, background: statColour(entry.mood) },
              }),
            ),
            h('div.faction__foot',
              h('span.faction__contrib', {
                class: `faction__contrib ${(source?.value ?? 0) >= 0 ? 'is-up' : 'is-down'}`,
                title: t('factions.contribHint', 'What they contribute to next quarter’s political capital'),
              }, `${(source?.value ?? 0) >= 0 ? '+' : '−'}${Math.abs(source?.value ?? 0).toFixed(1)} PC`),
              entry.demand
                ? h('span.faction__demand', {
                    title: t('factions.demandHint', 'Meet it and they warm to you. Miss the deadline and they do not.'),
                  },
                    `“${t(`demand.${entry.id}.${entry.demand.id}`, entry.demand.text)}” `,
                    h('span.faction__due', t('factions.due', '{n}q', { n: Math.max(0, entry.demand.dueTurn - game.turn) })),
                  )
                : h('span.faction__quiet', t('factions.quiet', 'asking for nothing')),
            ),
          );
        }),
      ),
      h('p.panel__note',
        t('factions.note',
          'Every order you issue is read by all four. The one that wanted it and the one that did not are named on each card.')),
    );
  }

  /** The rivalry, if one has been promoted. */
  #nemesisPanel() {
    const report = nemesisReport(this.game);
    if (!report) return null;
    const game = this.game;

    return h('section.panel.panel--nemesis',
      h('div.panel__titlebar',
        h('h2.panel__title', t('panel.nemesis', 'The standing problem')),
        h('span.badge.badge--warn', t(`codename.${report.codename}`, report.codename)),
      ),
      h('button.nemesis__head', {
        onclick: () => this.#openDetail(report.id),
        onpointerenter: () => this.#onMapHover(report.id),
        onpointerleave: () => this.#onMapHover(null),
      },
        h('span.nemesis__flag', report.def.flag),
        h('div',
          h('div.nemesis__name', tNation(report.def)),
          h('div.nemesis__since',
            t('nemesis.since', 'On the desk since Q{n} · {q} quarters', {
              n: report.since + 1, q: report.quarters,
            })),
        ),
      ),
      h('p.panel__note',
        report.origin === 'yours'
          ? t('nemesis.originYours', 'It began with something you did.')
          : report.origin === 'theirs'
            ? t('nemesis.originTheirs', 'It began with something they did.')
            : t('nemesis.originMutual', 'Neither side would agree on who started it.')),
      h('div.nemesis__rows',
        h('div.nemesis__row',
          h('span', t('nemesis.balance', 'Their forces against yours')),
          h('span', estimatedBalance(game, report.id).text)),
        h('div.nemesis__row',
          h('span', t('nemesis.relation', 'Relation')),
          h('span', { style: { color: relationColour(report.relation) } }, `${Math.round(report.relation)}`)),
        h('div.nemesis__row',
          h('span', t('nemesis.ladder', 'Escalation')),
          h('span', report.ladder.toFixed(1))),
        report.atWar
          ? h('div.nemesis__row', h('span', { style: { color: 'var(--st-critical)' } }, t('inspector.atWar', '⚔ At war')), h('span', ''))
          : null,
      ),
      report.theirs.length
        ? h('div',
            h('h3.subhead', t('nemesis.theyDid', 'What they have done')),
            h('ul.grievances', report.theirs.slice(0, 4).map((entry) =>
              h('li.grievance',
                h('span.grievance__what', tActionName(entry.label, entry.actionId)),
                h('span.grievance__when', `Q${entry.turn}`)))),
          )
        : null,
      report.yours.length
        ? h('div',
            h('h3.subhead', t('nemesis.youDid', 'What you have done')),
            h('ul.grievances', report.yours.slice(0, 4).map((entry) =>
              h('li.grievance',
                h('span.grievance__what', tActionName(entry.label, entry.actionId)),
                h('span.grievance__when', `Q${entry.turn}`)))),
          )
        : null,
      h('p.panel__note.panel__note--warn',
        t('nemesis.warning', 'They spend their quarters on you rather than on whoever else is available.')),
    );
  }

  /**
   * The rules of the office, what they forbid, what you have committed the
   * budget to, and — in the last year — whether the country will have you again.
   */
  #government() {
    const game = this.game;
    const clauses = describeConstitution(game);
    const running = commitmentsOf(game).filter((c) => !c.closed);
    const inFinalYear = game.turn >= game.totalTurns - 4;
    const score = inFinalYear ? scoreRun(game) : null;
    const election = inFinalYear ? electionState(game, score) : null;

    return h('section.panel',
      h('div.panel__titlebar',
        h('h2.panel__title', t('panel.government', 'The office')),
        h('span.badge', t('government.term', 'Term {n}', { n: game.term || 1 })),
      ),

      h('div.clauses',
        clauses.map((clause) =>
          h('div.clause', { title: t(`clause.${clause.id}.${String(clause.value)}`, clause.note) },
            h('span.clause__name', t(`clause.${clause.id}`, clause.name)),
            h('span.clause__value', { class: clause.amendedThisTerm ? 'clause__value is-amended' : 'clause__value' },
              t(`clauseValue.${clause.id}.${String(clause.value)}`, clause.label)),
          ),
        ),
      ),
      h('div.row.row--tight',
        h('button.btn.btn--sm.btn--ghost', {
          disabled: amendmentsLeft(game) <= 0,
          title: amendmentsLeft(game) > 0
            ? t('government.amendHint', 'One amendment per term. This one is still available.')
            : t('constitution.onePerTerm', 'One amendment per term. You have used yours.'),
          onclick: () => { this.amendOpen = true; this.render(); },
        }, amendmentsLeft(game) > 0
          ? t('government.amend', 'Amend the constitution')
          : t('government.amended', 'Amendment used')),
      ),

      running.length
        ? h('div',
            h('h3.subhead', t('government.committed', 'Committed, whatever you do next')),
            running.map((c) =>
              h('div.commitment',
                h('div',
                  h('div.commitment__label', t(`modifier.${c.label}`, c.label)),
                  h('div.commitment__meta',
                    t('government.perQuarter', '{amount}/q · {n} quarters left · break fee {fee}', {
                      amount: money(c.quarterly), n: c.turnsLeft, fee: money(breakCost(c)),
                    })),
                ),
                h('button.btn.btn--tiny.btn--danger', {
                  title: t('government.cancelHint', 'Cancelling costs the break fee immediately.'),
                  onclick: () => {
                    if (!window.confirm(t('government.cancelConfirm',
                      'Cancel {label} for {fee}? This cannot be undone.',
                      { label: c.label, fee: money(breakCost(c)) }))) return;
                    cancel(this.game, c.id);
                    this.app.toast(t('government.cancelled', '{label} cancelled.', { label: c.label }));
                    this.render();
                  },
                }, t('common.cancel', 'Cancel')),
              ),
            ),
            h('div.commitment__total',
              t('government.totalCommitted', '{amount} a quarter is already spoken for.',
                { amount: money(committedSpend(game)) })),
          )
        : null,

      election
        ? h('div',
            h('h3.subhead', t('government.election', 'The vote at the end of the term')),
            election.allowed
              ? h('div',
                  h('div.election__head',
                    h('span.election__share', `${election.share.toFixed(0)}%`),
                    h('span.election__band', { class: `election__band is-${electionBand(election.share).id}` },
                      t(`electionBand.${electionBand(election.share).id}`, electionBand(election.share).label)),
                  ),
                  h('div.stat__track',
                    h('div.stat__fill', {
                      style: { width: `${election.share}%`, background: statColour(election.share) },
                    })),
                  h('div.election__reasons',
                    election.reasons.slice(0, 4).map((r) =>
                      h('span.election__reason', { class: r.value >= 0 ? 'election__reason is-up' : 'election__reason is-down' },
                        `${t(`electionReason.${r.label}`, r.label)} ${r.value >= 0 ? '+' : '−'}${Math.abs(r.value).toFixed(0)}`)),
                  ),
                )
              : h('p.panel__note.panel__note--warn',
                  t('government.barred',
                    'You may not stand again: the constitution allows {n} term(s). Amending that clause is the only way round it, and everyone will know why you did.',
                    { n: election.limit })),
          )
        : null,
    );
  }

  /** The escalation ladders the player is currently standing on. */
  #escalation() {
    const ladders = playerLadders(this.game).filter((l) => l.value >= 1);
    if (!ladders.length) return null;

    return h('section.panel',
      h('h2.panel__title', t('panel.escalation', 'Escalation')),
      h('p.panel__note',
        t('panel.escalationNote', 'The higher a ladder climbs, the harder and the longer the answer comes back.')),
      ladders.slice(0, 5).map((l) => {
        const def = NATIONS_BY_ID[l.id];
        return h('div.ladder', { onpointerenter: () => this.#onMapHover(l.id), onpointerleave: () => this.#onMapHover(null) },
          h('div.ladder__head',
            h('span', `${def.flag} ${tNation(def)}`),
            h('span.ladder__band', { class: `ladder__band is-${l.band}` }, t(`ladder.${l.band}`, l.label)),
          ),
          h('div.stat__track',
            h('div.stat__fill', {
              style: {
                width: `${(l.value / LADDER_MAX) * 100}%`,
                background: l.value >= 8.5 ? 'var(--st-critical)'
                  : l.value >= 6 ? 'var(--st-serious)'
                  : l.value >= 3.5 ? 'var(--st-warning)' : 'var(--muted-2)',
              },
            }),
          ),
        );
      }),
    );
  }

  /** Objective wording, with the country name substituted in. */
  #objectiveDetail(obj) {
    const nation = tNation(NATIONS_BY_ID[this.game.playerId]);
    return t(`objective.${obj.id}.detail`, obj.detail, { nation });
  }

  #objectives() {
    const game = this.game;
    const score = scoreRun(game);
    const untilReview = Math.max(0, nextReviewTurn(game) - game.turn);
    const ambition = ambitionProgress(game);

    return h('section.panel',
      h('div.panel__titlebar',
        h('h2.panel__title', t('panel.mandate', 'Your mandate')),
        h('span.badge', { title: t('mandate.reviewHint',
          'The brief is rewritten every {n} quarters from whatever has happened since.', { n: REVIEW_EVERY }) },
          untilReview === 0
            ? t('mandate.reviewNow', 'under review')
            : t('mandate.reviewIn', 'reviewed in {n}q', { n: untilReview })),
      ),
      h('ul.objectives',
        score.objectives.map((obj) =>
          h('li.objective', { class: obj.met ? 'objective is-met' : 'objective' },
            h('span.objective__mark', obj.met ? '✓' : '○'),
            h('div',
              h('div.objective__title',
                t(`objective.${obj.id}.title`, obj.title),
                obj.origin === 'history'
                  ? h('span.objective__origin', {
                      title: t('mandate.historyHint', 'Written into the brief by something that happened.'),
                    }, t('mandate.fromHistory', 'from events'))
                  : null,
              ),
              h('div.objective__detail', this.#objectiveDetail(obj)),
            ),
          ),
        ),
      ),
      ambition
        ? h('div.ambition', { class: ambition.met ? 'ambition is-met' : 'ambition' },
            h('div.ambition__label', t('mandate.ambition', 'What you have not told anyone')),
            h('div.ambition__title', t(`ambition.${ambition.id}`, ambition.title)),
            h('div.ambition__detail', t(`ambition.${ambition.id}Detail`, ambition.detail)),
            h('div.ambition__state', ambition.hint),
          )
        : null,
    );
  }

  #relations() {
    const game = this.game;
    const others = sovereignIds(game)
      .filter((id) => id !== game.playerId)
      .map((id) => ({ id, rel: getRelation(game, game.playerId, id), power: livePower(game, id) }));

    const friends = [...others].sort((a, b) => b.rel - a.rel).slice(0, 4);
    const foes = [...others].sort((a, b) => a.rel - b.rel).slice(0, 4);

    const row = (entry) => {
      const def = NATIONS_BY_ID[entry.id];
      return h('button.relation', {
        onclick: () => this.#pin(entry.id),
        onpointerenter: () => this.#onMapHover(entry.id),
        onpointerleave: () => this.#onMapHover(null),
      },
        h('span.relation__flag', def.flag),
        h('span.relation__name', tNation(def)),
        h('span.relation__value', { style: { color: relationColour(entry.rel) } }, relationLabel(entry.rel)),
      );
    };

    return h('section.panel',
      h('h2.panel__title', t('panel.relations', 'Relations')),
      h('h3.subhead', t('panel.closest', 'Closest')),
      friends.map(row),
      h('h3.subhead', t('panel.mostHostile', 'Most hostile')),
      foes.map(row),
    );
  }

  // ── Centre column ────────────────────────────────────────────────────────

  #mapPanel() {
    const mode = VIEW_MODES.find((m) => m.id === this.mapMode) || VIEW_MODES[0];

    return h('section.panel.panel--map',
      h('div.panel__titlebar',
        h('h2.panel__title', t('map.title', 'Situation map')),
        this.pendingTargetAction
          ? h('span.targeting',
              t('map.pickTarget', 'Pick a target for {action}', { action: tAction(this.pendingTargetAction) }),
              h('button.btn.btn--tiny', { onclick: () => { this.pendingTargetAction = null; this.render(); } }, t('common.cancel', 'Cancel')),
            )
          : null,
      ),

      h('div.map-toolbar',
        h('div.chips',
          VIEW_MODES.map((m) =>
            h('button.chip', {
              class: this.mapMode === m.id ? 'chip is-active' : 'chip',
              title: t(`view.${m.id}Hint`, m.hint),
              onclick: () => { this.mapMode = m.id; this.map?.setMode(m.id); this.render(); },
            }, t(`view.${m.id}`, m.name)),
          ),
        ),
        h('div.map-toolbar__spacer'),
        h('button.chip', {
          class: this.showTerritory ? 'chip is-active' : 'chip',
          title: t('map.territoryHint', 'Fill in the land each country holds.'),
          onclick: () => {
            this.showTerritory = !this.showTerritory;
            this.map?.setShowTerritory(this.showTerritory);
            this.render();
          },
        }, t('map.territory', 'Territory')),
        h('select.input', {
          style: { width: 'auto' },
          'aria-label': 'Jump to region',
          onchange: (e) => { this.map?.focusOn(e.target.value); e.target.selectedIndex = 0; },
        },
          h('option', { value: '' }, t('map.jumpTo', 'Jump to…')),
          MAP_FOCUSES.map((f) => h('option', { value: f.id }, t(`focus.${f.id}`, f.name))),
        ),
        h('div.map-zoom',
          h('button.map-zoom__btn', { onclick: () => this.map?.zoomBy(1 / 1.4), 'aria-label': t('map.zoomOut', 'Zoom out'), title: `${t('map.zoomOut', 'Zoom out')} (−)` }, '−'),
          h('span.map-zoom__level', { dataset: { zoomLevel: 'true' } }, '1.0×'),
          h('button.map-zoom__btn', { onclick: () => this.map?.zoomBy(1.4), 'aria-label': t('map.zoomIn', 'Zoom in'), title: `${t('map.zoomIn', 'Zoom in')} (+)` }, '+'),
          h('button.map-zoom__btn', { onclick: () => this.map?.resetCamera(), 'aria-label': t('map.reset', 'Reset view'), title: `${t('map.reset', 'Reset view')} (0)` }, '⤢'),
        ),
      ),

      h('div.map-holder', { dataset: { map: 'true' } }),

      h('div.map-legend',
        legendFor(this.mapMode).map((item) =>
          h('span.map-legend__item',
            h('span.map-legend__swatch', {
              class: item.shape === 'ring' ? 'map-legend__swatch map-legend__swatch--ring' : 'map-legend__swatch',
              style: { background: item.fill, opacity: item.opacity ?? 1 },
            }),
            item.label,
          ),
        ),
        h('span.map-legend__hint', t('map.explore', 'Scroll or drag to explore · '), t(`view.${mode.id}Hint`, mode.hint)),
      ),
    );
  }

  /**
   * The world panel: who is aligned with whom, which borders have moved, and
   * where everybody stands. All of this was already happening in the engine —
   * countries changing sides, provinces changing hands, new states declaring
   * themselves — and none of it was anywhere a player could look.
   */
  #worldPanel() {
    const tabs = [
      ['alignments', t('world.alignments', 'Alignments')],
      ['treaties', t('world.treaties', 'Treaties')],
      ['ties', t('world.ties', 'Ties')],
      ['borders', t('world.borders', 'Borders')],
      ['rankings', t('world.rankings', 'Rankings')],
    ];
    return h('section.panel.panel--world',
      h('div.tabs',
        tabs.map(([id, label]) =>
          h('button.tab', {
            class: this.worldTab === id ? 'tab is-active' : 'tab',
            onclick: () => { this.worldTab = id; this.render(); },
          }, label),
        ),
      ),
      this.worldTab === 'treaties' ? this.#treatiesTab()
        : this.worldTab === 'ties' ? this.#tiesTab()
          : this.worldTab === 'borders' ? this.#bordersTab()
            : this.worldTab === 'rankings' ? this.#rankingsTab()
              : this.#alignmentsTab(),
    );
  }

  #alignmentsTab() {
    const game = this.game;
    const standings = blocStandings(game);
    const mine = standings.filter((s) => s.playerIn);
    const changes = recentOfType(game, 'alignment', 12, 6);
    const wary = feared(game);

    return h('div.worldbody',
      h('h3.subhead', t('world.yourTreaties', 'What you are party to')),
      mine.length
        ? h('div.chips.chips--tight',
            mine.map((entry) => h('span.blocchip', { class: entry.bloc.invented ? 'blocchip is-invented' : 'blocchip' },
              t(`bloc.${entry.bloc.id}`, entry.bloc.name),
              h('span.blocchip__n', `${entry.members.length}`),
            )),
          )
        : h('p.panel__note', t('world.noTreaties', 'You are in no bloc. Nobody is obliged to you, and you are obliged to nobody.')),
      h('p.panel__note',
        t('world.joinHint', 'Accede to a bloc, or walk out of one, from the Diplomacy tab — the offers on the table change as your relations do.')),

      h('h3.subhead', t('world.blocsOnBoard', 'Blocs on the board')),
      h('div.blocs',
        standings.map((entry) =>
          h('div.bloc', { class: entry.playerIn ? 'bloc is-mine' : 'bloc' },
            h('div.bloc__head',
              h('span.bloc__name',
                t(`bloc.${entry.bloc.id}`, entry.bloc.name),
                entry.bloc.invented
                  ? h('span.bloc__tag', t('world.invented', 'new'))
                  : null,
              ),
              h('span.bloc__meta',
                t('world.membersAndPower', '{n} states · {pct}% of world power', {
                  n: entry.members.length,
                  pct: Math.round(entry.powerShare * 100),
                }),
              ),
            ),
            h('div.stat__track',
              h('div.stat__fill', {
                style: {
                  width: `${Math.min(100, entry.powerShare * 100)}%`,
                  background: entry.playerIn ? 'var(--accent)' : 'var(--muted-2)',
                },
              }),
            ),
            h('div.bloc__members',
              entry.members.slice(0, 12).map((id) =>
                h('button.bloc__member', {
                  title: tNation(defOf(game, id)),
                  onclick: () => this.#pin(id),
                  onpointerenter: () => this.#onMapHover(id),
                  onpointerleave: () => this.#onMapHover(null),
                }, defOf(game, id)?.flag || '·'),
              ),
              entry.members.length > 12 ? h('span.bloc__more', `+${entry.members.length - 12}`) : null,
            ),
          ),
        ),
      ),

      changes.length
        ? h('div',
            h('h3.subhead', t('world.sidesChanged', 'Who has changed sides')),
            changes.map((e) => h('div.logline.logline--major',
              h('span.logline__date', e.date), h('span.logline__text', e.text))),
          )
        : null,

      wary.length
        ? h('div',
            h('h3.subhead', t('world.wary', 'Who the world is watching')),
            wary.map((entry) =>
              h('div.threatrow', { onpointerenter: () => this.#onMapHover(entry.id), onpointerleave: () => this.#onMapHover(null) },
                h('span', `${entry.def.flag} ${tNation(entry.def)}`),
                h('span.threatrow__bar',
                  h('span.threatrow__fill', { style: { width: `${Math.round(entry.threat * 100)}%` } })),
                h('span.threatrow__value', `${Math.round(entry.threat * 100)}`),
              ),
            ),
            h('p.panel__note',
              t('world.wearyNote', 'The higher this reads, the more readily others will join a war against them — including against you.')),
          )
        : null,
    );
  }

  /**
   * Your paper: what you are bound to, who is bound to you, and how long each
   * of them has left to run. There was a treaties array in the save from the
   * first commit and nothing ever showed it.
   */
  #treatiesTab() {
    const game = this.game;
    const report = treatyReport(game);
    const wars = game.wars.filter((w) => w.active);

    return h('div.worldbody',
      h('h3.subhead', t('treaty.yours', 'What you are bound to')),
      report.live.length
        ? report.live.map((treaty) =>
            h('div.treaty', { class: treaty.expiringSoon ? 'treaty is-expiring' : 'treaty' },
              h('div.treaty__head',
                h('span.treaty__icon', treaty.kindSpec.icon),
                h('div',
                  h('div.treaty__kind', t(`treatyKind.${treaty.kind}`, treaty.kindSpec.name)),
                  h('button.treaty__with', {
                    onclick: () => this.#openDetail(treaty.other),
                    onpointerenter: () => this.#onMapHover(treaty.other),
                    onpointerleave: () => this.#onMapHover(null),
                  }, `${treaty.otherDef?.flag || ''} ${tNation(treaty.otherDef)}`),
                ),
                h('div.treaty__clock',
                  h('span.treaty__left', t('treaty.left', '{n}q left', { n: treaty.quartersLeft })),
                  h('span.treaty__cred', {
                    title: t('treaty.credHint',
                      'How much either side believes it. Honouring a call raises it; refusing one destroys it.'),
                  }, t('treaty.credibility', 'believed {n}%', { n: Math.round(treaty.credibility) })),
                ),
              ),
              h('p.treaty__blurb', t(`treatyKind.${treaty.kind}Blurb`, treaty.kindSpec.blurb)),
              treaty.expiringSoon
                ? h('div.treaty__warn', t('treaty.expiringSoon',
                    'Expires in {n} quarters. Renew it from the Alliances tab or watch it lapse.',
                    { n: treaty.quartersLeft }))
                : null,
            ),
          )
        : h('p.panel__note',
            t('treaty.none',
              'You have signed nothing. Propose a treaty from the Alliances tab — a non-aggression pact costs almost nothing and a defence pact changes who fights your wars.')),

      h('h3.subhead', t('treaty.whoComes', 'Who would come if you were attacked')),
      report.allies.length
        ? h('div.allies',
            report.allies.map((ally) =>
              h('button.ally', {
                onclick: () => this.#openDetail(ally.id),
                onpointerenter: () => this.#onMapHover(ally.id),
                onpointerleave: () => this.#onMapHover(null),
              },
                h('span.ally__flag', defOf(game, ally.id)?.flag || '·'),
                h('span.ally__name', tNation(defOf(game, ally.id))),
                h('span.ally__via', ally.via === 'bloc'
                  ? t(`bloc.${ally.kind}`, BLOCS[ally.kind]?.name || ally.kind)
                  : t(`treatyKind.${ally.kind}`, TREATY_KINDS[ally.kind]?.name || ally.kind)),
              ),
            ),
          )
        : h('p.panel__note',
            t('treaty.alone', 'Nobody is obliged to come. That is a position, but it should be a chosen one.')),

      wars.length
        ? h('div',
            h('h3.subhead', t('treaty.warsNow', 'Wars being fought')),
            wars.slice(0, 6).map((war) => this.#warCard(war)),
          )
        : null,

      report.lapsed.length
        ? h('div',
            h('h3.subhead', t('treaty.lapsedHead', 'Paper that is no longer paper')),
            report.lapsed.map((treaty) =>
              h('div.relation',
                h('span.relation__flag', treaty.otherDef?.flag || '·'),
                h('span.relation__name', tNation(treaty.otherDef)),
                h('span.relation__value', { style: { color: 'var(--muted)' } },
                  treaty.ending === 'abrogated'
                    ? t('treaty.wasTorn', 'torn up')
                    : t('treaty.wasLapsed', 'lapsed')),
              ),
            ),
          )
        : null,
    );
  }

  /**
   * One war, with the thing that was missing from it: what each belligerent is
   * actually worth *there*.
   *
   * A coalition of twelve reads as overwhelming until you notice that nine of
   * them are on the wrong ocean. The weight column is the number the engine
   * fights the war with, so a player can see why a war they are winning on
   * paper is not moving.
   */
  #warCard(war) {
    const game = this.game;
    const theatre = theatreOf(game, war);
    const roster = [...war.attackers, ...war.defenders].filter((id) => isSovereign(game, id));
    const weights = roster
      .map((id) => ({
        id,
        side: war.attackers.includes(id) ? 'attackers' : 'defenders',
        weight: theatreWeight(game, id, war),
      }))
      .sort((a, b) => b.weight - a.weight);
    const distant = weights.filter((w) => w.weight < 0.5);

    return h('div.warcard', { class: war.worldWar ? 'warcard is-general' : 'warcard' },
      h('div.warcard__head',
        h('span.warcard__name', war.name),
        war.worldWar
          ? h('span.warcard__general', t('war.generalTag', 'general war'))
          : h('span.warcard__theatre', theatre ? tNation(defOf(game, theatre)) : war.theatre || ''),
      ),
      h('div.warcard__sides',
        h('span.warcard__side',
          war.attackers.map((id) => defOf(game, id)?.flag || '·').join(' ')),
        h('span.warcard__vs', t('war.vs', 'vs')),
        h('span.warcard__side',
          war.defenders.map((id) => defOf(game, id)?.flag || '·').join(' ')),
      ),
      h('div.warcard__meta',
        t('treaty.warMeta', '{n} states · {c}k casualties · since {year}', {
          n: war.attackers.length + war.defenders.length,
          c: Math.round((war.casualties || 0) / 1000),
          year: war.startYear ?? game.year,
        })),
      h('div.weights',
        weights.slice(0, 8).map((entry) =>
          h('div.weight', { class: `weight is-${entry.side}`,
            title: t('war.weightHint',
              '{nation} can bring about {pct}% of its strength to this theatre.',
              { nation: tNation(defOf(game, entry.id)), pct: Math.round(entry.weight * 100) }),
          },
            h('span.weight__flag', defOf(game, entry.id)?.flag || '·'),
            h('span.weight__track',
              h('span.weight__fill', { style: { width: `${Math.round(entry.weight * 100)}%` } })),
            h('span.weight__value', `${Math.round(entry.weight * 100)}%`),
          ),
        ),
      ),
      distant.length
        ? h('p.warcard__note', t('war.distantNote',
            '{n} belligerent(s) cannot put much on the ground here. They are in the war; they are not in the theatre.',
            { n: distant.length }))
        : null,
      war.unreachable
        ? h('p.warcard__note', t('war.unreachableNote',
            'Neither side can reach the other. This one is being fought at sea, in the air and over the accounts.'))
        : null,
    );
  }

  /**
   * The second map: what this country needs from other countries.
   *
   * Everything in the Ties tab of the catalogue is priced against these
   * numbers, so a player who is about to embargo somebody should be able to see
   * which way the leverage runs first. That is the whole point of showing it.
   */
  #tiesTab() {
    const game = this.game;
    const report = tiesReport(game, game.playerId, 8);
    const exchanges = exchangeReport(game);
    const general = worldWarReport(game);
    const brink = brinkOfGeneralWar(game);
    const pct = (v) => `${(v * 100).toFixed(1)}%`;

    const tieRow = (entry, direction) => {
      const grip = leverage(game, game.playerId, entry.id);
      return h('div.tie', { class: entry.open < 1 ? 'tie is-shut' : 'tie' },
        h('button.tie__who', {
          onclick: () => this.#openDetail(entry.id),
          onpointerenter: () => this.#onMapHover(entry.id),
          onpointerleave: () => this.#onMapHover(null),
        },
          h('span.tie__flag', entry.def?.flag || '·'),
          h('span.tie__name', tNation(entry.def)),
        ),
        h('span.tie__track',
          h('span.tie__fill', {
            style: {
              width: `${Math.min(100, entry.share * 320)}%`,
              background: direction === 'out' ? 'var(--accent)' : 'var(--warn, var(--muted-2))',
            },
          })),
        h('span.tie__value', pct(entry.share)),
        entry.open < 1
          ? h('span.tie__shut', t('ties.shut', 'shut'))
          : h('span.tie__grip', {
              title: t('ties.gripHint',
                'Which of you would be hurt more by closing this. Yours means they need you more than you need them.'),
            }, t(`ties.verdict.${grip.verdict}`, GRIP_WORDS[grip.verdict])),
      );
    };

    return h('div.worldbody',
      general && !general.over
        ? h('div.generalwar',
            h('h3.generalwar__name', general.war.name),
            h('p.generalwar__note', t('ties.generalNote',
              '{pct}% of the world’s power is committed. Sea lanes, insurance and payment systems are closed to people who are not even in it.',
              { pct: Math.round(general.state.share * 100) })),
          )
        : brink
          ? h('div.generalwar.generalwar--brink',
              h('h3.generalwar__name', t('ties.brinkHead', 'The {war} is becoming everybody’s', { war: brink.war.name })),
              h('p.generalwar__note', t('ties.brinkNote',
                '{pct}% of the world’s power is already in it, across {n} states. Past about {need}% it stops being a regional war.',
                { pct: Math.round(brink.state.share * 100), n: brink.state.belligerents, need: 36 })),
            )
          : null,

      h('h3.subhead', t('ties.dependsHead', 'What you need from other people')),
      h('p.panel__note', t('ties.opennessNote',
        '{pct}% of your economy runs through somebody else, and {open}% of that is currently open.',
        { pct: Math.round(report.openness * 100), open: Math.round(report.health * 100) })),
      report.dependsOn.length
        ? h('div.ties', report.dependsOn.map((entry) =>
            h('div',
              tieRow(entry, 'out'),
              entry.composition.length
                ? h('div.tie__what', entry.composition.map((what) =>
                    h('span.tie__tag', t(`ties.what.${what.replace(/\s+/g, '')}`, what))))
                : null,
            )))
        : h('p.panel__note', t('ties.noneOut', 'Nothing you cannot do without.')),

      h('h3.subhead', t('ties.dependedHead', 'Who needs you')),
      h('p.panel__note', t('ties.dependedNote',
        'This is your leverage, and it is the only kind that survives being used.')),
      report.dependedOnBy.length
        ? h('div.ties', report.dependedOnBy.map((entry) => tieRow(entry, 'in')))
        : h('p.panel__note', t('ties.noneIn', 'Nobody depends on you for anything. That is a kind of freedom and a kind of irrelevance.')),

      report.severed.length
        ? h('div',
            h('h3.subhead', t('ties.shutHead', 'What is currently shut')),
            report.severed.map((entry) =>
              h('div.severed',
                h('span.severed__flag', entry.def?.flag || '·'),
                h('span.severed__name', tNation(entry.def)),
                h('span.severed__label', entry.label
                  ? tLabel(entry.label)
                  : t('ties.cutGeneric', 'closed')),
                h('span.severed__cost', t('ties.costsYou', 'costs you {pct}', { pct: pct(entry.cost) })),
                h('span.severed__left', entry.turnsLeft === null
                  ? t('ties.indefinite', 'indefinite')
                  : t('ties.quartersLeft', '{n}q left', { n: entry.turnsLeft })),
              ),
            ),
            h('p.panel__note', t('ties.dragNote',
              'Together these are worth {n} points of growth a quarter to you.', { n: report.drag.toFixed(2) })),
          )
        : null,

      exchanges.outbound.length || exchanges.settled.length
        ? h('div',
            h('h3.subhead', t('ties.exchangesHead', 'Propositions outstanding')),
            exchanges.outbound.map((entry) =>
              h('div.exchange',
                h('span.exchange__flag', entry.toDef?.flag || '·'),
                h('div.exchange__body',
                  h('div.exchange__name', tAction({ id: `demand-${entry.demandId}`, name: entry.demand?.name || entry.demandId })),
                  h('div.exchange__ask', t(`demand.${entry.demandId}.ask`, entry.demand?.ask || '')),
                ),
                h('span.exchange__odds', t('ties.odds', '{pct}% likely', { pct: Math.round(entry.odds * 100) })),
                h('span.exchange__due', entry.dueIn <= 0
                  ? t('ties.dueNow', 'answer due')
                  : t('ties.dueIn', '{n}q', { n: entry.dueIn })),
              ),
            ),
            exchanges.settled.slice(0, 4).map((entry) =>
              h('div.exchange.exchange--settled',
                h('span.exchange__flag', (entry.from === game.playerId ? entry.toDef : entry.fromDef)?.flag || '·'),
                h('div.exchange__body',
                  h('div.exchange__name', entry.demand?.name || entry.demandId),
                ),
                h('span.exchange__status', { class: `exchange__status is-${entry.status}` },
                  t(`ties.status.${entry.status}`, entry.status)),
              ),
            ),
          )
        : h('p.panel__note', t('ties.noExchanges',
            'Nothing is on anybody’s desk. Demands and offers are in the Diplomacy tab; they are answered the quarter after you send them.')),
    );
  }

  #bordersTab() {
    const game = this.game;
    const born = newStates(game);
    const gone = formerStates(game);
    const { gained, lost } = landMovers(game);
    const events = recentOfType(game, ['territory', 'conquest', 'secession'], 8, 8);

    const areaText = (km2) => (Math.abs(km2) >= 1000
      ? `${(km2 / 1000).toFixed(2)}M km²`
      : `${Math.round(km2).toLocaleString()}k km²`);

    return h('div.worldbody',
      h('h3.subhead', t('world.newStates', 'States that did not exist in {year}', { year: game.year - Math.floor(game.turn / 4) })),
      born.length
        ? born.map((entry) =>
            h('div.newstate',
              h('div.newstate__head',
                h('span.newstate__name', `${entry.def.flag} ${tNation(entry.def)}`),
                h('span.newstate__from',
                  entry.parent
                    ? t('world.brokeFrom', 'from {parent}', { parent: tNation(entry.parent) })
                    : ''),
              ),
              h('div.newstate__stats',
                h('span', `$${entry.gdp.toFixed(2)}T`),
                h('span', `${Math.round(entry.population)}M`),
                h('span', areaText(entry.area)),
                h('span', t('world.mil', 'mil {n}', { n: Math.round(entry.military) })),
                h('span', t('world.stab', 'stab {n}', { n: Math.round(entry.stability) })),
              ),
              h('div.newstate__foot',
                entry.sovereign
                  ? t('world.recognisedBy', 'Independent since Q{q}', { q: entry.bornTurn + 1 })
                  : t('world.alreadyGone', 'Already absorbed'),
              ),
            ),
          )
        : h('p.panel__note', t('world.noNewStates', 'No country has broken apart yet. Coups, uprisings and lost wars are what does it.')),

      h('h3.subhead', t('world.formerStates', 'States that no longer govern themselves')),
      gone.length
        ? gone.map((entry) =>
            h('div.relation', { onclick: () => this.#pin(entry.id) },
              h('span.relation__flag', entry.def?.flag || '·'),
              h('span.relation__name', tNation(entry.def)),
              h('span.relation__value', { style: { color: entry.byPlayer ? 'var(--accent)' : 'var(--muted)' } },
                entry.holder
                  ? t('world.heldBy', 'held by {nation}', { nation: tNation(entry.holder) })
                  : t('world.dissolved', 'dissolved')),
            ),
          )
        : h('p.panel__note', t('world.allSovereign', 'Every country on the board still runs its own affairs.')),

      h('h3.subhead', t('world.groundMoved', 'Ground gained and lost since the first quarter')),
      gained.length || lost.length
        ? h('div.movers',
            gained.map((entry) => h('div.mover',
              h('span', `${entry.def.flag} ${tNation(entry.def)}`),
              h('span.mover__value.is-up', `+${areaText(entry.delta)}`))),
            lost.map((entry) => h('div.mover',
              h('span', `${entry.def.flag} ${tNation(entry.def)}`),
              h('span.mover__value.is-down', `−${areaText(Math.abs(entry.delta))}`))),
          )
        : h('p.panel__note', t('world.bordersStill', 'The map is where it started. Borders move when wars are won, provinces are sold, or a region walks out.')),

      events.length
        ? h('div',
            h('h3.subhead', t('world.howItMoved', 'How it moved')),
            events.map((e) => h('div.logline', { class: `logline logline--${e.severity}` },
              h('span.logline__date', e.date), h('span.logline__text', e.text))),
          )
        : null,
    );
  }

  /** League tables. One metric at a time, with your own place always visible. */
  #rankingsTab() {
    const game = this.game;
    const metric = RANK_METRICS.find((m) => m.id === this.rankMetric) || RANK_METRICS[0];

    const rows = sovereignIds(game)
      .map((id) => ({ id, def: defOf(game, id), value: metric.pick(game, game.nations[id], id) }))
      .filter((r) => Number.isFinite(r.value))
      .sort((a, b) => b.value - a.value);

    const myIndex = rows.findIndex((r) => r.id === game.playerId);
    const top = rows.slice(0, 10);
    // If you are not in the top ten, show your own neighbourhood underneath it
    // rather than making a player count down a list of fifty-six.
    const around = myIndex >= 10 ? rows.slice(Math.max(10, myIndex - 1), myIndex + 2) : [];
    const total = rows.reduce((sum, r) => sum + Math.max(0, r.value), 0);

    const line = (row, index) =>
      h('div.league', { class: row.id === game.playerId ? 'league is-you' : 'league',
        onclick: () => this.#pin(row.id),
        onpointerenter: () => this.#onMapHover(row.id),
        onpointerleave: () => this.#onMapHover(null),
      },
        h('span.league__rank', `${index + 1}`),
        h('span.league__flag', row.def?.flag || '·'),
        h('span.league__name', tNation(row.def)),
        h('span.league__bar',
          h('span.league__fill', {
            style: {
              width: `${Math.max(1, (Math.max(0, row.value) / Math.max(1e-9, rows[0].value)) * 100)}%`,
              background: row.id === game.playerId ? 'var(--accent)' : 'var(--muted-2)',
            },
          })),
        h('span.league__value', metric.format(row.value)),
      );

    return h('div.worldbody',
      h('div.chips.chips--tight',
        RANK_METRICS.map((m) =>
          h('button.chip', {
            class: this.rankMetric === m.id ? 'chip is-active' : 'chip',
            onclick: () => { this.rankMetric = m.id; this.render(); },
          }, t(`metric.${m.id}`, m.name)),
        ),
      ),
      h('p.panel__note', t(`metric.${metric.id}Hint`, metric.hint)),
      top.map(line),
      around.length
        ? h('div', h('div.league__gap', '⋯'), around.map((row) => line(row, rows.indexOf(row))))
        : null,
      h('div.leaguefoot',
        t('world.yourShare', 'You hold {pct}% of the world total, ranked {n} of {all}.', {
          pct: (Math.max(0, rows[myIndex]?.value ?? 0) / Math.max(1e-9, total) * 100).toFixed(1),
          n: myIndex + 1,
          all: rows.length,
        }),
      ),
    );
  }

  #feed() {
    const briefing = this.app.briefing;
    const tabs = [
      ['briefing', t('feed.briefing', 'Briefing')],
      ['dispatches', t('feed.dispatches', 'Dispatches')],
      ['advisor', t('feed.advisers', 'Advisers')],
      ['log', t('feed.archive', 'Archive')],
    ];

    return h('section.panel.panel--feed',
      h('div.tabs',
        tabs.map(([id, label]) =>
          h('button.tab', {
            class: this.feedTab === id ? 'tab is-active' : 'tab',
            onclick: () => { this.feedTab = id; this.render(); },
          }, label),
        ),
        briefing?.source === 'offline' && briefing?.degraded
          ? h('span.badge.badge--warn', { title: briefing.degraded }, t('feed.aiUnavailable', 'AI unavailable — local briefing'))
          : briefing?.source === 'offline'
            ? h('span.badge', t('feed.localBriefing', 'Local briefing'))
            : h('span.badge.badge--ai', t('feed.aiBriefing', 'AI briefing')),
      ),
      h('div.feed', this.#feedBody(briefing)),
    );
  }

  #feedBody(briefing) {
    if (this.busy) {
      return h('div.feed__loading',
        h('div.spinner'),
        h('p', this.app.narrator.usingAi ? t('feed.loadingAi', 'The wires are coming in…') : t('feed.loadingLocal', 'Resolving the quarter…')),
      );
    }
    if (!briefing) return h('p.empty', 'No briefing yet.');

    if (this.feedTab === 'dispatches') {
      return briefing.dispatches?.length
        ? briefing.dispatches.map((d) =>
            h('article.dispatch', h('div.dispatch__source', d.source), h('p.dispatch__text', d.text)))
        : h('p.empty', t('feed.quietWires', 'The wires are quiet this quarter.'));
    }

    if (this.feedTab === 'advisor') return this.#advisorPanel();

    if (this.feedTab === 'log') {
      const entries = [...this.game.log].reverse().slice(0, 60);
      return entries.length
        ? entries.map((e) =>
            h('div.logline', { class: `logline logline--${e.severity}` },
              h('span.logline__date', e.date),
              h('span.logline__text', e.text)))
        : h('p.empty', t('feed.nothingArchived', 'Nothing archived yet.'));
    }

    return h('article.briefing',
      h('h3.briefing__headline', briefing.headline),
      (briefing.briefing || []).map((p) => h('p', p)),
      briefing.advisorNote
        ? h('blockquote.advice', h('span.advice__label', t('feed.chiefOfStaff', 'Chief of staff')), briefing.advisorNote)
        : null,
      briefing.outlook ? h('p.outlook', briefing.outlook) : null,
    );
  }

  #advisorPanel() {
    return h('div.advisor',
      this.app.narrator.usingAi
        ? null
        : h('p.panel__note.panel__note--warn', t('feed.adviserNeedsAi', 'Advisers need a language model. Add a free provider key in Settings to consult them.')),
      h('div.advisor__log',
        this.advisorLog.length
          ? this.advisorLog.map((entry) =>
              h('div.advisor__entry', h('p.advisor__q', entry.question), h('p.advisor__a', entry.answer)))
          : h('p.empty', t('feed.askAdviser', 'Ask your national security adviser anything about the current position.')),
        this.advisorBusy ? h('div.spinner') : null,
      ),
      h('form.advisor__form', {
        onsubmit: (e) => {
          e.preventDefault();
          const input = e.target.querySelector('input');
          const question = input.value.trim();
          if (question) { input.value = ''; this.#askAdvisor(question); }
        },
      },
        h('input.input', {
          type: 'text',
          placeholder: t('feed.adviserPlaceholder', 'Should we sanction them, or wait?'),
          disabled: !this.app.narrator.usingAi || this.advisorBusy,
        }),
        h('button.btn.btn--sm', { type: 'submit', disabled: !this.app.narrator.usingAi || this.advisorBusy }, t('feed.ask', 'Ask')),
      ),
    );
  }

  async #askAdvisor(question) {
    this.advisorBusy = true;
    this.render();
    const reply = await this.app.narrator.askAdvisor(this.game, question);
    this.advisorLog.push({ question, answer: reply.text });
    this.advisorBusy = false;
    this.render();
  }

  // ── Right column: the order planner ──────────────────────────────────────

  #planner() {
    const game = this.game;
    const state = game.nations[game.playerId];
    const spend = this.orders.reduce((sum, o) => sum + o.cost, 0);
    const pcSpend = this.orders.reduce((sum, o) => sum + o.pc, 0);
    // Never render a negative allowance; overspending is already blocked.
    const funds = Math.max(0, availableFunds(state));
    const finances = describeFinances(state);
    const recommended = this.#recommendedIds();

    const atWar = activeWarsFor(game, game.playerId).length > 0;
    const categories = CATEGORIES.filter((c) => !c.wartimeOnly || atWar);
    if (!categories.some((c) => c.id === this.category)) this.category = 'economy';

    // Read the world once, not once per card: every tab is now filtered and
    // ranked by what is actually happening, so this is the hot path.
    const tags = situationTags(game);
    const catalogue = sortCatalogue(
      actionsInCategory(this.category, game, tags),
      this.sortBy,
      { game, state, mods: gameModifiers(game), recommended },
    );

    return h('section.panel.panel--planner',
      h('div.panel__titlebar',
        h('h2.panel__title', t('orders.title', 'Orders for the quarter')),
        h('span.badge', {
          title: t('orders.slotsHint',
            'How many orders this government can carry in a quarter. It is your leadership, not a constant.'),
        }, t('orders.count', '{n} of {slots}', { n: this.orders.length, slots: orderSlots(game) })),
      ),

      h('div.budget',
        h('div.budget__row',
          h('span', t('orders.committed', 'Money committed')),
          h('span', { class: spend > funds ? 'is-over' : '' }, `${money(spend)} of ${money(funds)}`),
        ),
        h('div.budget__track',
          h('div.budget__fill', {
            style: {
              width: `${Math.min(100, (spend / Math.max(1, funds)) * 100)}%`,
              background: spend > funds ? 'var(--bad)' : spend > state.treasury ? 'var(--warn)' : 'var(--accent)',
            },
          }),
        ),
        h('div.budget__row',
          h('span', debtOf(state) ? `${t('hud.debt', 'Debt')} · ${finances.label}` : t('orders.creditLine', 'Credit line')),
          h('span', debtOf(state)
            ? t('orders.owed', '{amount} owed', { amount: money(debtOf(state)) })
            : t('orders.available', '{amount} available', { amount: money(creditLimit(state)) })),
        ),
        h('div.budget__row',
          h('span', t('hud.politicalCapital', 'Political capital')),
          h('span', { class: pcSpend > game.politicalCapital ? 'is-over' : '' }, `${pcSpend} of ${game.politicalCapital}`),
        ),
      ),

      this.orders.length
        ? h('div.queue',
            this.orders.map((order, i) =>
              h('div.queue__item',
                h('div',
                  h('div.queue__name', order.name),
                  h('div.queue__meta',
                    order.targetId ? `${NATIONS_BY_ID[order.targetId].flag} ${NATIONS_BY_ID[order.targetId].name} · ` : '',
                    `${money(order.cost)} · ${order.pc} PC · ${Math.round(order.chance * 100)}% likely`,
                  ),
                ),
                h('button.btn.btn--tiny.btn--danger', {
                  onclick: () => { this.orders.splice(i, 1); this.render(); },
                  'aria-label': `Remove ${order.name}`,
                }, '✕'),
              ),
            ),
          )
        : h('p.empty.empty--tight', t('orders.empty', 'Nothing queued yet. Pick up to four orders below, then end the quarter.')),

      h('div.chips.chips--tight',
        categories.map((c) =>
          h('button.chip', {
            class: `chip${this.category === c.id ? ' is-active' : ''}${c.wartimeOnly ? ' chip--war' : ''}`,
            title: t(`categoryHint.${c.id}`, CATEGORY_HINTS[c.id] || ''),
            onclick: () => { this.category = c.id; this.render(); },
          },
            h('span.chip__icon', c.icon),
            h('span.chip__label', tLabel('categories', c.id, c.name)),
          ),
        ),
      ),

      h('div.sortbar',
        h('span.sortbar__label', t('orders.sortBy', 'Sort')),
        SORTS.map((sort) =>
          h('button.sortbar__btn', {
            class: this.sortBy === sort.id ? 'sortbar__btn is-active' : 'sortbar__btn',
            title: t(`sort.${sort.id}Hint`, sort.hint),
            onclick: () => { this.sortBy = sort.id; this.render(); },
          }, t(`sort.${sort.id}`, sort.name)),
        ),
      ),

      h('p.panel__note',
        t('orders.shelfNote',
          '{n} of {all} {category} instruments, chosen for what the quarter is doing. The tab changes as the world does.',
          {
            n: catalogue.length,
            all: actionsInCategory(this.category).length,
            category: tLabel('categories', this.category, this.category).toLowerCase(),
          })),

      h('div.catalogue', catalogue.map((a) => this.#actionCard(a, recommended.has(a.id), tags))),

      this.#customOrder(),
    );
  }

  /** A short list of orders that fit the country's current problems. */
  #recommendedIds() {
    const game = this.game;
    const state = game.nations[game.playerId];
    const ids = new Set();
    const atWar = activeWarsFor(game, game.playerId).length > 0;

    if (state.treasury < state.gdp * 20) ids.add('austerity');
    if (state.unrest > 55) ids.add('social-spending');
    if (state.unrest > 70) ids.add('crackdown');
    if (state.stability < 48) ids.add('reform');
    if (atWar) { ids.add('rearm'); ids.add('seek-peace'); }
    if (!atWar && state.readiness < 60) ids.add('exercises');
    if (state.tech < 60) ids.add('rnd-push');
    if (state.influence < 45) ids.add('multilateral');
    if (game.worldTension > 70) ids.add('mediate');
    if (ids.size === 0) { ids.add('infrastructure'); ids.add('trade-deal'); }
    return ids;
  }

  #actionCard(action, recommended, tags = null) {
    const game = this.game;
    const reason = reasonFor(action, tags || situationTags(game));
    const state = game.nations[game.playerId];
    const mods = gameModifiers(game);
    const cost = actionCost(action, state);
    const queued = this.orders.length >= orderSlots(game);
    const chance = successChance(game, action, game.playerId, null, mods);

    const remainingMoney = availableFunds(state) - this.orders.reduce((s, o) => s + o.cost, 0);
    const remainingPc = game.politicalCapital - this.orders.reduce((s, o) => s + o.pc, 0);
    // An untargeted order already on the desk cannot go on it twice. A targeted
    // one can, against somebody else, so the card itself stays live.
    const already = this.orders.some((o) => o.actionId === action.id && !o.targetId && !action.target);
    const blocked = queued || already || cost > remainingMoney || action.pc > remainingPc;
    const why = already
      ? t('orders.alreadyQueued', 'Already queued. Doing the same thing twice in one quarter is not doing it twice as hard.')
      : queued
      ? t('orders.limitReached', '{n} orders is what this government can carry in a quarter', { n: orderSlots(game) })
      : cost > remainingMoney
        ? t('orders.needMore', 'Needs {amount} more', { amount: money(cost - remainingMoney) })
        : action.pc > remainingPc
          ? t('orders.needMorePc', 'Needs {n} more political capital', { n: action.pc - remainingPc })
          : tAction(action, 'blurb');

    return h('button.action', {
      class: `action${blocked ? ' is-blocked' : ''}${recommended && !blocked ? ' is-recommended' : ''}`,
      disabled: blocked,
      title: why,
      onclick: () => this.#queueAction(action),
    },
      h('div.action__head',
        h('span.action__name', tAction(action)),
        h('span.action__chance', { title: t('orders.successHint', 'Chance this order succeeds') }, `${Math.round(chance * 100)}%`),
      ),
      h('p.action__blurb', tAction(action, 'blurb')),
      h('div.action__effects', describeEffects(action).map((e) =>
        h('span.effect-pill', { class: `effect-pill effect-pill--${e.dir}` }, e.text))),
      h('div.action__meta',
        h('span', money(cost)),
        h('span', `${action.pc} PC`),
        // Why this one is on the shelf at all — the situation it answers.
        reason ? h('span.action__tag.action__tag--why', t(`why.${reason}`, WHY_LABELS[reason] || reason)) : null,
        // Who at home wants this, and who will hold it against you. The second
        // axis every order gained when political capital got creditors.
        ...(() => {
          const { champion, objector, reading } = poles(action);
          const chip = (id, dir) => {
            const spec = FACTIONS.find((f) => f.id === id);
            return h('span.action__tag', { class: `action__tag action__tag--${dir}`,
              title: t('orders.factionHint', '{faction}: {n}', {
                faction: t(`faction.${id}`, spec.name), n: reading[id] > 0 ? `+${reading[id]}` : reading[id],
              }) },
              `${dir === 'likes' ? '▲' : '▼'} ${t(`factionShort.${id}`, SHORT_FACTION[id])}`);
          };
          return [
            champion ? chip(champion, 'likes') : null,
            objector ? chip(objector, 'dislikes') : null,
          ].filter(Boolean);
        })(),
        cost > state.treasury && !blocked ? h('span.action__tag.action__tag--risk', t('orders.onCredit', 'on credit')) : null,
        recommended ? h('span.action__tag.action__tag--rec', t('orders.suggested', 'suggested')) : null,
        action.target === 'nation' ? h('span.action__tag', t('orders.needTarget', 'pick a target')) : null,
        action.risk === 'high' ? h('span.action__tag.action__tag--risk', t('orders.canBackfire', 'can backfire')) : null,
        action.declaresWar ? h('span.action__tag.action__tag--war', t('orders.startsWar', 'starts a war')) : null,
      ),
    );
  }

  #queueAction(action, targetId = null) {
    if (action.target === 'nation' && !targetId) {
      this.pendingTargetAction = action;
      this.app.toast(t('orders.pickTargetToast', 'Now click a country on the map to target {action}.', { action: tAction(action) }));
      this.render();
      return;
    }
    const mods = gameModifiers(this.game);
    const room = canQueue(this.game, this.orders, action, targetId);
    if (!room.ok) {
      this.app.toast(room.reason);
      return;
    }
    const availability = actionAvailability(this.game, action, targetId);
    if (!availability.ok) {
      this.app.toast(availability.reason);
      return;
    }
    if (action.confirm) {
      const label = targetId ? ` — ${tNation(NATIONS_BY_ID[targetId])}` : '';
      if (!window.confirm(t('toast.irreversible', '{action}{target}. This is not reversible. Proceed?',
        { action: tAction(action), target: label }))) return;
    }

    this.orders.push({
      actionId: action.id,
      custom: action.id === 'custom-order' ? action : null,
      targetId,
      name: action.name,
      cost: actionCost(action, this.game.nations[this.game.playerId]),
      pc: action.pc,
      chance: successChance(this.game, action, this.game.playerId, targetId, mods),
    });
    this.pendingTargetAction = null;
    this.render();
  }

  #onMapHover(id) {
    this.hoverId = id;
    if (!this.pinnedId) this.#refreshInspector();
  }

  #onMapSelect(id) {
    if (id === null) {
      // Clicked open ocean.
      this.pinnedId = null;
      this.map?.setSelected(null);
      this.#refreshInspector();
      return;
    }
    if (this.pendingTargetAction) {
      if (id === this.game.playerId) {
        this.app.toast(t('toast.selfTarget', 'You cannot target your own country.'));
        return;
      }
      this.#queueAction(this.pendingTargetAction, id);
      return;
    }
    // First click pins into the inspector; clicking the pinned one opens the file.
    if (this.pinnedId === id) this.#openDetail(id);
    else this.#pin(id);
  }

  #pin(id) {
    this.pinnedId = id;
    this.hoverId = id;
    this.map?.setSelected(id);
    this.#refreshInspector();
  }

  #customOrder() {
    return h('div.custom',
      h('h3.subhead', t('orders.freeform', 'Freeform order')),
      h('p.panel__note',
        this.app.narrator.usingAi
          ? t('orders.freeformAi', 'Write anything at all. Your advisers will price it and give you the odds.')
          : t('orders.freeformLocal', 'Your advisers read the text and price it against the closest instrument. Add a free key in Settings for real adjudication.'),
      ),
      h('textarea.input.custom__box', {
        rows: 3,
        placeholder: t('orders.freeformPlaceholder', 'e.g. Quietly buy up the lithium offtake contracts before Beijing does.'),
        value: this.customDraft,
        oninput: (e) => { this.customDraft = e.target.value; },
      }),
      h('div.row',
        h('button.btn.btn--sm', { disabled: this.customBusy, onclick: () => this.#priceCustom() },
          this.customBusy ? t('orders.pricing', 'Consulting…') : t('orders.priceIt', 'Price this order')),
        this.customPriced
          ? h('button.btn.btn--ghost.btn--sm', { onclick: () => { this.customPriced = null; this.render(); } }, t('orders.discard', 'Discard'))
          : null,
      ),
      this.customPriced ? this.#customCard() : null,
    );
  }

  async #priceCustom() {
    const text = this.customDraft.trim();
    if (!text) {
      this.app.toast(t('toast.writeOrderFirst', 'Write the order first.'));
      return;
    }
    this.customBusy = true;
    this.render();
    this.customPriced = await this.app.narrator.adjudicate(this.game, text);
    this.customBusy = false;
    this.render();
  }

  #customCard() {
    const result = this.customPriced;
    if (!result.feasible) {
      return h('div.custom__result.custom__result--refused',
        h('strong', t('orders.refused', 'Your advisers refuse.')),
        h('p', result.refusal || 'This cannot be done.'),
      );
    }
    const action = result.action;
    const state = this.game.nations[this.game.playerId];
    const cost = actionCost(action, state);
    const mods = gameModifiers(this.game);
    const chance = successChance(this.game, action, this.game.playerId, result.targetId, mods);

    return h('div.custom__result',
      h('div.custom__head', h('strong', action.name), h('span.action__chance', `${Math.round(chance * 100)}%`)),
      h('p.action__blurb', result.rationale || action.blurb),
      h('div.action__effects', describeEffects(action).map((e) =>
        h('span.effect-pill', { class: `effect-pill effect-pill--${e.dir}` }, e.text))),
      h('div.action__meta',
        h('span', money(cost)),
        h('span', `${action.pc} PC`),
        // Why this one is on the shelf at all — the situation it answers.
        reason ? h('span.action__tag.action__tag--why', t(`why.${reason}`, WHY_LABELS[reason] || reason)) : null,
        h('span.action__tag', action.category),
        result.targetId ? h('span.action__tag', NATIONS_BY_ID[result.targetId].name) : null,
        action.risk === 'high' ? h('span.action__tag.action__tag--risk', 'can backfire') : null,
      ),
      h('button.btn.btn--sm.btn--primary', {
        onclick: () => {
          this.#queueAction(action, result.targetId);
          this.customPriced = null;
          this.customDraft = '';
          this.render();
        },
      }, t('orders.addToOrders', 'Add to orders')),
    );
  }

  // ── Bottom bar ───────────────────────────────────────────────────────────

  #actionBar() {
    const game = this.game;
    const state = game.nations[game.playerId];
    const spend = this.orders.reduce((sum, o) => sum + o.cost, 0);
    const pcSpend = this.orders.reduce((sum, o) => sum + o.pc, 0);
    const overBudget = spend > availableFunds(state) || pcSpend > game.politicalCapital;
    const undecided = Boolean(game.pendingDecision && !this.decisionChoice);

    // Leaving money and capital on the table is the commonest beginner mistake,
    // so say so rather than letting the quarter quietly go to waste.
    const spareMoney = availableFunds(state) - spend;
    const sparePc = game.politicalCapital - pcSpend;
    const cheapest = Math.min(...ACTIONS.map((a) => actionCost(a, state)));
    const idle = this.orders.length < 4 && sparePc >= 1 && spareMoney > cheapest;

    return h('footer.actionbar',
      h('div.actionbar__summary',
        this.orders.length
          ? t('orders.summary', '{n} orders · {money} · {pc} political capital',
              { n: this.orders.length, money: money(spend), pc: pcSpend })
          : t('orders.none', 'No orders queued — the quarter will pass without direction.'),
        idle
          ? h('span.actionbar__warn',
              t('orders.unspent', ' {money} and {pc} political capital still unspent.',
                { money: money(spareMoney), pc: sparePc }))
          : null,
        undecided ? h('span.actionbar__warn', t('orders.crisisWaiting', ' A crisis is awaiting your decision.')) : null,
      ),
      h('div.row',
        // The closing session, once it is sitting. It is the last decision of
        // the term and the one that pays out forty quarters of diplomacy, so it
        // gets a button of its own rather than a line in a panel.
        congressOf(game) && !congressOf(game).resolved
          ? h('button.btn.btn--ghost.btn--congress', {
              onclick: () => { this.congressOpen = true; this.render(); },
            }, t('congress.openFloor', 'The congress is sitting →'))
          : null,
        this.orders.length
          ? h('button.btn.btn--ghost', { onclick: () => { this.orders = []; this.render(); } }, t('orders.clear', 'Clear orders'))
          : null,
        h('button.btn.btn--primary.btn--lg', {
          disabled: this.busy || overBudget || game.status !== 'active',
          title: overBudget ? 'You have committed more than you have' : 'End the quarter (Enter)',
          onclick: () => this.app.endTurn(this.orders, this.decisionChoice),
        }, this.busy ? t('orders.resolving', 'Resolving…') : t('orders.endQuarter', 'End quarter →')),
      ),
    );
  }

  // ── Modals ───────────────────────────────────────────────────────────────

  /**
   * The thing on the desk that will not wait.
   *
   * Every option now shows what it costs, what it risks, and which of the four
   * domestic creditors will be pleased and which will not — because a decision
   * that is only hard because of who is watching should look hard for that
   * reason rather than for none.
   */
  #decisionModal() {
    const game = this.game;
    const decision = game.pendingDecision;
    const state = game.nations[game.playerId];
    const target = decision.targetId ? defOf(game, decision.targetId) : null;

    const priceOf = (choice) => {
      if (!choice.cost) return null;
      return Math.round(((choice.cost.pctGdp || 0) / 100) * state.gdp * 1000 + (choice.cost.flat || 0));
    };

    return h('div.modal', { role: 'dialog', 'aria-modal': 'true' },
      h('div.modal__panel.modal__panel--decision',
        h('div.modal__eyebrow',
          t('decision.required', 'Decision required'),
          target ? ` · ${target.flag} ${tNation(target)}` : '',
        ),
        h('h2.modal__title', decision.title),
        h('p.modal__body', decision.prompt),
        h('div.choices',
          decision.choices.map((choice) => {
            const price = priceOf(choice);
            const affordable = price === null || price <= availableFunds(state);
            return h('button.choice', {
              class: affordable ? 'choice' : 'choice is-dear',
              onclick: () => {
                if (choice.confirm && !window.confirm(t('decision.confirm',
                  '{label}. There is no version of this you can take back. Proceed?', { label: choice.label }))) return;
                this.decisionChoice = choice.id;
                this.render();
              },
            },
              h('div.choice__label', choice.label),
              h('div.choice__detail', choice.detail),
              h('div.choice__meta',
                typeof choice.chance === 'number'
                  ? h('span.choice__odds', { class: choice.chance >= 0.6 ? 'choice__odds is-good' : choice.chance >= 0.45 ? 'choice__odds' : 'choice__odds is-bad' },
                      t('decision.odds', '{pct}% to land as intended', { pct: Math.round(choice.chance * 100) }))
                  : h('span.choice__odds', t('decision.certain', 'Certain outcome')),
                price !== null
                  ? h('span.choice__cost', { class: affordable ? 'choice__cost' : 'choice__cost is-bad' }, money(price))
                  : null,
                choice.confirm
                  ? h('span.choice__flag', t('decision.irreversible', 'irreversible'))
                  : null,
                ...Object.entries(choice.factions || {})
                  .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                  .slice(0, 2)
                  .map(([id, delta]) =>
                    h('span.choice__faction', { class: delta >= 0 ? 'choice__faction is-up' : 'choice__faction is-down' },
                      `${delta >= 0 ? '▲' : '▼'} ${t(`factionShort.${id}`, SHORT_FACTION[id] || id)}`)),
              ),
            );
          }),
        ),
        h('button.btn.btn--ghost.btn--block', {
          title: t('decision.deferHint',
            'Approval and unrest both move against you, and the initiative passes to whoever else wanted it.'),
          onclick: () => { this.decisionChoice = '__defer__'; this.render(); },
        }, t('decision.defer', 'Take no decision (accept the consequences)')),
      ),
    );
  }

  #helpModal() {
    return h('div.modal', {
      role: 'dialog', 'aria-modal': 'true',
      onclick: (e) => { if (e.target.classList.contains('modal')) { this.helpOpen = false; this.render(); } },
    },
      h('div.modal__panel.modal__panel--help',
        h('button.modal__close', { onclick: () => { this.helpOpen = false; this.render(); }, 'aria-label': 'Close' }, '✕'),
        h('h2.modal__title', t('help.title', 'How to play')),

        h('div.help__section',
          h('h3', t('help.loop', 'The loop')),
          h('p', { html: t('help.loopBody',
            'Each turn is one quarter — three months. You queue orders — as many as your <b>leadership</b> is worth, shown on the dashboard — then press <b>End quarter</b>. Everyone else moves, the world throws events at you, and you get a briefing.') }),
        ),
        h('div.help__section',
          h('h3', t('help.budgets', 'Your two budgets')),
          h('ul',
            h('li', { html: t('help.budgetMoney',
              '<b>Treasury</b> — money. It refills from your economy every quarter, and you can borrow against a credit line when it runs short. Big programmes cost a share of GDP.') }),
            h('li', { html: t('help.budgetPc',
              '<b>Political capital</b> — how much your government can push through. It refills based on approval and stability, so unpopular governments can do less.') }),
          ),
        ),
        h('div.help__section',
          h('h3', t('help.picking', 'Picking orders')),
          h('p', { html: t('help.pickingBody',
            'The percentage on each card is its chance of succeeding, based on your actual stats. Orders marked <b>suggested</b> address a problem you currently have; ones marked <b>can backfire</b> can end up worse than doing nothing.') }),
          h('p', t('help.targets',
            'Orders that need a target say so — click the card, then click a country on the map.')),
        ),
        h('div.help__section',
          h('h3', t('help.escalation', 'Escalation')),
          h('p', t('help.escalationBody',
            'Sanctions, cyber operations and forward deployments climb an escalation ladder with that country. The higher the ladder, the more the answer comes in waves rather than notes, the more their allies join in, and the closer the whole thing gets to a war.')),
        ),
        h('div.help__section',
          h('h3', t('help.mapTitle', 'The map')),
          h('p', t('help.mapBody',
            'Scroll or pinch to zoom, drag to pan. The buttons above it recolour the world by relations, power, stability, alignment or conflict. Hover any country to fill the inspector on the left; click to pin it, click again for its full file.')),
        ),
        h('div.help__section',
          h('h3', t('help.winning', 'Winning')),
          h('p', t('help.winningBody',
            'Your mandate is set on day one and graded at the end across the economy, domestic order, standing, security and world stability. If stability hits zero, your government falls and the run is over.')),
        ),
        h('div.help__section',
          h('h3', t('help.territoryTitle', 'Territory')),
          h('p', t('help.territoryBody',
            'The filled colours are the land each country actually holds. Wars move the front quarter by quarter, decisive peaces redraw the border, and a country that comes apart leaves a new state on the map with a new name and its own statistics. Your own territory is outlined; press T to turn the fill off.')),
        ),
        h('div.help__section',
          h('h3', t('help.controlTitle', 'What you control')),
          h('p', t('help.controlBody',
            'Your grip on the left panel is a reading of how much of the quarter is actually yours to shape: political capital, approval, stability, and how many crises are running without you. When it is high, your orders mostly land. When it is low, the world is setting the agenda and you are answering it.')),
        ),
        h('div.help__section',
          h('h3', t('help.keyboard', 'Keyboard')),
          KEY_GROUPS.map((group) =>
            h('div',
              h('h4.help__keygroup', groupLabel(group)),
              h('div.help__keys',
                keybindsIn(group.id).flatMap((bind) => [
                  h('span.help__keycombo', bind.keys.map((k) => h('kbd', k))),
                  h('span', keyLabel(bind)),
                ]),
              ),
            ),
          ),
        ),
        h('div.row.row--end',
          h('button.btn.btn--primary', { onclick: () => { this.helpOpen = false; this.render(); } }, t('common.gotIt', 'Got it')),
        ),
      ),
    );
  }

  #openDetail(id) {
    this.detailNationId = id;
    this.render();
  }

  #nationDetail() {
    const game = this.game;
    const id = this.detailNationId;
    const def = defOf(game, id);
    const state = game.nations[id];
    const relation = getRelation(game, game.playerId, id);
    const isPlayer = id === game.playerId;
    const history = state.history || [];

    return h('div.modal', {
      role: 'dialog', 'aria-modal': 'true',
      onclick: (e) => { if (e.target.classList.contains('modal')) this.#closeDetail(); },
    },
      h('div.modal__panel',
        h('button.modal__close', { onclick: () => this.#closeDetail(), 'aria-label': 'Close' }, '✕'),
        h('div.detail__head',
          h('span.detail__flag', def.flag),
          h('div',
            h('h2.modal__title', tNation(def)),
            h('div.detail__sub',
              tNation(def, 'capital') ? `◉ ${tNation(def, 'capital')} · ` : '',
              `${tNation(def, 'government')} · ${tNation(def, 'leaderTitle')} · ${state.population.toFixed(0)}M`),
          ),
        ),
        h('p.detail__brief', tNation(def, 'brief')),
        isPlayer ? null : h('div.detail__relation', { style: { color: relationColour(relation) } },
          `${relationLabel(relation)} — relation ${Math.round(relation)}`),

        // Five books rather than one grid of ten figures: what the country
        // earns, who lives in it, what it can fight with, whether it holds
        // together, and what the rest of the world makes of it.
        this.#detailEconomy(id, state),
        this.#detailPeople(id, state),
        this.#detailForce(id, state),
        this.#detailCohesion(id, state),
        this.#detailStanding(id, state, def),
        this.#detailTies(id),

        history.length > 2
          ? h('div.detail__section',
              h('h3.subhead', t('detail.trend', 'Over the run')),
              h('div.trends',
                trend(t('stat.gdp', 'GDP'), history.map((p) => p.gdp), (v) => `$${v.toFixed(2)}T`),
                trend(t('stat.military', 'Military'), history.map((p) => p.military), (v) => v.toFixed(0)),
                trend(t('stat.stability', 'Stability'), history.map((p) => p.stability), (v) => v.toFixed(0)),
              ),
            )
          : null,

        state.modifiers.length
          ? h('div.modifiers',
              h('h3.subhead', t('panel.inEffect', 'In effect')),
              state.modifiers.map((m) => h('div.modifier', h('span', tModifier(m.label)), h('span.modifier__turns', `${m.turnsLeft}q`))))
          : null,
        isPlayer
          ? null
          : h('div.detail__actions',
              h('h3.subhead', t('orders.orderAgainst', 'Order against this country')),
              h('div.detail__buttons',
                targetedActionsFor(game, id).map((a) =>
                  h('button.btn.btn--ghost.btn--sm', {
                    title: tAction(a, 'blurb'),
                    onclick: () => { this.#closeDetail(); this.#queueAction(a, id); },
                  }, tAction(a)),
                ),
              ),
            ),
      ),
    );
  }

  // ── The country file, book by book ───────────────────────────────────────

  #detailEconomy(id, state) {
    const game = this.game;
    const outlook = growthOutlook(game, id);
    const books = ledgerFor(game, id);
    const worldGdp = sovereignIds(game).reduce((sum, n) => sum + game.nations[n].gdp, 0) || 1;
    const owed = debtOf(state);

    return h('div.detail__section',
      h('h3.subhead', t('detail.economy', 'The economy')),
      h('div.detail__grid',
        detailStat(t('stat.gdp', 'GDP'), `$${state.gdp.toFixed(2)}T`,
          `${rankLabel(game, rankOf(game, id, (s) => s.gdp))} · ${((state.gdp / worldGdp) * 100).toFixed(1)}% of world`),
        detailStat(t('stat.perCapita', 'Per head'), formatPerCapita(state),
          rankLabel(game, rankOf(game, id, (s) => (s.gdp / Math.max(s.population, 0.01)) * 1e6))),
        detailStat(t('stat.growth', 'Growth next quarter'), `${outlook.growth >= 0 ? '+' : '−'}${Math.abs(outlook.growth).toFixed(2)}%`,
          t('detail.annualised', '{n}% annualised', { n: (outlook.growth * 4).toFixed(1) })),
        owed > 0
          ? detailStat(t('hud.debt', 'Debt'), money(owed),
              t('hud.pctOfGdp', '{pct}% of GDP', { pct: ((owed / (state.gdp * 1000)) * 100).toFixed(0) }))
          : detailStat(t('stat.treasury', 'Treasury'), money(state.treasury),
              t('hud.pctOfGdp', '{pct}% of GDP', { pct: ((state.treasury / (state.gdp * 1000)) * 100).toFixed(0) })),
        detailStat(t('detail.revenue', 'Revenue'), `${money(books.revenue)}/q`,
          t('detail.collection', '{pct}% collected', { pct: Math.round(books.collection * 100) })),
        detailStat(t('detail.upkeep', 'Forces upkeep'), `${money(books.upkeep)}/q`,
          t('detail.netBalance', 'net {amount}', { amount: money(books.net) })),
      ),
      outlook.drivers.length
        ? h('div.drivers',
            outlook.drivers.slice(0, 5).map((d) =>
              h('span.driver', { class: d.value >= 0 ? 'driver is-up' : 'driver is-down' },
                `${t(`driver.${d.label}`, d.label)} ${d.value >= 0 ? '+' : '−'}${Math.abs(d.value).toFixed(2)}`)),
          )
        : null,
    );
  }

  #detailPeople(id, state) {
    const game = this.game;
    const land = formatArea(game, id);
    const area = areaOf(game, id);
    const worldPop = sovereignIds(game).reduce((sum, n) => sum + game.nations[n].population, 0) || 1;
    const density = area > 0 ? (state.population * 1e6) / (area * 1000) : 0;

    return h('div.detail__section',
      h('h3.subhead', t('detail.peopleAndLand', 'People and ground')),
      h('div.detail__grid',
        detailStat(t('stat.people', 'Population'), `${Math.round(state.population)}M`,
          `${rankLabel(game, rankOf(game, id, (s) => s.population))} · ${((state.population / worldPop) * 100).toFixed(1)}% of world`),
        detailStat(t('stat.land', 'Land held'), land.text,
          land.change === null
            ? rankLabel(game, rankOf(game, id, (s, g) => areaOf(g, s.id)))
            : t('context.sinceStart', '{delta}% since {date}', {
                delta: deltaLabel(land.change),
                date: `Q1 ${game.year - Math.floor(game.turn / 4)}`,
              })),
        detailStat(t('detail.density', 'Density'), `${Math.round(density)}/km²`,
          density > 200 ? t('detail.crowded', 'crowded') : density > 40 ? t('detail.settled', 'settled') : t('detail.empty', 'thinly settled')),
      ),
    );
  }

  #detailForce(id, state) {
    const game = this.game;
    const deployable = combatPower(game, id);
    const wars = game.wars.filter((w) => w.attackers.includes(id) || w.defenders.includes(id));
    const active = wars.filter((w) => w.active);

    return h('div.detail__section',
      h('h3.subhead', t('detail.force', 'What it can fight with')),
      h('div.detail__grid',
        detailStat(t('stat.military', 'Military'), Math.round(state.military),
          `${bandOf('military', state.military)} · ${rankLabel(game, rankOf(game, id, (s) => s.military))}`),
        detailStat(t('stat.readiness', 'Readiness'), Math.round(state.readiness), bandOf('readiness', state.readiness)),
        detailStat(t('detail.deployable', 'Deployable power'), deployable.toFixed(0),
          rankLabel(game, rankOf(game, id, (s, g) => combatPower(g, s.id)))),
        detailStat(t('stat.nukes', 'Warheads'), state.nukes ? state.nukes.toLocaleString() : '—',
          state.nukes ? rankLabel(game, rankOf(game, id, (s) => s.nukes)) : t('detail.noArsenal', 'no arsenal')),
        detailStat(t('detail.wars', 'Wars'), `${active.length}`,
          t('detail.warsFought', '{n} fought this run', { n: wars.length })),
      ),
    );
  }

  #detailCohesion(id, state) {
    const game = this.game;
    const row = (key, invert = false) => {
      const ctx = statContext(game, id, key);
      return detailStat(statLabel(key), ctx.value,
        `${ctx.band}${ctx.delta ? ` · ${deltaLabel(ctx.delta)} this quarter` : ''}${invert ? '' : ''}`);
    };
    return h('div.detail__section',
      h('h3.subhead', t('detail.cohesion', 'Whether it holds together')),
      h('div.detail__grid',
        row('stability'),
        row('approval'),
        row('unrest', true),
        detailStat(t('stat.tech', 'Technology'), Math.round(state.tech),
          `${bandOf('tech', state.tech)} · ${rankLabel(game, rankOf(game, id, (s) => s.tech))}`),
      ),
    );
  }

  #detailStanding(id, state, def) {
    const game = this.game;
    const power = powerContext(game, id);
    const blocs = blocsOf(game, id);
    const others = sovereignIds(game).filter((n) => n !== id);
    const friends = others.filter((n) => getRelation(game, id, n) >= 40).length;
    const foes = others.filter((n) => getRelation(game, id, n) <= -40).length;
    const threat = threatOf(game, id);

    return h('div.detail__section',
      h('h3.subhead', t('detail.standing', 'How the world sees it')),
      h('div.detail__grid',
        detailStat(t('stat.influence', 'Influence'), Math.round(state.influence),
          `${bandOf('influence', state.influence)} · ${rankLabel(game, rankOf(game, id, (s) => s.influence))}`),
        detailStat(t('stat.powerRank', 'Power rank'), `#${power.rank}`,
          t('detail.ofLeader', '{pct}% of the leading power', { pct: Math.round(power.share * 100) })),
        detailStat(t('detail.friends', 'Friendly states'), `${friends}`,
          t('detail.hostileStates', '{n} hostile', { n: foes })),
        detailStat(t('detail.threat', 'Seen as a threat'), `${Math.round(threat * 100)}`,
          threat >= 0.6 ? t('detail.threatHigh', 'others will combine against it')
            : threat >= 0.35 ? t('detail.threatSome', 'watched closely')
              : t('detail.threatLow', 'nobody is alarmed')),
      ),
      blocs.length
        ? h('div.chips.chips--tight',
            blocs.map((blocId) => h('span.blocchip',
              { class: BLOCS[blocId]?.invented ? 'blocchip is-invented' : 'blocchip' },
              t(`bloc.${blocId}`, BLOCS[blocId]?.name || blocId))),
          )
        : h('p.panel__note', t('detail.nonAligned', 'In no bloc.')),
      (state.sanctionedBy || []).length
        ? h('p.panel__note.panel__note--warn',
            t('detail.sanctionedBy', 'Under sanctions from {n} state(s).', { n: state.sanctionedBy.length }))
        : null,
    );
  }

  /**
   * The sixth book: what this country needs from other countries, how far you
   * could actually put an army on it, and which way the leverage between you
   * runs. Every one of those is a thing the engine now decides with, and none
   * of it was visible anywhere.
   */
  #detailTies(id) {
    const game = this.game;
    const report = tiesReport(game, id, 4);
    const isPlayer = id === game.playerId;
    const grip = isPlayer ? null : leverage(game, game.playerId, id);
    const arm = isPlayer ? null : reachDetail(game, game.playerId, id);
    const pct = (v) => `${(v * 100).toFixed(1)}%`;

    return h('div.detail__section',
      h('h3.subhead', t('detail.ties', 'What it runs on')),
      h('div.detail__grid',
        detailStat(t('detail.openness', 'Exposed to abroad'), `${Math.round(report.openness * 100)}%`,
          t('detail.opennessHint', 'share of the economy that runs through other countries')),
        detailStat(t('detail.tradeOpen', 'Of that, open'), `${Math.round(report.health * 100)}%`,
          report.health >= 0.99
            ? t('detail.nothingShut', 'nothing is closed')
            : t('detail.growthCost', '{n} points of growth a quarter', { n: report.drag.toFixed(2) })),
        isPlayer ? null : detailStat(t('detail.leverage', 'Leverage'),
          t(`ties.verdict.${grip.verdict}`, GRIP_WORDS[grip.verdict]),
          t('detail.leverageHint', 'they carry {theirs}, you carry {yours}',
            { theirs: pct(grip.theirs), yours: pct(grip.yours) })),
        isPlayer ? null : detailStat(t('detail.reach', 'Your reach there'),
          `${Math.round(arm.value * 100)}%`,
          arm.why === 'border'
            ? t('detail.reachBorder', 'you share a border')
            : arm.why === 'staging'
              ? t('detail.reachStaging', 'staging through {via}', { via: tNation(defOf(game, arm.via)) })
              : t('detail.reachDistance', '{km},000 km away', { km: Math.round(arm.km / 1000) })),
      ),
      report.dependsOn.length
        ? h('div.chips.chips--tight',
            report.dependsOn.slice(0, 4).map((entry) =>
              h('span.tiechip', { class: entry.open < 1 ? 'tiechip is-shut' : 'tiechip' },
                `${entry.def?.flag || ''} ${tNation(entry.def)} ${pct(entry.share)}`)),
          )
        : null,
    );
  }

  // ── The amendment desk ───────────────────────────────────────────────────

  #amendModal() {
    const game = this.game;
    const options = amendmentOptions(game);
    const left = amendmentsLeft(game);
    const byClause = new Map();
    for (const option of options) {
      if (!byClause.has(option.clauseId)) byClause.set(option.clauseId, []);
      byClause.get(option.clauseId).push(option);
    }

    return h('div.modal', {
      role: 'dialog', 'aria-modal': 'true',
      onclick: (e) => { if (e.target.classList.contains('modal')) { this.amendOpen = false; this.render(); } },
    },
      h('div.modal__panel',
        h('button.modal__close', { onclick: () => { this.amendOpen = false; this.render(); }, 'aria-label': 'Close' }, '✕'),
        h('h2.modal__title', t('amend.title', 'Amend the constitution')),
        h('p.modal__body',
          t('amend.body',
            'One amendment per term. The rules you inherited say what this office may do; changing them is the only way to widen that, and the country reads the change as a statement about you.')),
        left <= 0
          ? h('p.panel__note.panel__note--warn', t('constitution.onePerTerm', 'One amendment per term. You have used yours.'))
          : null,
        [...byClause.entries()].map(([clauseId, list]) =>
          h('div.detail__section',
            h('h3.subhead', t(`clause.${clauseId}`, list[0].clauseName)),
            h('div.amendments', list.map((option) =>
              h('button.amendment', {
                disabled: left <= 0 || game.politicalCapital < option.pc,
                title: option.note,
                onclick: () => {
                  const warn = option.backlash > 8
                    ? t('amend.selfServing', 'This is an amendment that widens your own powers. Everyone will read it that way. Proceed?')
                    : t('amend.confirm', 'Amend {clause} to “{setting}” for {pc} political capital?',
                        { clause: option.clauseName, setting: option.label, pc: option.pc });
                  if (!window.confirm(warn)) return;
                  const result = amend(this.game, option.clauseId, option.to, null);
                  this.app.toast(result.ok
                    ? t('amend.done', 'The constitution is amended.')
                    : result.reason);
                  if (result.ok) this.amendOpen = false;
                  this.render();
                },
              },
                h('div.amendment__head',
                  h('span.amendment__label', t(`clauseValue.${clauseId}.${String(option.to)}`, option.label)),
                  h('span.amendment__cost', `${option.pc} PC`),
                ),
                h('div.amendment__note', t(`clause.${clauseId}.${String(option.to)}`, option.note)),
                option.backlash > 0
                  ? h('div.amendment__backlash', t('amend.backlash', 'Unpopular: unrest and approval will move against you.'))
                  : h('div.amendment__backlash.is-good', t('amend.welcomed', 'This one would be welcomed.')),
              ),
            )),
          ),
        ),
      ),
    );
  }

  // ── The congress floor ───────────────────────────────────────────────────

  #congressModal() {
    const game = this.game;
    const congress = congressOf(game);
    if (!congress) return null;
    const score = scoreRun(game);
    const quartersLeft = Math.max(0, game.totalTurns - game.turn);

    return h('div.modal', {
      role: 'dialog', 'aria-modal': 'true',
      onclick: (e) => { if (e.target.classList.contains('modal')) { this.congressOpen = false; this.render(); } },
    },
      h('div.modal__panel.modal__panel--wide',
        h('button.modal__close', { onclick: () => { this.congressOpen = false; this.render(); }, 'aria-label': 'Close' }, '✕'),
        h('h2.modal__title', t('congress.title', 'The world congress')),
        h('p.modal__body',
          congress.resolved
            ? t('congress.closed', 'The floor is closed. This is how the room voted.')
            : t('congress.open',
                'Every government in the room is writing the next order. The vote is held when the term ends — {n} quarter(s) from now. You may put one clause on the paper and hold {m} meeting(s).',
                { n: quartersLeft, m: congress.lobbyLeft })),

        congress.clauses.map((clause) => {
          const result = congress.resolved
            ? congress.results.find((r) => r.clause.id === clause.id)
            : tally(game, clause);
          const yourVote = result.votes.find((v) => v.id === game.playerId);
          return h('div.clausecard', { class: result.passing || result.passed ? 'clausecard is-passing' : 'clausecard' },
            h('div.clausecard__head',
              h('span.clausecard__title', t(`clauseType.${clause.typeId}`, clause.title)),
              h('span.clausecard__share',
                `${Math.round(result.share * 100)}%`),
            ),
            h('p.clausecard__detail', t(`clauseType.${clause.typeId}Detail`, clause.detail)),
            h('div.stat__track',
              h('div.stat__fill', {
                style: {
                  width: `${Math.min(100, result.share * 100)}%`,
                  background: (result.passing || result.passed) ? 'var(--good)' : 'var(--muted-2)',
                },
              }),
            ),
            h('div.clausecard__meta',
              clause.proposerId === game.playerId
                ? h('span.badge.badge--ai', t('congress.yours', 'your clause'))
                : clause.proposerId
                  ? h('span.badge', t('congress.proposedBy', 'proposed by {nation}', { nation: tNation(defOf(game, clause.proposerId)) }))
                  : h('span.badge', t('congress.fromFloor', 'from the floor')),
              h('span', t('congress.weights', 'for {a} · against {b} · abstaining {c}', {
                a: result.forWeight, b: result.againstWeight, c: result.abstainWeight,
              })),
              yourVote ? h('span', t('congress.youVote', 'you: {v}', { v: t(`congress.${yourVote.vote}`, yourVote.vote) })) : null,
            ),
            congress.resolved
              ? null
              : h('div.clausecard__lobby',
                  h('span.clausecard__lobbyLabel', t('congress.lobbyLabel', 'Bring somebody round:')),
                  this.#lobbyTargets(clause, result).map((entry) =>
                    h('button.btn.btn--tiny.btn--ghost', {
                      disabled: congress.lobbyLeft <= 0 || game.politicalCapital < 1,
                      title: t('congress.lobbyHint',
                        'One political capital. How far they move depends on your standing with them and the record you are running on.'),
                      onclick: () => {
                        const res = lobby(this.game, clause.id, entry.id, score);
                        this.app.toast(res.ok
                          ? t('congress.lobbied', '{nation} moves {n} toward you.',
                              { nation: tNation(defOf(game, entry.id)), n: res.shift.toFixed(2) })
                          : res.reason);
                        this.render();
                      },
                    }, `${defOf(game, entry.id)?.flag || ''} ${tNation(defOf(game, entry.id))}`),
                  ),
                ),
          );
        }),

        congress.resolved || congress.proposalUsed
          ? null
          : h('div.detail__section',
              h('h3.subhead', t('congress.propose', 'Put your own clause on the paper (3 PC)')),
              h('div.detail__buttons',
                CLAUSE_TYPES
                  .filter((type) => !congress.clauses.some((c) => c.typeId === type.id))
                  .map((type) =>
                    h('button.btn.btn--ghost.btn--sm', {
                      disabled: game.politicalCapital < 3,
                      title: t(`clauseType.${type.id}Detail`, type.detail),
                      onclick: () => {
                        const res = propose(this.game, type.id, this.app.rngForUi());
                        this.app.toast(res.ok
                          ? t('congress.proposed', 'It is on the paper.')
                          : res.reason);
                        this.render();
                      },
                    }, t(`clauseType.${type.id}`, type.title)),
                  ),
              ),
            ),
      ),
    );
  }

  /** The three countries most worth a meeting on this clause. */
  #lobbyTargets(clause, result) {
    const game = this.game;
    return [...result.votes]
      .filter((v) => v.id !== game.playerId && v.vote !== 'for')
      // Heaviest votes that are closest to being winnable.
      .sort((a, b) => (b.weight * (1 - Math.abs(b.lean))) - (a.weight * (1 - Math.abs(a.lean))))
      .slice(0, 3);
  }

  #closeDetail() {
    this.detailNationId = null;
    this.render();
  }

  /**
   * The end of a term.
   *
   * Three faces: the verdict and the grade, the page a textbook would write
   * from the run's own log, and — if the term simply ran out rather than the
   * government falling — the vote on whether you get another one.
   */
  #endgameModal() {
    const game = this.game;
    const ending = game.ending || {};
    const score = ending.score || scoreRun(game);
    const termEnd = ending.kind === 'term-end';
    const election = ending.election || (termEnd ? electionState(game, score) : null);
    const page = chronicle(game, score);

    const tabs = [
      ['verdict', t('end.verdict', 'Verdict')],
      ['history', t('end.history', 'How it is remembered')],
      ...(termEnd ? [['next', t('end.whatNext', 'What next')]] : []),
    ];

    return h('div.modal', { role: 'dialog', 'aria-modal': 'true' },
      h('div.modal__panel.modal__panel--end',
        h('div.modal__eyebrow',
          `${NATIONS_BY_ID[game.playerId].name} · ${dateLabel(game)} · `,
          game.status === 'defeat' ? t('end.governmentFallen', 'government fallen') : t('end.termConcluded', 'term concluded')),
        h('h2.modal__title', ending.title || 'The run is over'),

        h('div.tabs',
          tabs.map(([id, label]) =>
            h('button.tab', {
              class: this.endTab === id ? 'tab is-active' : 'tab',
              onclick: () => { this.endTab = id; this.render(); },
            }, label),
          ),
        ),

        this.endTab === 'history' ? this.#endHistory(page)
          : this.endTab === 'next' && termEnd ? this.#endNext(score, election)
            : this.#endVerdict(ending, score),

        h('div.row.row--end',
          h('button.btn.btn--ghost', { onclick: () => this.app.exportSave() }, t('end.exportRun', 'Export run')),
          h('button.btn.btn--ghost', {
            onclick: () => {
              const text = chronicleText(page);
              navigator.clipboard?.writeText(text);
              this.app.toast(t('end.copied', 'The page is on your clipboard.'));
            },
          }, t('end.copyPage', 'Copy the page')),
          h('button.btn.btn--primary', { onclick: () => this.app.quitToMenu() }, t('end.newGame', 'New game')),
        ),
      ),
    );
  }

  #endVerdict(ending, score) {
    return h('div',
      h('p.modal__body', ending.summary || ''),
      h('div.grade',
        h('div.grade__letter', score.grade),
        h('div.grade__meta',
          h('div.grade__score', `${score.total} / 100`),
          h('div.grade__tier', `${score.tier} · difficulty ${score.difficulty}/10`),
        ),
      ),
      h('div.grade__components',
        score.components.map((c) =>
          h('div.gradebar',
            h('div.gradebar__head', h('span', c.label), h('span', String(c.value))),
            h('div.stat__track', h('div.stat__fill', { style: { width: `${c.value}%`, background: statColour(c.value) } })),
          ),
        ),
      ),
      score.ambitionBonus || score.settlementBonus
        ? h('div.bonuses',
            score.ambitionBonus
              ? h('span.bonus', t('end.ambitionBonus', 'private ambition +{n}', { n: score.ambitionBonus }))
              : null,
            score.settlementBonus
              ? h('span.bonus', t('end.settlementBonus', 'the settlement +{n}', { n: score.settlementBonus }))
              : null,
          )
        : null,
      h('h3.subhead', t('end.mandate', 'Mandate')),
      h('ul.objectives',
        score.objectives.map((o) =>
          h('li.objective', { class: o.met ? 'objective is-met' : 'objective' },
            h('span.objective__mark', o.met ? '✓' : '✕'),
            h('div', h('div.objective__title', t(`objective.${o.id}.title`, o.title))))),
      ),
      h('h3.subhead', t('end.ambitions', 'What everybody privately wanted')),
      h('div.reveals',
        revealAmbitions(this.game, { limit: 8 }).map((entry) =>
          h('div.reveal', { class: entry.achieved ? 'reveal is-met' : 'reveal' },
            h('span.reveal__flag', entry.def?.flag || '·'),
            h('span.reveal__name', tNation(entry.def)),
            h('span.reveal__what', t(`ambition.${entry.ambition.id}`, entry.ambition.title)),
            h('span.reveal__mark', entry.achieved ? '✓' : '✕'),
          ),
        ),
      ),
    );
  }

  #endHistory(page) {
    return h('div.chronicle',
      h('h3.chronicle__title', page.title),
      h('div.chronicle__era', page.era),
      page.paragraphs.map((paragraph) => h('p.chronicle__para', paragraph)),
      h('div.chronicle__ledger',
        page.ledger.map((row) =>
          h('div.chronicle__row', h('span', row.label), h('span', row.value))),
      ),
      h('blockquote.chronicle__epitaph', page.epitaph),
      h('div.chronicle__seed', t('end.seed', 'seed {seed}', { seed: page.seed })),
    );
  }

  #endNext(score, election) {
    const game = this.game;
    const legacy = inheritance(game);
    const band = electionBand(election.share);

    return h('div',
      h('p.modal__body',
        election.allowed
          ? t('end.standBody',
              'The term is over. The constitution allows you to stand again, and the country is about to say whether it wants you to.')
          : t('end.barredBody',
              'The term is over and the constitution says it was your last. Whoever comes next inherits everything below.')),

      election.allowed
        ? h('div.election',
            h('div.election__head',
              h('span.election__share', `${election.share.toFixed(0)}%`),
              h('span.election__band', { class: `election__band is-${band.id}` },
                t(`electionBand.${band.id}`, band.label)),
            ),
            h('div.stat__track',
              h('div.stat__fill', { style: { width: `${election.share}%`, background: statColour(election.share) } })),
            h('div.election__reasons',
              election.reasons.map((r) =>
                h('span.election__reason', { class: r.value >= 0 ? 'election__reason is-up' : 'election__reason is-down' },
                  `${t(`electionReason.${r.label}`, r.label)} ${r.value >= 0 ? '+' : '−'}${Math.abs(r.value).toFixed(0)}`)),
            ),
          )
        : null,

      h('h3.subhead', t('end.inherit', 'What carries over')),
      h('div.detail__grid',
        detailStat(t('end.debt', 'Debt'), legacy.debt ? money(legacy.debt) : '—'),
        detailStat(t('end.commitments', 'Programmes running'), String(legacy.commitments.length),
          legacy.committedQuarterly ? `${money(legacy.committedQuarterly)}/q` : ''),
        detailStat(t('end.warsOn', 'Wars still on'), String(legacy.wars)),
        detailStat(t('end.amendmentsMade', 'Amendments made'), String(legacy.amendments)),
        detailStat(t('end.blocsHeld', 'Organisations'), String(legacy.blocs)),
        detailStat(t('end.rivalOpen', 'Standing problem'),
          legacy.nemesis ? tNation(defOf(game, legacy.nemesis)) : '—'),
      ),

      this.standingAgain
        ? h('p.panel__note', this.standingAgain)
        : h('div.row.row--end',
            h('button.btn.btn--ghost', {
              onclick: () => {
                const result = concludeTerm(this.game, score, { stand: false });
                this.standingAgain = t('end.steppedDown',
                  'You stood down. The country goes on without you, which was always going to happen eventually.');
                this.app.saveNow();
                this.render();
              },
            }, t('end.standDown', 'Stand down')),
            h('button.btn.btn--primary', {
              disabled: !election.allowed,
              title: election.allowed ? '' : t('end.barredHint', 'The constitution does not allow another term.'),
              onclick: () => {
                const result = concludeTerm(this.game, score, { stand: true });
                if (result.outcome === 're-elected') {
                  this.app.toast(t('end.wonAgain', 'Returned for another term.'));
                  this.standingAgain = null;
                  this.endTab = 'verdict';
                  this.app.saveNow();
                  this.app.startNextTerm?.();
                } else {
                  this.standingAgain = result.outcome === 'defeated'
                    ? t('end.lost', 'The country said no, on {pct}% of the vote.', { pct: result.election.share.toFixed(0) })
                    : t('end.barred', 'The constitution said no.');
                }
                this.render();
              },
            }, t('end.standAgain', 'Stand again')),
          ),
    );
  }
}

/** Plain-language "what this does" pills for an order card. */
export function describeEffects(action) {
  const success = action.effects?.success || {};
  const pills = [];

  for (const [key, value] of Object.entries(success.self || {})) {
    if (!STAT_LABELS[key] || typeof value !== 'number' || value === 0) continue;
    pills.push({
      text: `${statLabel(key)} ${fmt(value)}`,
      dir: (key === 'unrest' ? -value : value) > 0 ? 'up' : 'down',
    });
  }
  if (success.modifier?.growth) {
    pills.push({
      text: t('effect.growth', 'Growth {n}/q for {turns}q',
        { n: fmt(success.modifier.growth, 2), turns: success.modifier.turns ?? 4 }),
      dir: success.modifier.growth > 0 ? 'up' : 'down',
    });
  }
  if (typeof success.relation === 'number' && success.relation !== 0) {
    pills.push({
      text: t('effect.relations', 'Their relations {n}', { n: fmt(success.relation) }),
      dir: success.relation > 0 ? 'up' : 'down',
    });
  }
  for (const [key, value] of Object.entries(success.target || {})) {
    if (!STAT_LABELS[key] || typeof value !== 'number' || value === 0) continue;
    pills.push({
      text: t('effect.their', 'Their {stat} {n}', { stat: statLabel(key), n: fmt(value) }),
      dir: value > 0 ? 'up' : 'down',
    });
  }
  if (typeof success.worldTension === 'number' && success.worldTension !== 0) {
    pills.push({
      text: t('effect.tension', 'World tension {n}', { n: fmt(success.worldTension) }),
      dir: success.worldTension < 0 ? 'up' : 'down',
    });
  }
  // Commercial orders say what they close or re-open, because the size of the
  // cut is the whole content of the order.
  if (action.trade?.sever) {
    pills.push({
      text: t('effect.severs', 'Trade between you {n}%', { n: fmt(-action.trade.sever * 100) }),
      dir: 'down',
    });
  }
  if (action.trade?.restore) {
    pills.push({ text: t('effect.restores', 'Trade between you {n}%', { n: fmt(100) }), dir: 'up' });
  }
  if (typeof success.treasuryPctGdp === 'number' && success.treasuryPctGdp !== 0) {
    pills.push({
      text: t('effect.treasury', 'Treasury {n}% GDP', { n: fmt(success.treasuryPctGdp, 1) }),
      dir: 'up',
    });
  }
  return pills.slice(0, 5);
}

function fmt(value, digits = 0) {
  const rounded = Number(value).toFixed(digits);
  return `${value > 0 ? '+' : '−'}${Math.abs(Number(rounded))}`;
}

function metric(label, value, hint, colour, context) {
  return h('div.metric', { title: hint },
    h('span.metric__label', label),
    h('span.metric__value', { style: colour ? { color: colour } : null }, value),
    // The line that turns a figure into a position: per-head, per-GDP, or rank.
    context ? h('span.metric__context', context) : null,
  );
}

function ledgerCell(label, value, context, colour = null) {
  return h('div.ledger__cell',
    h('span.ledger__label', label),
    h('span.ledger__value', { style: colour ? { color: colour } : null }, value),
    h('span.ledger__context', context),
  );
}

function detailStat(label, value, context = null) {
  return h('div.detailstat',
    h('span.detailstat__label', label),
    h('span.detailstat__value', String(value)),
    // A figure with nothing beside it is the flat number this interface exists
    // to avoid: rank, share, band or direction, whichever says most.
    context ? h('span.detailstat__context', context) : null,
  );
}

/** A labelled series with its line and its two ends. */
function trend(label, values, format) {
  const series = (values || []).filter((v) => Number.isFinite(v));
  const line = sparkline(series, { colour: 'var(--accent)' });
  if (!line) return null;
  const first = series[0];
  const last = series[series.length - 1];
  const change = first ? ((last - first) / Math.abs(first)) * 100 : 0;
  return h('div.trend',
    h('div.trend__head',
      h('span.trend__label', label),
      h('span.trend__change', { class: `trend__change ${change >= 0 ? 'is-up' : 'is-down'}` },
        `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(0)}%`),
    ),
    line,
    h('div.trend__ends',
      h('span', format(first)),
      h('span', format(last)),
    ),
  );
}
