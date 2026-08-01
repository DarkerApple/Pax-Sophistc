// Seeded, serialisable RNG. Every random draw in the simulation goes through
// here so that a (seed, action-list) pair always replays to the same world.

const MASK = 0xffffffff;

export function hashSeed(input) {
  const str = String(input ?? '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

export class Rng {
  constructor(seed = 1) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    if (this.state === 0) this.state = 1;
  }

  /** Restore from a serialised state integer. */
  static fromState(state) {
    const rng = new Rng(1);
    rng.state = (state >>> 0) || 1;
    return rng;
  }

  /** mulberry32 — small, fast, good enough for a strategy game. */
  next() {
    this.state = (this.state + 0x6d2b79f5) & MASK;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min, max) {
    return min + this.next() * (max - min);
  }

  int(min, max) {
    return Math.floor(this.float(min, max + 1));
  }

  bool(probability = 0.5) {
    return this.next() < probability;
  }

  pick(list) {
    if (!list.length) return undefined;
    return list[Math.floor(this.next() * list.length)];
  }

  /** Weighted pick. `weightOf` must return a non-negative number. */
  weighted(list, weightOf) {
    const weights = list.map((item) => Math.max(0, weightOf(item) || 0));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return this.pick(list);
    let roll = this.next() * total;
    for (let i = 0; i < list.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Approximately normal via the mean of four uniforms. */
  normal(mean = 0, spread = 1) {
    const sum = this.next() + this.next() + this.next() + this.next();
    return mean + (sum / 2 - 1) * spread * 1.6;
  }
}
