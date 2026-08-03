// Application shell: owns the game object, the narrator, and which screen is up.

import { Narrator } from './ai/narrator.js';
import { PROVIDERS, PROVIDERS_BY_ID } from './ai/providers.js';
import { AiClient } from './ai/client.js';
import { startGame } from './engine/lifecycle.js';
import { withRng } from './engine/state.js';
import { advanceTurn } from './engine/turn.js';
import { CATEGORIES } from './engine/actions.js';
import { h, mount } from './ui/dom.js';
import { GameScreen } from './ui/game.js';
import { VIEW_MODES } from './ui/map.js';
import { SetupScreen } from './ui/setup.js';
import { THEMES, UI_SCALES, applyTheme, applyUiScale } from './ui/theme.js';
import { LANGUAGES, currentLanguage, setLanguage, t, tIn, tLabel } from './i18n/index.js';
import {
  clearSave,
  exportGame,
  importGame,
  loadAiConfig,
  loadGame,
  loadPrefs,
  saveAiConfig,
  saveGame,
  savePrefs,
} from './ui/store.js';

class App {
  constructor(root) {
    this.root = root;
    this.game = null;
    this.briefing = null;
    this.narrator = new Narrator(loadAiConfig());
    this.screen = null;
    this.settingsOpen = false;
    this.toastEl = document.getElementById('toast');
  }

  start() {
    const prefs = loadPrefs();
    setLanguage(prefs.language);
    applyTheme(prefs.theme);
    applyUiScale(prefs.uiScale);
    this.showSetup();
  }

