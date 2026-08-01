// The command screen: dashboard, map, briefing feed, and the order planner.

import { NATIONS_BY_ID } from '../data/nations.js';
import { ACTIONS, CATEGORIES, actionAvailability, actionCost } from '../engine/actions.js';
import { difficultyModifiers } from '../engine/difficulty.js';
import { successChance } from '../engine/resolve.js';
import {
  activeWarsFor,
  dateLabel,
  getRelation,
  livePower,
  rankedNations,
} from '../engine/state.js';
import { scoreRun } from '../engine/turn.js';
import { h, money, mount, relationColour, relationLabel, statColour } from './dom.js';
import { WorldMap } from './map.js';

const STAT_ROWS = [
  { key: 'stability', label: 'Stability', hint: 'Institutional resilience. At zero, your government falls.' },
  { key: 'approval', label: 'Approval', hint: 'Public support. Drives your political capital.' },
  { key: 'unrest', label: 'Unrest', hint: 'Street-level agitation. High unrest breaks everything else.', invert: true },
  { key: 'military', label: 'Military', hint: 'Hard power index, 0-100.' },
  { key: 'readiness', label: 'Readiness', hint: 'How much of that force is actually deployable now.' },
  { key: 'tech', label: 'Technology', hint: 'Research and industrial sophistication.' },
  { key: 'influence', label: 'Influence', hint: 'Diplomatic and soft-power reach.' },
];

