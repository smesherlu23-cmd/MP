// Прогоны и прогноз — в фоновых потоках на всех ядрах, кроме одного (оно — окну).
// Прогоны раздаются порциями; итоги собираются по номерам, так что результат не зависит
// от числа потоков и совпадает с расчётом в окне. Нет потоков — считается в окне, как раньше.

import {
  aggregate,
  clone,
  forecastAsync,
  normalizeRuleset,
  runManyAsync,
  type Battle,
  type MonteCarloResult,
  type Ruleset,
  type RunMeta,
  type RunSummary,
  type Scenario,
} from '../engine';

export type McJob = { kind: 'scenario'; scenario: Scenario; ruleset: Ruleset } | { kind: 'forecast'; battle: Battle };
export interface McRequest {
  job?: McJob;
  baseSeed: string;
  from: number;
  to: number;
}
export type McResponse = { runs: RunSummary[]; meta?: RunMeta; error?: undefined } | { error: string };

type Progress = (done: number, n: number) => void;

/** Потоков для расчёта: ядра минус одно, не больше 8; 0 — считать в окне. */
export function workerCount(): number {
  if (typeof Worker === 'undefined') return 0;
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  return Math.max(1, Math.min(8, cores - 1));
}

class Unavailable extends Error {}

/** null — потоки недоступны (считать в окне). Остановка — возвращает уже готовые прогоны. */
function runInWorkers(
  job: McJob,
  n: number,
  baseSeed: string,
  onProgress?: Progress,
  isCancelled?: () => boolean,
): Promise<{ runs: RunSummary[]; meta?: RunMeta }> {
  const count = Math.min(workerCount(), n);
  if (count < 1) return Promise.reject(new Unavailable());
  // Порции: помельче, чтобы потоки заканчивали вместе и прогресс шёл ровно.
  const chunk = Math.max(1, Math.min(50, Math.ceil(n / (count * 6))));
  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    const runs: RunSummary[] = [];
    let meta: RunMeta | undefined;
    let next = 0;
    let busy = 0;
    let finished = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const end = (err?: Error) => {
      if (finished) return;
      finished = true;
      if (timer) clearInterval(timer);
      for (const w of workers) w.terminate();
      if (err) reject(err);
      else {
        runs.sort((a, b) => a.index - b.index);
        resolve({ runs, meta });
      }
    };
    const feed = (w: Worker, first: boolean) => {
      if (isCancelled?.() || next >= n) {
        if (!busy) end();
        return;
      }
      const from = next;
      next = Math.min(n, next + chunk);
      busy++;
      w.postMessage({ job: first ? job : undefined, baseSeed, from, to: next } satisfies McRequest);
    };
    try {
      for (let k = 0; k < count; k++) {
        const w = new Worker(new URL('./mc.worker.ts', import.meta.url), { type: 'module' });
        workers.push(w);
        w.onmessage = (e: MessageEvent<McResponse>) => {
          busy--;
          const m = e.data;
          if (m.error !== undefined) return end(new Error(m.error));
          runs.push(...m.runs);
          meta ??= m.meta;
          onProgress?.(runs.length, n);
          feed(w, false);
        };
        // Поток не загрузился (или упал не на прогоне) — посчитать в окне.
        w.onerror = (e) => {
          e.preventDefault();
          end(runs.length ? new Error(e.message || 'Ошибка фонового расчёта') : new Unavailable());
        };
      }
    } catch {
      return end(new Unavailable());
    }
    for (const w of workers) feed(w, true);
    // Остановка: потоки прерываются сразу, не дожидаясь конца порции.
    if (isCancelled) timer = setInterval(() => isCancelled() && end(), 100);
  });
}

/** Прогоны сценария (как runManyAsync, но в фоне на всех ядрах). */
export async function runScenario(
  scenario: Scenario,
  rulesetIn: Ruleset,
  n: number,
  baseSeed: string,
  onProgress?: Progress,
  isCancelled?: () => boolean,
): Promise<MonteCarloResult> {
  const t0 = Date.now();
  const ruleset = normalizeRuleset(clone(rulesetIn));
  try {
    const r = await runInWorkers({ kind: 'scenario', scenario, ruleset }, n, baseSeed, onProgress, isCancelled);
    return aggregate(r.runs, ruleset, { A: scenario.sides[0].name, B: scenario.sides[1].name }, baseSeed, Date.now() - t0, r.meta);
  } catch (e) {
    if (!(e instanceof Unavailable)) throw e;
    return runManyAsync(scenario, rulesetIn, n, baseSeed, onProgress, isCancelled);
  }
}

/** Прогноз боя с текущего хода (как forecastAsync, но в фоне на всех ядрах). */
export async function runForecast(b: Battle, n: number, baseSeed: string, onProgress?: Progress, isCancelled?: () => boolean): Promise<MonteCarloResult> {
  const t0 = Date.now();
  try {
    const r = await runInWorkers({ kind: 'forecast', battle: b }, n, baseSeed, onProgress, isCancelled);
    return aggregate(r.runs, b.ruleset, { A: b.sides.A.name, B: b.sides.B.name }, baseSeed, Date.now() - t0);
  } catch (e) {
    if (!(e instanceof Unavailable)) throw e;
    return forecastAsync(b, n, baseSeed, onProgress, isCancelled);
  }
}