  #scrollToTop() {
    window.scrollTo(0, 0);
  }

  showSetup() {
    this.screen = new SetupScreen(this.root, {
      onStart: (config) => this.newGame(config),
      onContinue: () => this.continueGame(),
      onImport: (file) => this.importSave(file),
    });
    this.screen.render();
    this.#scrollToTop();
    this.#renderOverlays();
  }

  /**
   * A draw from the game's own random stream, for the handful of interface
   * actions that need one. Routed through withRng so the state is written back
   * and the run stays replayable from its seed.
   */
  /**
   * A new term on the same country. The save, the world and every commitment
   * carry over; only the screen has to be told the run is live again.
   */
  startNextTerm() {
    this.briefing = null;
    this.screen.orders = [];
    this.screen.decisionChoice = null;
    this.screen.standingAgain = null;
    this.screen.endTab = 'verdict';
    this.saveNow();
    this.screen.render();
  }

  rngForUi() {
    const game = this.game;
    return {
      pick: (list) => withRng(game, (rng) => rng.pick(list)),
      int: (a, b) => withRng(game, (rng) => rng.int(a, b)),
      weighted: (list, weight) => withRng(game, (rng) => rng.weighted(list, weight)),
      bool: (p) => withRng(game, (rng) => rng.bool(p)),
      float: (a, b) => withRng(game, (rng) => rng.float(a, b)),
      next: () => withRng(game, (rng) => rng.next()),
      normal: (m, sd) => withRng(game, (rng) => rng.normal(m, sd)),
    };
  }

  async newGame({ playerNationId, difficulty, totalTurns, mode, seed, ai }) {
    saveAiConfig(ai);
    savePrefs({
      lastNation: playerNationId,
      lastDifficulty: difficulty,
      lastLength: totalTurns,
      lastWorldMode: mode,
    });
    this.narrator.update(ai);

    this.game = startGame({ playerNationId, difficulty, totalTurns, seed, mode });
    this.briefing = null;

    this.screen = new GameScreen(this.root, this);
    this.screen.busy = true;
    // First-time players get the rules opened for them, once.
    if (!loadPrefs().seenHelp) {
      this.screen.helpOpen = true;
      savePrefs({ seenHelp: true });
    }
    this.screen.render();
    this.#scrollToTop();

    this.briefing = await this.narrator.opening(this.game);
    this.screen.busy = false;
    this.screen.render();
    saveGame(this.game);
    this.#renderOverlays();
  }

  continueGame() {
    const game = loadGame();
    if (!game) {
      this.toast(t('toast.noSave', 'No saved run found in this browser.'));
      return;
    }
    this.game = game;
    this.briefing = game.__lastBriefing || null;
    this.screen = new GameScreen(this.root, this);
    this.screen.render();
    this.#scrollToTop();
    if (!this.briefing) this.#refreshBriefingFromSave();
    this.#renderOverlays();
  }

  async #refreshBriefingFromSave() {
    this.screen.busy = true;
    this.screen.render();
    this.briefing = await this.narrator.opening(this.game);
    this.screen.busy = false;
    this.screen.render();
  }

  async importSave(file) {
    try {
      this.game = await importGame(file);
      this.briefing = null;
      this.screen = new GameScreen(this.root, this);
      this.screen.render();
      await this.#refreshBriefingFromSave();
      saveGame(this.game);
      this.toast(t('toast.loaded', 'Save loaded.'));
    } catch (err) {
      this.toast(err.message || 'That file could not be loaded.');
    }
  }

  /**
   * Resolve the quarter, then narrate it.
   * The simulation runs first and always succeeds; narration is best-effort.
   */
  async endTurn(orders, decisionChoice) {
    if (!this.game || this.game.status !== 'active' || this.screen.busy) return;

    this.screen.busy = true;
    this.screen.render();

    let report;
    try {
      report = advanceTurn(this.game, {
        orders: orders.map((o) => ({
          actionId: o.actionId,
          targetId: o.targetId,
          custom: o.custom || null,
        })),
        decisionChoice: decisionChoice === '__defer__' ? null : decisionChoice,
      });
    } catch (err) {
      this.screen.busy = false;
      this.screen.render();
      this.toast(err.message || 'The quarter could not be resolved.');
      return;
    }

    this.screen.orders = [];
    this.screen.decisionChoice = null;
    this.screen.customPriced = null;
    this.screen.pendingTargetAction = null;
    this.screen.feedTab = 'briefing';

    this.briefing = await this.narrator.briefing(this.game, report);
    this.game.__lastBriefing = this.briefing;

    this.screen.busy = false;
    this.screen.render();
    saveGame(this.game);
    this.#renderOverlays();

    if (this.briefing.degraded) {
      this.toast(t('toast.degraded', 'Narration fell back to local text: {reason}.', { reason: this.briefing.degraded }));
    }
  }

  /** Switch the interface language and redraw whatever is on screen. */
  setLanguage(id) {
    setLanguage(id);
    savePrefs({ language: id });
    this.screen?.render?.();
  }

  saveNow() {
    this.game.__lastBriefing = this.briefing;
    this.toast(saveGame(this.game)
      ? t('toast.saved', 'Run saved to this browser.')
      : t('toast.saveFailed', 'Could not save — storage is full or blocked.'));
  }

  exportSave() {
    if (this.game) exportGame(this.game);
  }

  quitToMenu() {
    if (this.game?.status === 'active'
      && !window.confirm(t('toast.confirmLeave', 'Leave this run? It stays saved in this browser.'))) {
      return;
    }
    if (this.game) {
      this.game.__lastBriefing = this.briefing;
      saveGame(this.game);
    }
    this.game = null;
    this.briefing = null;
    this.showSetup();
  }

  openSettings() {
    this.settingsOpen = true;
    this.#renderOverlays();
  }

  closeSettings() {
    this.settingsOpen = false;
    this.#renderOverlays();
  }

  toast(message) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('is-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('is-visible'), 4200);
  }

  #renderOverlays() {
    const layer = document.getElementById('overlay');
    if (!layer) return;
    mount(layer, this.settingsOpen ? this.#settingsModal() : null);
  }

  #settingsModal() {
    const config = { ...loadAiConfig() };
    let prefs = loadPrefs();
    let status = null;

    const rerender = () => mount(document.getElementById('overlay'), body());

    const body = () =>
      h('div.modal', {
        onclick: (e) => { if (e.target.classList.contains('modal')) this.closeSettings(); },
      },
        h('div.modal__panel',
          h('button.modal__close', { onclick: () => this.closeSettings(), 'aria-label': 'Close' }, '✕'),
          h('h2.modal__title', t('settings.title', 'Settings')),

          h('h3.subhead', t('setup.appearance', 'Appearance')),
          h('label.field',
            h('span.field__label', t('setup.language', 'Language')),
            h('div.chips',
              LANGUAGES.map((lang) =>
                h('button.chip', {
                  class: currentLanguage() === lang.id ? 'chip is-active' : 'chip',
                  onclick: () => {
                    this.setLanguage(lang.id);
                    prefs = loadPrefs();
                    rerender();
                  },
                }, lang.native),
              ),
            ),
          ),
          h('div.theme-grid',
            THEMES.map((theme) =>
              h('button.theme-card', {
                class: prefs.theme === theme.id ? 'theme-card is-active' : 'theme-card',
                title: tIn('themes', theme.id, 'blurb', theme.blurb),
                onclick: () => {
                  applyTheme(theme.id);
                  savePrefs({ theme: theme.id });
                  prefs = loadPrefs();
                  rerender();
                },
              },
                h('div.theme-card__swatches',
                  theme.swatch.map((colour) => h('span.theme-card__swatch', { style: { background: colour } }))),
                h('div.theme-card__name', tLabel('themes', theme.id, theme.name)),
              ),
            ),
          ),
          h('label.field', { style: { marginTop: '0.75rem' } },
            h('span.field__label', t('setup.textSize', 'Text size')),
            h('div.chips',
              UI_SCALES.map((scale) =>
                h('button.chip', {
                  class: prefs.uiScale === scale.id ? 'chip is-active' : 'chip',
                  onclick: () => {
                    applyUiScale(scale.id);
                    savePrefs({ uiScale: scale.id });
                    prefs = loadPrefs();
                    rerender();
                  },
                }, tLabel('scales', scale.id, scale.name)),
              ),
            ),
          ),

          h('hr.rule'),
          h('h3.subhead', t('settings.aiNarrator', 'AI narrator')),
          h('p.panel__note', t('settings.keyNotice',
            'Your API key is stored in this browser only and is sent directly to the provider you choose. The game is fully playable with no provider at all.')),

          h('label.field',
            h('span.field__label', t('settings.provider', 'Provider')),
            h('select.input', {
              onchange: (e) => {
                config.providerId = e.target.value;
                config.model = PROVIDERS_BY_ID[config.providerId].defaultModel || '';
                status = null;
                rerender();
              },
            },
              PROVIDERS.map((p) => h('option', { value: p.id, selected: p.id === config.providerId }, p.label)),
            ),
            h('span.field__hint', (PROVIDERS_BY_ID[config.providerId] || PROVIDERS[0]).blurb),
          ),

          (PROVIDERS_BY_ID[config.providerId] || PROVIDERS[0]).kind === 'none' ? null : h('label.field',
            h('span.field__label', t('settings.apiKey', 'API key')),
            h('input.input', {
              type: 'password', value: config.apiKey, autocomplete: 'off',
              oninput: (e) => { config.apiKey = e.target.value.trim(); },
            }),
            (PROVIDERS_BY_ID[config.providerId] || PROVIDERS[0]).signupUrl
              ? h('span.field__hint', t('settings.freeKeyAt', 'Free key: '),
                  h('a', {
                    href: (PROVIDERS_BY_ID[config.providerId] || PROVIDERS[0]).signupUrl,
                    target: '_blank', rel: 'noreferrer noopener',
                  }, (PROVIDERS_BY_ID[config.providerId] || PROVIDERS[0]).signupUrl.replace(/^https?:\/\//, '')))
              : null,
          ),

          (PROVIDERS_BY_ID[config.providerId] || PROVIDERS[0]).kind === 'none' ? null : h('label.field',
            h('span.field__label', t('settings.model', 'Model')),
            h('input.input', {
              type: 'text', list: 'settings-models', value: config.model,
              oninput: (e) => { config.model = e.target.value.trim(); },
            }),
            h('datalist', { id: 'settings-models' },
              (PROVIDERS_BY_ID[config.providerId] || PROVIDERS[0]).models.map((m) => h('option', { value: m }))),
          ),

          config.providerId === 'custom'
            ? h('label.field',
                h('span.field__label', t('settings.endpoint', 'Endpoint URL')),
                h('input.input', {
                  type: 'url', value: config.endpoint,
                  oninput: (e) => { config.endpoint = e.target.value.trim(); },
                }),
              )
            : null,

          h('div.row',
            h('button.btn.btn--ghost', {
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = t('settings.testing', 'Testing…');
                try {
                  const reply = await new AiClient({ ...config, enabled: true }).test();
                  status = { kind: 'ok', message: `Connected — "${reply}".` };
                } catch (err) {
                  status = { kind: 'bad', message: err.message };
                }
                rerender();
              },
            }, t('settings.test', 'Test connection')),
            h('button.btn.btn--primary', {
              onclick: () => {
                saveAiConfig(config);
                this.narrator.update(config);
                this.toast(t('settings.saved', 'Settings saved.'));
                this.closeSettings();
                this.screen?.render?.();
              },
            }, t('settings.saveSettings', 'Save settings')),
          ),
          status ? h('p.status', { class: `status status--${status.kind}` }, status.message) : null,

          h('hr.rule'),
          h('h3.subhead', t('settings.thisRun', 'This run')),
          h('div.row',
            h('button.btn.btn--ghost.btn--sm', { onclick: () => this.exportSave() }, t('settings.exportSave', 'Export save file')),
            h('button.btn.btn--ghost.btn--sm.btn--danger', {
              onclick: () => {
                if (window.confirm(t('toast.confirmDelete', 'Delete the saved run in this browser?'))) {
                  clearSave();
                  this.toast(t('toast.deleted', 'Saved run deleted.'));
                }
              },
            }, t('settings.deleteSave', 'Delete browser save')),
          ),
        ),
      );

    return body();
  }
}

