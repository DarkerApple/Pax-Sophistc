// Keyboard shortcuts, declared once.
//
// The handler in main.js and the reference card in the help modal both read
// this table, so a shortcut cannot exist without being documented and cannot be
// documented without existing.

import { t } from '../i18n/index.js';

/**
 * @type {Array<{id: string, keys: string[], group: string, label: string}>}
 */
export const KEYBINDS = [
  { id: 'endTurn', keys: ['Enter'], group: 'turn', label: 'End the quarter' },
  { id: 'category', keys: ['1', '…', '9'], group: 'turn', label: 'Jump to an order category' },
  { id: 'undo', keys: ['Backspace'], group: 'turn', label: 'Remove the last queued order' },
  { id: 'clear', keys: ['X'], group: 'turn', label: 'Clear every queued order' },
  { id: 'freeform', keys: ['F'], group: 'turn', label: 'Write a freeform order' },
  { id: 'save', keys: ['S'], group: 'turn', label: 'Save the run' },

  { id: 'view', keys: ['V'], group: 'map', label: 'Cycle what the map colours by' },
  { id: 'territory', keys: ['T'], group: 'map', label: 'Show or hide filled territory' },
  { id: 'home', keys: ['G'], group: 'map', label: 'Centre the map on your country' },
  { id: 'pin', keys: ['P'], group: 'map', label: 'Pin or unpin the country you are inspecting' },
  { id: 'countryMenu', keys: ['O'], group: 'map', label: 'Orders against the country you are inspecting' },
  { id: 'zoom', keys: ['+', '−', '0'], group: 'map', label: 'Zoom in, zoom out, reset' },
  { id: 'pan', keys: ['←', '↑', '→', '↓'], group: 'map', label: 'Pan the map' },

  { id: 'feed', keys: [',', '.'], group: 'reading', label: 'Previous / next briefing tab' },
  { id: 'help', keys: ['?'], group: 'reading', label: 'This list' },
  { id: 'close', keys: ['Esc'], group: 'reading', label: 'Close whatever is open' },
];

export const KEY_GROUPS = [
  { id: 'turn', label: 'The quarter' },
  { id: 'map', label: 'The map' },
  { id: 'reading', label: 'Reading and help' },
];

export function keybindsIn(groupId) {
  return KEYBINDS.filter((k) => k.group === groupId);
}

export function keyLabel(bind) {
  return t(`key.${bind.id}`, bind.label);
}

export function groupLabel(group) {
  return t(`keyGroup.${group.id}`, group.label);
}
