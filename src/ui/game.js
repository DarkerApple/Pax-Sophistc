// The command screen: dashboard, inspector, map, briefing feed, order planner.

import { NATIONS_BY_ID } from '../data/nations.js';
import { ACTIONS, CATEGORIES, actionAvailability, actionCost, actionsInCategory } from '../engine/actions.js';
import { successChance } from '../engine/resolve.js';
import {
  activeWarsFor,
  dateLabel,
  getRelation,
  livePower,
  rankedNations,
} from '../engine/state.js';
import { scoreRun } from '../engine/turn.js';
import { LADDER_MAX, playerLadders } from '../engine/consequences.js';
import { availableFunds, creditLimit, debtOf, describeFinances } from '../engine/finance.js';
import { gameModifiers } from '../engine/worldmodes.js';
import { h, money, mount, relationColour, relationLabel, statColour } from './dom.js';
import { MAP_FOCUSES, VIEW_MODES, WorldMap, alignmentOf, legendFor } from './map.js';
import { t, tAction, tLabel, tModifier, tNation } from '../i18n/index.js';

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

const STAT_LABELS = {
  military: 'Military', readiness: 'Readiness', tech: 'Tech', stability: 'Stability',
  influence: 'Influence', unrest: 'Unrest', approval: 'Approval', nukes: 'Warheads',
};

