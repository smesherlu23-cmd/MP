// Общее для разделов набора правил.

import type { Ruleset } from '../../../engine';

export type Upd = (fn: (r: Ruleset) => void) => void;
