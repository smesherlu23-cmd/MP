// Детерминированный генератор случайных чисел. Состояние (4 × uint32) хранится в бою,
// поэтому сохранённый бой продолжается с того же места, а один и тот же сид даёт тот же исход.

export type RngState = [number, number, number, number];

/** Хеш строки-сида в 128-битное состояние (cyrb128). */
export function seedToState(seed: string): RngState {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class Rng {
  constructor(public state: RngState) {}

  static fromSeed(seed: string): Rng {
    const r = new Rng(seedToState(seed));
    for (let i = 0; i < 12; i++) r.next(); // прогрев
    return r;
  }

  /** sfc32: равномерное число в [0, 1). */
  next(): number {
    let [a, b, c, d] = this.state;
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    this.state = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    return (t >>> 0) / 4294967296;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Нормальное распределение (Бокс — Мюллер). */
  normal(mean = 0, sd = 1): number {
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Биномиальное распределение: сколько из n «единиц» поражены с вероятностью p.
   *  Точно для малых n (2–3 бойца), приближённо для тысяч. */
  binomial(n: number, p: number): number {
    n = Math.max(0, Math.floor(n));
    if (n === 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n <= 40) {
      let k = 0;
      for (let i = 0; i < n; i++) if (this.next() < p) k++;
      return k;
    }
    const mean = n * p;
    if (mean < 12) {
      // Пуассон (Кнут) — хорошее приближение при малом p.
      const L = Math.exp(-mean);
      let k = 0;
      let prod = this.next();
      while (prod > L && k < n) {
        k++;
        prod *= this.next();
      }
      return k;
    }
    const sd = Math.sqrt(mean * (1 - p));
    return Math.max(0, Math.min(n, Math.round(this.normal(mean, sd))));
  }
}

/** Короткий читаемый случайный сид (для кнопки «новый сид»). Не используется внутри движка. */
export function randomSeed(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-';
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}
