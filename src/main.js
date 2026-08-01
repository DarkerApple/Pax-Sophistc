// Application shell: owns the game object, the narrator, and which screen is up.

import { Narrator } from './ai/narrator.js';
import { PROVIDERS, PROVIDERS_BY_ID } from './ai/providers.js';
import { AiClient } from './ai/client.js';
import { createGame } from './engine/state.js';
import { advanceTurn } from './engine/turn.js';
import { h, mount } from './ui/dom.js';
import { GameScreen } from './ui/game.js';
import { SetupScreen } from './ui/setup.js';
import {
  clearSave,
  exportGame,
  importGame,
  loadAiConfig,
  loadGame,
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
    this.showSetup();
  }

  /** Switching screens should not inherit the previous screen's scroll offset. */
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

  async newGame({ playerNationId, difficulty, totalTurns, seed, ai }) {
    saveAiConfig(ai);
    savePrefs({ lastNation: playerNationId, lastDifficulty: difficulty, lastLength: totalTurns });
    this.narrator.update(ai);

    this.game = createGame({ playerNationId, difficulty, totalTurns, seed });
    this.briefing = null;

    this.screen = new GameScreen(this.root, this);
    this.screen.busy = true;
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
      this.toast('No saved run found in this browser.');
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
    // A restored run has no live briefing; regenerate an orientation note.
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
      this.toast('Save loaded.');
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
      this.toast(`Narration fell back to local text: ${this.briefing.degraded}.`);
    }
  }

  saveNow() {
    this.game.__lastBriefing = this.briefing;
    this.toast(saveGame(this.game) ? 'Run saved to this browser.' : 'Could not save — storage is full or blocked.');
  }

  exportSave() {
    if (this.game) exportGame(this.game);
  }

  quitToMenu() {
    if (this.game?.status === 'active' && !window.confirm('Leave this run? It stays saved in this browser.')) {
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
    const provider = PROVIDERS_BY_ID[config.providerId] || PROVIDERS[0];
    let status = null;

    const rerender = () => {
      this.settingsDraft = config;
      mount(document.getElementById('overlay'), body());
    };

    const body = () =>
      h('div.modal', {
        onclick: (e) => { if (e.target.classList.contains('modal')) this.closeSettings(); },
      },
        h('div.modal__panel',
          h('button.modal__close', { onclick: () => this.closeSettings(), 'aria-label': 'Close' }, '✕'),
          h('h2.modal__title', 'Settings'),
          h('p.panel__note',
            'Your API key is stored in this browser only and is sent directly to the provider you choose. ',
            'The game is fully playable with no provider at all.',
          ),

          h('label.field',
            h('span.field__label', 'AI provider'),
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
            h('span.field__hint', provider.blurb),
          ),

          provider.kind === 'none' ? null : h('label.field',
            h('span.field__label', 'API key'),
            h('input.input', {
              type: 'password',
              value: config.apiKey,
              autocomplete: 'off',
              oninput: (e) => { config.apiKey = e.target.value.trim(); },
            }),
            provider.signupUrl
              ? h('span.field__hint', 'Free key: ',
                  h('a', { href: provider.signupUrl, target: '_blank', rel: 'noreferrer noopener' },
                    provider.signupUrl.replace(/^https?:\/\//, '')))
              : null,
          ),

          provider.kind === 'none' ? null : h('label.field',
            h('span.field__label', 'Model'),
            h('input.input', {
              type: 'text',
              list: 'settings-models',
              value: config.model,
              oninput: (e) => { config.model = e.target.value.trim(); },
            }),
            h('datalist', { id: 'settings-models' }, provider.models.map((m) => h('option', { value: m }))),
          ),

          provider.id === 'custom'
            ? h('label.field',
                h('span.field__label', 'Endpoint URL'),
                h('input.input', {
                  type: 'url',
                  value: config.endpoint,
                  oninput: (e) => { config.endpoint = e.target.value.trim(); },
                }),
              )
            : null,

          h('div.row',
            h('button.btn.btn--ghost', {
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = 'Testing…';
                try {
                  const reply = await new AiClient({ ...config, enabled: true }).test();
                  status = { kind: 'ok', message: `Connected — "${reply}".` };
                } catch (err) {
                  status = { kind: 'bad', message: err.message };
                }
                rerender();
              },
            }, 'Test connection'),
            h('button.btn.btn--primary', {
              onclick: () => {
                saveAiConfig(config);
                this.narrator.update(config);
                this.toast('Settings saved.');
                this.closeSettings();
                this.screen?.render?.();
              },
            }, 'Save settings'),
          ),
          status ? h('p.status', { class: `status status--${status.kind}` }, status.message) : null,

          h('hr.rule'),
          h('h3.subhead', 'This run'),
          h('div.row',
            h('button.btn.btn--ghost.btn--sm', { onclick: () => this.exportSave() }, 'Export save file'),
            h('button.btn.btn--ghost.btn--sm.btn--danger', {
              onclick: () => {
                if (window.confirm('Delete the saved run in this browser?')) {
                  clearSave();
                  this.toast('Saved run deleted.');
                }
              },
            }, 'Delete browser save'),
          ),
        ),
      );

    return body();
  }
}

const app = new App(document.getElementById('app'));
app.start();

// Keyboard: Escape closes whatever is on top.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (app.settingsOpen) {
    app.closeSettings();
  } else if (app.screen?.detailNationId) {
    app.screen.detailNationId = null;
    app.screen.render();
  } else if (app.screen?.pendingTargetAction) {
    app.screen.pendingTargetAction = null;
    app.screen.render();
  }
});

window.__pax = app; // handy for debugging in the console