export class GameScreen {
  /**
   * @param {HTMLElement} root
   * @param {object} app  the controller in main.js
   */
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
  }

  get game() {
    return this.app.game;
  }

  render() {
    const game = this.game;
    if (!game) return;

    mount(this.root,
      h('div.game',
        this.#topbar(),
        h('div.game__body',
          h('div.col.col--left', this.#dashboard(), this.#objectives(), this.#relations()),
          h('div.col.col--centre', this.#mapPanel(), this.#feed()),
          h('div.col.col--right', this.#planner()),
        ),
        this.#actionBar(),
      ),
      this.detailNationId ? this.#nationDetail() : null,
      game.pendingDecision && !this.decisionChoice ? this.#decisionModal() : null,
      game.status !== 'active' ? this.#endgameModal() : null,
    );

    // The map needs a live element to draw into, so it renders after mount.
    const holder = this.root.querySelector('[data-map]');
    if (holder) {
      this.map = new WorldMap(holder, { onSelect: (id) => this.#onMapSelect(id) });
      this.map.render(game);
      if (this.pendingTargetAction) this.map.setSelected(null);
    }
  }

  // ── Top bar ──────────────────────────────────────────────────────────────

  #topbar() {
    const game = this.game;
    const def = NATIONS_BY_ID[game.playerId];
    const state = game.nations[game.playerId];
    const mods = difficultyModifiers(game.difficulty);
    const score = scoreRun(game, mods);

    return h('header.topbar',
      h('div.topbar__identity',
        h('span.topbar__flag', def.flag),
        h('div',
          h('div.topbar__country', def.name),
          h('div.topbar__role', def.leaderTitle, ' · ', mods.tier.name, ' (', String(game.difficulty), '/10)'),
        ),
      ),
      h('div.topbar__metrics',
        metric('Date', dateLabel(game), `Quarter ${game.turn} of ${game.totalTurns}`),
        metric('Treasury', money(state.treasury), 'Available to spend this quarter'),
        metric('Political capital', `${game.politicalCapital}`, 'Spent on orders; regenerates each quarter'),
        metric('GDP', `$${state.gdp.toFixed(2)}T`, 'Nominal, annualised'),
        metric('World tension', `${Math.round(game.worldTension)}`, 'Global escalation pressure', statColour(game.worldTension, true)),
        metric('Standing', `${score.total} (${score.grade})`, 'Your run graded as it stands'),
      ),
      h('div.topbar__actions',
        h('button.btn.btn--ghost.btn--sm', { onclick: () => this.app.openSettings() }, 'Settings'),
        h('button.btn.btn--ghost.btn--sm', { onclick: () => this.app.saveNow() }, 'Save'),
        h('button.btn.btn--ghost.btn--sm', { onclick: () => this.app.quitToMenu() }, 'Menu'),
      ),
    );
  }

  // ── Left column ──────────────────────────────────────────────────────────

  #dashboard() {
    const state = this.game.nations[this.game.playerId];
    const wars = activeWarsFor(this.game, this.game.playerId);

    return h('section.panel',
      h('h2.panel__title', 'The state of the nation'),
      h('div.stats',
        STAT_ROWS.map((row) => this.#statBar(row, state[row.key])),
      ),
      state.modifiers.length
        ? h('div.modifiers',
            h('h3.subhead', 'In effect'),
            state.modifiers.slice(0, 8).map((m) =>
              h('div.modifier',
                { class: (m.growth || 0) < 0 ? 'modifier is-bad' : 'modifier' },
                h('span', m.label),
                h('span.modifier__turns', `${m.turnsLeft}q`),
              ),
            ),
          )
        : null,
      wars.length
        ? h('div.wars',
            h('h3.subhead', 'At war'),
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
                  `${yourScore > 0 ? 'Advancing' : yourScore < 0 ? 'Losing ground' : 'Deadlocked'} · `,
                  `${(war.casualties / 1000).toFixed(0)}k casualties`,
                ),
              );
            }),
          )
        : null,
    );
  }

  #statBar(row, value) {
    const v = Math.round(value);
    return h('div.stat', { title: row.hint },
      h('div.stat__head',
        h('span.stat__label', row.label),
        h('span.stat__value', String(v)),
      ),
      h('div.stat__track',
        h('div.stat__fill', {
          style: { width: `${v}%`, background: statColour(v, row.invert) },
        }),
      ),
    );
  }

  #objectives() {
    const score = scoreRun(this.game);
    return h('section.panel',
      h('h2.panel__title', 'Your mandate'),
      h('ul.objectives',
        score.objectives.map((obj) =>
          h('li.objective', { class: obj.met ? 'objective is-met' : 'objective' },
            h('span.objective__mark', obj.met ? '✓' : '○'),
            h('div',
              h('div.objective__title', obj.title),
              h('div.objective__detail', obj.detail),
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
      .map((id) => ({ id, rel: getRelation(game, game.playerId, id), power: livePower(game, id) }))
      .sort((a, b) => b.power - a.power);

    const friends = [...others].sort((a, b) => b.rel - a.rel).slice(0, 4);
    const foes = [...others].sort((a, b) => a.rel - b.rel).slice(0, 4);

    const row = (entry) => {
      const def = NATIONS_BY_ID[entry.id];
      return h('button.relation', { onclick: () => this.#openDetail(entry.id) },
        h('span.relation__flag', def.flag),
        h('span.relation__name', def.name),
        h('span.relation__value', { style: { color: relationColour(entry.rel) } },
          relationLabel(entry.rel)),
      );
    };

    return h('section.panel',
      h('h2.panel__title', 'Relations'),
      h('h3.subhead', 'Closest'),
      friends.map(row),
      h('h3.subhead', 'Most hostile'),
      foes.map(row),
    );
  }

  // ── Centre column ────────────────────────────────────────────────────────

  #mapPanel() {
    return h('section.panel.panel--map',
      h('div.panel__titlebar',
        h('h2.panel__title', 'Situation map'),
        this.pendingTargetAction
          ? h('span.targeting',
              `Select a target for ${this.pendingTargetAction.name}`,
              h('button.btn.btn--tiny', { onclick: () => { this.pendingTargetAction = null; this.render(); } }, 'Cancel'),
            )
          : h('span.legend',
              legendDot('var(--accent)', 'You'),
              legendDot('var(--good)', 'Friendly'),
              legendDot('var(--muted)', 'Neutral'),
              legendDot('var(--bad)', 'Hostile'),
            ),
      ),
      h('div.map-holder', { dataset: { map: 'true' } }),
    );
  }

  #feed() {
    const briefing = this.app.briefing;
    const tabs = [
      ['briefing', 'Briefing'],
      ['dispatches', 'Dispatches'],
      ['advisor', 'Advisers'],
      ['log', 'Archive'],
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
          ? h('span.badge.badge--warn', { title: briefing.degraded }, 'AI unavailable — local briefing')
          : briefing?.source === 'offline'
            ? h('span.badge', 'Local briefing')
            : h('span.badge.badge--ai', 'AI briefing'),
      ),
      h('div.feed', this.#feedBody(briefing)),
    );
  }

  #feedBody(briefing) {
    if (this.busy) {
      return h('div.feed__loading',
        h('div.spinner'),
        h('p', this.app.narrator.usingAi ? 'The wires are coming in…' : 'Resolving the quarter…'),
      );
    }
    if (!briefing) return h('p.empty', 'No briefing yet.');

    if (this.feedTab === 'dispatches') {
      return briefing.dispatches?.length
        ? briefing.dispatches.map((d) =>
            h('article.dispatch',
              h('div.dispatch__source', d.source),
              h('p.dispatch__text', d.text),
            ),
          )
        : h('p.empty', 'The wires are quiet this quarter.');
    }

    if (this.feedTab === 'advisor') return this.#advisorPanel();

    if (this.feedTab === 'log') {
      const entries = [...this.game.log].reverse().slice(0, 60);
      return entries.length
        ? entries.map((e) =>
            h('div.logline', { class: `logline logline--${e.severity}` },
              h('span.logline__date', e.date),
              h('span.logline__text', e.text),
            ),
          )
        : h('p.empty', 'Nothing archived yet.');
    }

    return h('article.briefing',
      h('h3.briefing__headline', briefing.headline),
      (briefing.briefing || []).map((p) => h('p', p)),
      briefing.advisorNote
        ? h('blockquote.advice', h('span.advice__label', 'Chief of staff'), briefing.advisorNote)
        : null,
      briefing.outlook ? h('p.outlook', briefing.outlook) : null,
    );
  }

  #advisorPanel() {
    return h('div.advisor',
      this.app.narrator.usingAi
        ? null
        : h('p.panel__note.panel__note--warn',
            'Advisers need a language model. Add a free provider key in Settings to consult them.'),
      h('div.advisor__log',
        this.advisorLog.length
          ? this.advisorLog.map((entry) =>
              h('div.advisor__entry',
                h('p.advisor__q', entry.question),
                h('p.advisor__a', entry.answer),
              ),
            )
          : h('p.empty', 'Ask your national security adviser anything about the current position.'),
        this.advisorBusy ? h('div.spinner') : null,
      ),
      h('form.advisor__form', {
        onsubmit: (e) => {
          e.preventDefault();
          const input = e.target.querySelector('input');
          const question = input.value.trim();
          if (question) {
            input.value = '';
            this.#askAdvisor(question);
          }
        },
      },
        h('input.input', {
          type: 'text',
          placeholder: 'Should we sanction them, or wait?',
          disabled: !this.app.narrator.usingAi || this.advisorBusy,
        }),
        h('button.btn.btn--sm', { type: 'submit', disabled: !this.app.narrator.usingAi || this.advisorBusy }, 'Ask'),
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

    return h('section.panel.panel--planner',
      h('h2.panel__title', 'Orders for the quarter'),

      h('div.budget',
        h('div.budget__row',
          h('span', 'Committed'),
          h('span', { class: spend > state.treasury ? 'is-over' : '' },
            `${money(spend)} of ${money(state.treasury)}`),
        ),
        h('div.budget__track',
          h('div.budget__fill', {
            style: {
              width: `${Math.min(100, (spend / Math.max(1, state.treasury)) * 100)}%`,
              background: spend > state.treasury ? 'var(--bad)' : 'var(--accent)',
            },
          }),
        ),
        h('div.budget__row',
          h('span', 'Political capital'),
          h('span', { class: pcSpend > game.politicalCapital ? 'is-over' : '' },
            `${pcSpend} of ${game.politicalCapital}`),
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
        : h('p.empty.empty--tight', 'No orders queued. Up to four per quarter.'),

      h('div.chips.chips--tight',
        CATEGORIES.map((c) =>
          h('button.chip', {
            class: this.category === c.id ? 'chip is-active' : 'chip',
            onclick: () => { this.category = c.id; this.render(); },
          }, c.icon, ' ', c.name),
        ),
      ),

      h('div.catalogue',
        ACTIONS.filter((a) => a.category === this.category).map((a) => this.#actionCard(a)),
      ),

      this.#customOrder(),
    );
  }

  #actionCard(action) {
    const game = this.game;
    const state = game.nations[game.playerId];
    const mods = difficultyModifiers(game.difficulty);
    const cost = actionCost(action, state);
    const queued = this.orders.length >= 4;
    const chance = successChance(game, action, game.playerId, null, mods);

    const blocked =
      queued ||
      cost > state.treasury - this.orders.reduce((s, o) => s + o.cost, 0) ||
      action.pc > game.politicalCapital - this.orders.reduce((s, o) => s + o.pc, 0);

    return h('button.action', {
      class: blocked ? 'action is-blocked' : 'action',
      disabled: blocked,
      title: blocked ? (queued ? 'Four orders is the limit for one quarter' : 'Not enough budget or political capital') : action.blurb,
      onclick: () => this.#queueAction(action),
    },
      h('div.action__head',
        h('span.action__name', action.name),
        h('span.action__chance', `${Math.round(chance * 100)}%`),
      ),
      h('p.action__blurb', action.blurb),
      h('div.action__meta',
        h('span', money(cost)),
        h('span', `${action.pc} PC`),
        action.target === 'nation' ? h('span.action__tag', 'needs target') : null,
        action.risk === 'high' ? h('span.action__tag.action__tag--risk', 'high risk') : null,
        action.declaresWar ? h('span.action__tag.action__tag--war', 'act of war') : null,
      ),
    );
  }

  #queueAction(action, targetId = null) {
    if (action.target === 'nation' && !targetId) {
      this.pendingTargetAction = action;
      this.render();
      return;
    }
    const mods = difficultyModifiers(this.game.difficulty);
    const availability = actionAvailability(this.game, action, targetId);
    if (!availability.ok) {
      this.app.toast(availability.reason);
      return;
    }
    if (action.confirm) {
      const label = targetId ? ` against ${NATIONS_BY_ID[targetId].name}` : '';
      if (!window.confirm(`${action.name}${label}. This is not reversible. Proceed?`)) return;
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

  #onMapSelect(id) {
    if (this.pendingTargetAction) {
      if (id === this.game.playerId) {
        this.app.toast('You cannot target your own country.');
        return;
      }
      this.#queueAction(this.pendingTargetAction, id);
      return;
    }
    this.#openDetail(id);
  }

  #customOrder() {
    return h('div.custom',
      h('h3.subhead', 'Freeform order'),
      h('p.panel__note',
        this.app.narrator.usingAi
          ? 'Write anything. Your advisers will price it and tell you the odds.'
          : 'Without an AI provider this is priced generically. Add a free key in Settings for real adjudication.',
      ),
      h('textarea.input.custom__box', {
        rows: 3,
        placeholder: 'e.g. Quietly buy up the lithium offtake contracts before Beijing does.',
        value: this.customDraft,
        oninput: (e) => { this.customDraft = e.target.value; },
      }),
      h('div.row',
        h('button.btn.btn--sm', {
          disabled: this.customBusy,
          onclick: () => this.#priceCustom(),
        }, this.customBusy ? 'Consulting…' : 'Price this order'),
        this.customPriced
          ? h('button.btn.btn--ghost.btn--sm', {
              onclick: () => { this.customPriced = null; this.render(); },
            }, 'Discard')
          : null,
      ),
      this.customPriced ? this.#customCard() : null,
    );
  }

  async #priceCustom() {
    const text = this.customDraft.trim();
    if (!text) {
      this.app.toast('Write the order first.');
      return;
    }
    this.customBusy = true;
    this.render();
    const result = await this.app.narrator.adjudicate(this.game, text);
    this.customPriced = result;
    this.customBusy = false;
    this.render();
  }

  #customCard() {
    const result = this.customPriced;
    if (!result.feasible) {
      return h('div.custom__result.custom__result--refused',
        h('strong', 'Your advisers refuse.'),
        h('p', result.refusal || 'This cannot be done.'),
      );
    }
    const action = result.action;
    const state = this.game.nations[this.game.playerId];
    const cost = actionCost(action, state);
    const mods = difficultyModifiers(this.game.difficulty);
    const chance = successChance(this.game, action, this.game.playerId, result.targetId, mods);

    return h('div.custom__result',
      h('div.custom__head',
        h('strong', action.name),
        h('span.action__chance', `${Math.round(chance * 100)}%`),
      ),
      h('p.action__blurb', result.rationale || action.blurb),
      h('div.action__meta',
        h('span', money(cost)),
        h('span', `${action.pc} PC`),
        h('span.action__tag', action.category),
        result.targetId ? h('span.action__tag', NATIONS_BY_ID[result.targetId].name) : null,
        action.risk === 'high' ? h('span.action__tag.action__tag--risk', 'high risk') : null,
      ),
      h('button.btn.btn--sm.btn--primary', {
        onclick: () => {
          this.#queueAction(action, result.targetId);
          this.customPriced = null;
          this.customDraft = '';
          this.render();
        },
      }, 'Add to orders'),
    );
  }

  // ── Bottom bar ───────────────────────────────────────────────────────────

  #actionBar() {
    const game = this.game;
    const state = game.nations[game.playerId];
    const spend = this.orders.reduce((sum, o) => sum + o.cost, 0);
    const pcSpend = this.orders.reduce((sum, o) => sum + o.pc, 0);
    const overBudget = spend > state.treasury || pcSpend > game.politicalCapital;
    const undecided = Boolean(game.pendingDecision && !this.decisionChoice);

    return h('footer.actionbar',
      h('div.actionbar__summary',
        this.orders.length
          ? `${this.orders.length} order${this.orders.length > 1 ? 's' : ''} · ${money(spend)} · ${pcSpend} PC`
          : 'No orders queued — the quarter will pass without direction.',
        undecided ? h('span.actionbar__warn', ' A crisis is awaiting your decision.') : null,
      ),
      h('div.row',
        this.orders.length
          ? h('button.btn.btn--ghost', { onclick: () => { this.orders = []; this.render(); } }, 'Clear orders')
          : null,
        h('button.btn.btn--primary.btn--lg', {
          disabled: this.busy || overBudget || game.status !== 'active',
          onclick: () => this.app.endTurn(this.orders, this.decisionChoice),
        }, this.busy ? 'Resolving…' : 'End quarter →'),
      ),
    );
  }

  // ── Modals ───────────────────────────────────────────────────────────────

  #decisionModal() {
    const decision = this.game.pendingDecision;
    return h('div.modal', { role: 'dialog', 'aria-modal': 'true' },
      h('div.modal__panel.modal__panel--decision',
        h('div.modal__eyebrow', 'Decision required'),
        h('h2.modal__title', decision.title),
        h('p.modal__body', decision.prompt),
        h('div.choices',
          decision.choices.map((choice) =>
            h('button.choice', {
              onclick: () => {
                this.decisionChoice = choice.id;
                this.render();
              },
            },
              h('div.choice__label', choice.label),
              h('div.choice__detail', choice.detail),
              typeof choice.chance === 'number'
                ? h('div.choice__odds', `${Math.round(choice.chance * 100)}% to land as intended`)
                : h('div.choice__odds', 'Certain outcome'),
            ),
          ),
        ),
        h('button.btn.btn--ghost.btn--block', {
          onclick: () => { this.decisionChoice = '__defer__'; this.render(); },
        }, 'Take no decision (accept the consequences)'),
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
      role: 'dialog',
      'aria-modal': 'true',
      onclick: (e) => { if (e.target.classList.contains('modal')) this.#closeDetail(); },
    },
      h('div.modal__panel',
        h('button.modal__close', { onclick: () => this.#closeDetail(), 'aria-label': 'Close' }, '✕'),
        h('div.detail__head',
          h('span.detail__flag', def.flag),
          h('div',
            h('h2.modal__title', def.name),
            h('div.detail__sub', def.government, ' · ', def.leaderTitle, ' · ', String(state.population.toFixed(0)), 'M people'),
          ),
        ),
        h('p.detail__brief', def.brief),
        isPlayer
          ? null
          : h('div.detail__relation', { style: { color: relationColour(relation) } },
              `${relationLabel(relation)} — relation ${Math.round(relation)}`),
        h('div.detail__grid',
          detailStat('GDP', `$${state.gdp.toFixed(2)}T`),
          detailStat('Treasury', money(state.treasury)),
          detailStat('Military', Math.round(state.military)),
          detailStat('Readiness', Math.round(state.readiness)),
          detailStat('Technology', Math.round(state.tech)),
          detailStat('Stability', Math.round(state.stability)),
          detailStat('Unrest', Math.round(state.unrest)),
          detailStat('Influence', Math.round(state.influence)),
          detailStat('Warheads', state.nukes || '—'),
          detailStat('Power rank', `#${rankedNations(game).findIndex((r) => r.state.id === id) + 1}`),
        ),
        state.modifiers.length
          ? h('div.modifiers',
              h('h3.subhead', 'In effect'),
              state.modifiers.map((m) => h('div.modifier', h('span', m.label), h('span.modifier__turns', `${m.turnsLeft}q`))),
            )
          : null,
        isPlayer
          ? null
          : h('div.detail__actions',
              h('h3.subhead', 'Order against this country'),
              h('div.detail__buttons',
                ACTIONS.filter(
                  (a) => a.target === 'nation' && actionAvailability(game, a, id).ok,
                ).map((a) =>
                  h('button.btn.btn--ghost.btn--sm', {
                    onclick: () => {
                      this.#closeDetail();
                      this.#queueAction(a, id);
                    },
                  }, a.name),
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
          game.status === 'defeat' ? 'government fallen' : 'term concluded',
        ),
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
        h('h3.subhead', 'Mandate'),
        h('ul.objectives',
          score.objectives.map((o) =>
            h('li.objective', { class: o.met ? 'objective is-met' : 'objective' },
              h('span.objective__mark', o.met ? '✓' : '✕'),
              h('div', h('div.objective__title', o.title)),
            ),
          ),
        ),
        h('div.row.row--end',
          h('button.btn.btn--ghost', { onclick: () => this.app.exportSave() }, 'Export run'),
          h('button.btn.btn--primary', { onclick: () => this.app.quitToMenu() }, 'New game'),
        ),
      ),
    );
  }
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

function legendDot(colour, label) {
  return h('span.legend__item',
    h('span.legend__dot', { style: { background: colour } }),
    label,
  );
}

