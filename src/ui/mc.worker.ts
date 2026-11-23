// Фоновый расчёт прогонов: окно не замирает, прогоны идут на нескольких ядрах.
// Получает порцию номеров прогонов, возвращает их итоги; случайности зависят только от номера,
// поэтому результат тот же, что при расчёте в окне.

import { forecastRun, runOne, runSeed, type RunMeta, type RunSummary } from '../engine';
import type { McJob, McRequest, McResponse } from './parallel';

let job: McJob | undefined;

const one = (i: number, baseSeed: string, meta: { value?: RunMeta }): RunSummary =>
  job!.kind === 'scenario' ? runOne(job!.scenario, job!.ruleset, runSeed(baseSeed, i), i, meta) : forecastRun(job!.battle, baseSeed, i);

self.onmessage = (e: MessageEvent<McRequest>) => {
  const m = e.data;
  if (m.job) job = m.job;
  try {
    const meta: { value?: RunMeta } = {};
    const runs: RunSummary[] = [];
    for (let i = m.from; i < m.to; i++) runs.push(one(i, m.baseSeed, meta));
    self.postMessage({ runs, meta: meta.value } satisfies McResponse);
  } catch (err) {
    self.postMessage({ error: (err as Error).message ?? String(err) } satisfies McResponse);
  }
};