const app = new App(document.getElementById('app'));
app.start();

// ── Keyboard ────────────────────────────────────────────────────────────────

function typingInAField(target) {
  return target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

document.addEventListener('keydown', (e) => {
  const screen = app.screen;

  if (e.key === 'Escape') {
    if (app.settingsOpen) app.closeSettings();
    else if (screen?.menuFor) { screen.menuFor = null; screen.render(); }
    else if (screen?.helpOpen) { screen.helpOpen = false; screen.render(); }
    else if (screen?.detailNationId) { screen.detailNationId = null; screen.render(); }
    else if (screen?.pendingTargetAction) { screen.pendingTargetAction = null; screen.render(); }
    return;
  }

  if (typingInAField(e.target)) return;
  if (!(screen instanceof GameScreen) || !app.game) return;

  if (e.key === '?') {
    screen.helpOpen = true;
    screen.render();
    e.preventDefault();
    return;
  }

  if (e.key === 'Enter' && app.game.status === 'active' && !screen.busy && !app.settingsOpen && !screen.helpOpen) {
    if (app.game.pendingDecision && !screen.decisionChoice) return;
    app.endTurn(screen.orders, screen.decisionChoice);
    e.preventDefault();
    return;
  }

  const categoryIndex = Number(e.key) - 1;
  if (Number.isInteger(categoryIndex) && categoryIndex >= 0 && categoryIndex < CATEGORIES.length) {
    screen.category = CATEGORIES[categoryIndex].id;
    screen.render();
    e.preventDefault();
    return;
  }

  const key = e.key.toLowerCase();

  // The order queue.
  if (e.key === 'Backspace' && screen.orders.length) {
    screen.orders.pop();
    screen.render();
    e.preventDefault();
    return;
  }
  if (key === 'x' && screen.orders.length) {
    screen.orders = [];
    screen.render();
    e.preventDefault();
    return;
  }
  if (key === 'f') {
    const box = document.querySelector('.custom__box');
    if (box) {
      box.focus();
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      e.preventDefault();
      return;
    }
  }
  if (key === 's') {
    app.saveNow();
    e.preventDefault();
    return;
  }

  // The map.
  if (key === 'v') {
    const at = VIEW_MODES.findIndex((m) => m.id === screen.mapMode);
    screen.mapMode = VIEW_MODES[(at + 1) % VIEW_MODES.length].id;
    screen.map?.setMode(screen.mapMode);
    screen.render();
    e.preventDefault();
    return;
  }
  if (key === 't') {
    screen.showTerritory = !screen.showTerritory;
    screen.map?.setShowTerritory(screen.showTerritory);
    screen.render();
    e.preventDefault();
    return;
  }
  if (key === 'g') {
    screen.map?.centreOn(app.game.playerId, Math.max(2.6, screen.map.zoom));
    e.preventDefault();
    return;
  }
  if (key === 'p') {
    const target = screen.pinnedId || screen.hoverId;
    screen.pinnedId = screen.pinnedId ? null : target;
    screen.map?.setSelected(screen.pinnedId);
    screen.render();
    e.preventDefault();
    return;
  }
  // The country menu, from the keyboard: whatever the inspector is describing.
  // Anchored to the middle of the window rather than to a cursor, because there
  // isn't one.
  if (key === 'o') {
    const target = screen.pinnedId || screen.hoverId;
    if (target && target !== app.game.playerId) {
      screen.openCountryMenu(target, window.innerWidth / 2 - 144, window.innerHeight / 4);
    }
    e.preventDefault();
    return;
  }

  // The briefing.
  if (e.key === ',' || e.key === '.') {
    const tabs = ['briefing', 'dispatches', 'advisor', 'log'];
    const at = tabs.indexOf(screen.feedTab);
    const next = e.key === '.' ? at + 1 : at - 1;
    screen.feedTab = tabs[(next + tabs.length) % tabs.length];
    screen.render();
    e.preventDefault();
    return;
  }

  if (screen.map) {
    if (e.key === '+' || e.key === '=') { screen.map.zoomBy(1.3); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { screen.map.zoomBy(1 / 1.3); e.preventDefault(); }
    else if (e.key === '0') { screen.map.resetCamera(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { screen.map.panBy(60, 0); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { screen.map.panBy(-60, 0); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { screen.map.panBy(0, 60); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { screen.map.panBy(0, -60); e.preventDefault(); }
  }
});

window.__pax = app; // handy for debugging in the console
