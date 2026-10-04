import type { LineKind, Role } from './types';

export const ROLE_COLORS: Record<Role, string> = {
  A: '#f2c200',
  B: '#1f9d3a',
  C: '#d62828',
  N: '#1e5bd8',
  L: '#8e44ad',
  P: '#ff8c00',
};


/** Wire that tracing did not reach. */
export const COLOR_UNTRACED = '#9aa3ad';
/** Wire inside an ABC bundle: feeder is known, phase is not. */
export const COLOR_BUNDLE = '#30343a';
/** Conflict (short circuit: different phases arrived on one wire). */
export const COLOR_CONFLICT = '#ff00c8';



export interface LineStyle {
  color: string;
  width: number;
  dash?: number[];
}

/** Base line style (when wires are not drawn individually). */
export const LINE_STYLES: Record<LineKind, LineStyle> = {
  line10: { color: '#5b2c83', width: 6 },
  line04: { color: '#4a5560', width: 4 },
  drop: { color: '#4a5560', width: 2 },
  lighting: { color: '#8e44ad', width: 2, dash: [6, 4] },
  fiber: { color: '#00a3a3', width: 2, dash: [2, 5] },
};

/** Lines whose individual wires are modeled and which take part in tracing. */
export const WIRED_LINE_KINDS: LineKind[] = ['line04', 'drop', 'lighting'];

export const PHASES = ['A', 'B', 'C'] as const;