const statLabel = (key) => t(`stat.${key}`, STAT_LABELS[key]);

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
    this.hoverId = null;
    this.pinnedId = null;
    this.helpOpen = false;
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
        h('div.game__body',
          h('div.col.col--left', { dataset: { scroll: 'left' } },
            this.#dashboard(), this.#inspector(), this.#escalation(), this.#objectives(), this.#relations()),
          h('div.col.col--centre', { dataset: { scroll: 'centre' } }, this.#mapPanel(), this.#feed()),
          h('div.col.col--right', { dataset: { scroll: 'right' } }, this.#planner()),
        ),
        this.#actionBar(),
      ),
      this.detailNationId ? this.#nationDetail() : null,
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
      if (camera) this.map.camera = camera;
      this.map.render(game);
      this.map.setSelected(this.pinnedId);
      this.#syncZoomLabel();
    }
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
          ? metric(t('hud.treasury', 'Treasury'), money(state.treasury), t('hud.treasuryHint', 'Cash in hand. You can also borrow against your credit line.'))
          : metric(t('hud.debt', 'Debt'), money(-state.treasury), `${describeFinances(state).label}. ${describeFinances(state).detail}`, 'var(--bad)'),
        metric(t('hud.canSpend', 'Can spend'), money(availableFunds(state)), t('hud.spendHint', 'Cash plus your remaining credit line')),
        metric(t('hud.politicalCapital', 'Political capital'), `${game.politicalCapital}`, t('hud.pcHint', 'Every order costs some. It refills each quarter.')),
        metric(t('hud.gdp', 'GDP'), `$${state.gdp.toFixed(2)}T`, t('hud.gdpHint', 'Your economy, annualised')),
        metric(t('hud.worldTension', 'World tension'), `${Math.round(game.worldTension)}`, t('hud.tensionHint', 'How close the world is to a general crisis'), statColour(game.worldTension, true)),
        metric(t('hud.standing', 'Standing'), `${score.total} (${score.grade})`, t('hud.standingHint', 'Your run graded as it stands right now')),
      ),
      h('div.topbar__actions',
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
    const previous = state.history?.[state.history.length - 2];

    return h('section.panel',
      h('h2.panel__title', t('panel.nation', 'The state of the nation')),
      h('div.stats', STAT_ROWS.map((row) => this.#statBar(row, state[row.key], previous))),
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

  #statBar(row, value, previous) {
    const v = Math.round(value);
    const delta = previous && row.key in previous ? v - Math.round(previous[row.key]) : 0;
    return h('div.stat', { title: row.hintOf() },
      h('div.stat__head',
        h('span.stat__label', row.labelOf()),
        h('span',
          h('span.stat__value', String(v)),
          delta ? h('span.stat__delta', { class: `stat__delta stat__delta--${delta > 0 ? 'up' : 'down'}` },
            ` ${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`) : null,
        ),
      ),
      h('div.stat__track',
        h('div.stat__fill', { style: { width: `${v}%`, background: statColour(v, row.invert) } }),
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
    const def = NATIONS_BY_ID[id];
    const state = game.nations[id];
    const isPlayer = id === game.playerId;
    const relation = getRelation(game, game.playerId, id);
    const rank = rankedNations(game).findIndex((r) => r.state.id === id) + 1;
    const atWar = game.wars.some((w) => w.active && (w.attackers.includes(id) || w.defenders.includes(id)));

    return h('div',
      this.pinnedId === id ? h('div.inspector__pin', t('inspector.pinned', 'Pinned')) : null,
      h('div.inspector__head',
        h('span.inspector__flag', def.flag),
        h('div',
          h('div.inspector__name', tNation(def)),
          h('div.inspector__sub', `${tNation(def, 'government')} · #${rank} / ${Object.keys(game.nations).length}`),
        ),
      ),
      isPlayer
        ? h('div.inspector__relation', { style: { color: 'var(--accent)' } }, t('inspector.yourCountry', 'Your country'))
        : h('div.inspector__relation', { style: { color: relationColour(relation) } },
            `${relationLabel(relation)} · relation ${Math.round(relation)}`),
      atWar ? h('div.inspector__relation', { style: { color: 'var(--st-critical)' } }, t('inspector.atWar', '⚔ At war')) : null,
      h('p.inspector__brief', tNation(def, 'brief')),
      h('div.inspector__grid',
        row(t('stat.gdp', 'GDP'), `$${state.gdp.toFixed(2)}T`),
        row(t('stat.people', 'People'), `${Math.round(state.population)}M`),
        row(t('stat.military', 'Military'), Math.round(state.military)),
        row(t('stat.readiness', 'Readiness'), Math.round(state.readiness)),
        row(t('stat.tech', 'Technology'), Math.round(state.tech)),
        row(t('stat.stability', 'Stability'), Math.round(state.stability)),
        row(t('stat.unrest', 'Unrest'), Math.round(state.unrest)),
        row(t('stat.influence', 'Influence'), Math.round(state.influence)),
        row(t('stat.nukes', 'Warheads'), state.nukes || '—'),
        row(t('stat.alignment', 'Alignment'),
          alignmentOf(id) ? t(alignmentOf(id).labelKey, alignmentOf(id).name) : t('legend.nonAligned', 'Non-aligned')),
      ),
      h('div.inspector__actions',
        h('button.btn.btn--sm.btn--ghost', { onclick: () => { this.map?.centreOn(id, Math.max(3, this.map.zoom)); } }, t('inspector.zoomTo', 'Zoom to')),
        isPlayer ? null : h('button.btn.btn--sm', { onclick: () => this.#openDetail(id) }, t('inspector.openFile', 'Open full file')),
      ),
    );

    function row(label, value) {
      return h('div.inspector__row', h('span', label), h('span', String(value)));
    }
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
    const score = scoreRun(this.game);
    return h('section.panel',
      h('h2.panel__title', t('panel.mandate', 'Your mandate')),
      h('ul.objectives',
        score.objectives.map((obj) =>
          h('li.objective', { class: obj.met ? 'objective is-met' : 'objective' },
            h('span.objective__mark', obj.met ? '✓' : '○'),
            h('div',
              h('div.objective__title', t(`objective.${obj.id}.title`, obj.title)),
              h('div.objective__detail', this.#objectiveDetail(obj)),
            ),
          ),
        ),
      ),
    );
  }

  #relations() {
    const game = this.game;
    const others = Object.keys(game.nations)
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

    const catalogue = actionsInCategory(this.category)
      .sort((a, b) => Number(recommended.has(b.id)) - Number(recommended.has(a.id)));

    return h('section.panel.panel--planner',
      h('div.panel__titlebar',
        h('h2.panel__title', t('orders.title', 'Orders for the quarter')),
        h('span.badge', t('orders.count', '{n} of 4', { n: this.orders.length })),
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
            onclick: () => { this.category = c.id; this.render(); },
          }, `${c.icon} ${tLabel('categories', c.id, c.name)}`),
        ),
      ),

      h('div.catalogue', catalogue.map((a) => this.#actionCard(a, recommended.has(a.id)))),

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

  #actionCard(action, recommended) {
    const game = this.game;
    const state = game.nations[game.playerId];
    const mods = gameModifiers(game);
    const cost = actionCost(action, state);
    const queued = this.orders.length >= 4;
    const chance = successChance(game, action, game.playerId, null, mods);

    const remainingMoney = availableFunds(state) - this.orders.reduce((s, o) => s + o.cost, 0);
    const remainingPc = game.politicalCapital - this.orders.reduce((s, o) => s + o.pc, 0);
    const blocked = queued || cost > remainingMoney || action.pc > remainingPc;
    const why = queued
      ? t('orders.limitReached', 'Four orders is the limit for one quarter')
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

  #decisionModal() {
    const decision = this.game.pendingDecision;
    return h('div.modal', { role: 'dialog', 'aria-modal': 'true' },
      h('div.modal__panel.modal__panel--decision',
        h('div.modal__eyebrow', t('decision.required', 'Decision required')),
        h('h2.modal__title', decision.title),
        h('p.modal__body', decision.prompt),
        h('div.choices',
          decision.choices.map((choice) =>
            h('button.choice', { onclick: () => { this.decisionChoice = choice.id; this.render(); } },
              h('div.choice__label', choice.label),
              h('div.choice__detail', choice.detail),
              typeof choice.chance === 'number'
                ? h('div.choice__odds', t('decision.odds', '{pct}% to land as intended', { pct: Math.round(choice.chance * 100) }))
                : h('div.choice__odds', t('decision.certain', 'Certain outcome')),
            ),
          ),
        ),
        h('button.btn.btn--ghost.btn--block', {
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
            'Each turn is one quarter — three months. You queue up to four orders, then press <b>End quarter</b>. Everyone else moves, the world throws events at you, and you get a briefing.') }),
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
          h('h3', t('help.keyboard', 'Keyboard')),
          h('div.help__keys',
            h('kbd', 'Enter'), h('span', t('help.keyEnd', 'End the quarter')),
            h('kbd', '1–7'), h('span', t('help.keyCategory', 'Switch order category')),
            h('kbd', '+ / −'), h('span', t('help.keyZoom', 'Zoom the map')),
            h('kbd', '0'), h('span', t('help.keyReset', 'Reset the map view')),
            h('kbd', '?'), h('span', t('help.keyHelp', 'Open this help')),
            h('kbd', 'Esc'), h('span', t('help.keyEsc', 'Close whatever is open')),
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
    const def = NATIONS_BY_ID[id];
    const state = game.nations[id];
    const relation = getRelation(game, game.playerId, id);
    const isPlayer = id === game.playerId;

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
            h('div.detail__sub', `${tNation(def, 'government')} · ${tNation(def, 'leaderTitle')} · ${state.population.toFixed(0)}M`),
          ),
        ),
        h('p.detail__brief', tNation(def, 'brief')),
        isPlayer ? null : h('div.detail__relation', { style: { color: relationColour(relation) } },
          `${relationLabel(relation)} — relation ${Math.round(relation)}`),
        h('div.detail__grid',
          detailStat(t('stat.gdp', 'GDP'), `$${state.gdp.toFixed(2)}T`),
          detailStat(t('stat.treasury', 'Treasury'), money(state.treasury)),
          detailStat(t('stat.military', 'Military'), Math.round(state.military)),
          detailStat(t('stat.readiness', 'Readiness'), Math.round(state.readiness)),
          detailStat(t('stat.tech', 'Technology'), Math.round(state.tech)),
          detailStat(t('stat.stability', 'Stability'), Math.round(state.stability)),
          detailStat(t('stat.unrest', 'Unrest'), Math.round(state.unrest)),
          detailStat(t('stat.influence', 'Influence'), Math.round(state.influence)),
          detailStat(t('stat.nukes', 'Warheads'), state.nukes || '—'),
          detailStat(t('stat.powerRank', 'Power rank'), `#${rankedNations(game).findIndex((r) => r.state.id === id) + 1}`),
        ),
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
                ACTIONS.filter((a) => a.target === 'nation' && actionAvailability(game, a, id).ok).map((a) =>
                  h('button.btn.btn--ghost.btn--sm', {
                    onclick: () => { this.#closeDetail(); this.#queueAction(a, id); },
                  }, tAction(a)),
                ),
              ),
            ),
      ),
    );
  }

  #closeDetail() {
    this.detailNationId = null;
    this.render();
  }

  #endgameModal() {
    const game = this.game;
    const ending = game.ending || {};
    const score = ending.score || scoreRun(game);

    return h('div.modal', { role: 'dialog', 'aria-modal': 'true' },
      h('div.modal__panel.modal__panel--end',
        h('div.modal__eyebrow',
          `${NATIONS_BY_ID[game.playerId].name} · ${dateLabel(game)} · `,
          game.status === 'defeat' ? t('end.governmentFallen', 'government fallen') : t('end.termConcluded', 'term concluded')),
        h('h2.modal__title', ending.title || 'The run is over'),
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
        h('h3.subhead', t('end.mandate', 'Mandate')),
        h('ul.objectives',
          score.objectives.map((o) =>
            h('li.objective', { class: o.met ? 'objective is-met' : 'objective' },
              h('span.objective__mark', o.met ? '✓' : '✕'),
              h('div', h('div.objective__title', t(`objective.${o.id}.title`, o.title))))),
        ),
        h('div.row.row--end',
          h('button.btn.btn--ghost', { onclick: () => this.app.exportSave() }, t('end.exportRun', 'Export run')),
          h('button.btn.btn--primary', { onclick: () => this.app.quitToMenu() }, t('end.newGame', 'New game')),
        ),
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

function metric(label, value, hint, colour) {
  return h('div.metric', { title: hint },
    h('span.metric__label', label),
    h('span.metric__value', { style: colour ? { color: colour } : null }, value),
  );
}

function detailStat(label, value) {
  return h('div.detailstat',
    h('span.detailstat__label', label),
    h('span.detailstat__value', String(value)),
  );
}
