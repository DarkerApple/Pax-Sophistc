import { t } from '../i18n/index.js';

// Tiny DOM helpers. No framework, no build step — the whole game is served as
// plain ES modules.

/** True only for a plain `{...}` props bag — anything else is a child. */
function isProps(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Node) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function h(tag, ...rest) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');

  const props = isProps(rest[0]) ? rest.shift() : {};
  const children = rest;

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      el.className = el.className ? `${el.className} ${value}` : value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (key in el && key !== 'list' && typeof value !== 'object') {
      el[key] = value;
    } else {
      el.setAttribute(key, String(value));
    }
  }

  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Format a large USD figure compactly. */
export function money(billions) {
  const value = Number(billions) || 0;
  const abs = Math.abs(value);
  if (abs >= 1000) return `${value < 0 ? '−' : ''}$${(abs / 1000).toFixed(2)}T`;
  if (abs >= 1) return `${value < 0 ? '−' : ''}$${Math.round(abs)}B`;
  return `${value < 0 ? '−' : ''}$${abs.toFixed(1)}B`;
}

/** Colour ramp for a 0-100 stat where high is good. */
export function statColour(value, invert = false) {
  const v = invert ? 100 - value : value;
  if (v >= 75) return 'var(--good)';
  if (v >= 55) return 'var(--ok)';
  if (v >= 35) return 'var(--warn)';
  return 'var(--bad)';
}

export function relationLabel(value) {
  if (value >= 70) return t('relation.allied', 'Allied');
  if (value >= 40) return t('relation.friendly', 'Friendly');
  if (value >= 15) return t('relation.cordial', 'Cordial');
  if (value > -15) return t('relation.neutral', 'Neutral');
  if (value > -40) return t('relation.cool', 'Cool');
  if (value > -70) return t('relation.hostile', 'Hostile');
  return t('relation.enemy', 'Enemy');
}

export function relationColour(value) {
  if (value >= 40) return 'var(--good)';
  if (value >= 15) return 'var(--ok)';
  if (value > -15) return 'var(--muted)';
  if (value > -45) return 'var(--warn)';
  return 'var(--bad)';
}

/** Simple debounce for text inputs. */
export function debounce(fn, ms = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
