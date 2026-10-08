/**
 * Conductor catalog for voltage-drop calculation: approximate active resistance r and inductive reactance x
 * per km at 20 °C (typical 0.4 kV overhead values). rN — neutral core resistance where it differs (ABC).
 */
import type { SchemeLine } from './types';

export type ConductorGroup = 'bareAl' | 'bareAs' | 'bareCu' | 'sipMain' | 'sipDrop' | 'cable';

export interface Conductor {
  id: string;
  label: string;
  group: ConductorGroup;
  /** Ohm/km, phase conductor. */
  r: number;
  /** Ohm/km. */
  x: number;
  /** Ohm/km, neutral conductor; defaults to r. */
  rN?: number;
}

const list: Conductor[] = [
  // Bare aluminium on insulators (wide spacing → higher reactance).
  { id: 'A-16', label: 'А-16', group: 'bareAl', r: 1.8, x: 0.33 },
  { id: 'A-25', label: 'А-25', group: 'bareAl', r: 1.14, x: 0.32 },
  { id: 'A-35', label: 'А-35', group: 'bareAl', r: 0.83, x: 0.31 },
  { id: 'A-50', label: 'А-50', group: 'bareAl', r: 0.58, x: 0.3 },
  { id: 'A-70', label: 'А-70', group: 'bareAl', r: 0.42, x: 0.29 },
  { id: 'A-95', label: 'А-95', group: 'bareAl', r: 0.31, x: 0.28 },
  // Steel-reinforced aluminium.
  { id: 'AS-25', label: 'АС-25/4,2', group: 'bareAs', r: 1.15, x: 0.32 },
  { id: 'AS-35', label: 'АС-35/6,2', group: 'bareAs', r: 0.77, x: 0.31 },
  { id: 'AS-50', label: 'АС-50/8', group: 'bareAs', r: 0.59, x: 0.3 },
  { id: 'AS-70', label: 'АС-70/11', group: 'bareAs', r: 0.42, x: 0.29 },
  // Bare copper.
  { id: 'M-16', label: 'М-16', group: 'bareCu', r: 1.15, x: 0.33 },
  { id: 'M-25', label: 'М-25', group: 'bareCu', r: 0.74, x: 0.32 },
  { id: 'M-35', label: 'М-35', group: 'bareCu', r: 0.52, x: 0.31 },
  // ABC main lines (SIP-2: insulated phases + bare neutral messenger).
  { id: 'SIP2-3x16+25', label: 'СИП-2 3×16+1×25', group: 'sipMain', r: 1.91, x: 0.09, rN: 1.38 },
  { id: 'SIP2-3x25+35', label: 'СИП-2 3×25+1×35', group: 'sipMain', r: 1.2, x: 0.09, rN: 0.986 },
  { id: 'SIP2-3x35+54.6', label: 'СИП-2 3×35+1×54,6', group: 'sipMain', r: 0.868, x: 0.08, rN: 0.72 },
  { id: 'SIP2-3x50+54.6', label: 'СИП-2 3×50+1×54,6', group: 'sipMain', r: 0.641, x: 0.08, rN: 0.72 },
  { id: 'SIP2-3x70+54.6', label: 'СИП-2 3×70+1×54,6', group: 'sipMain', r: 0.443, x: 0.08, rN: 0.72 },
  { id: 'SIP2-3x95+70', label: 'СИП-2 3×95+1×70', group: 'sipMain', r: 0.32, x: 0.08, rN: 0.493 },
  { id: 'SIP2-3x120+95', label: 'СИП-2 3×120+1×95', group: 'sipMain', r: 0.253, x: 0.08, rN: 0.363 },
  // ABC service drops (SIP-4: all cores insulated and equal).
  { id: 'SIP4-2x16', label: 'СИП-4 2×16', group: 'sipDrop', r: 1.91, x: 0.09 },
  { id: 'SIP4-4x16', label: 'СИП-4 4×16', group: 'sipDrop', r: 1.91, x: 0.09 },
  { id: 'SIP4-2x25', label: 'СИП-4 2×25', group: 'sipDrop', r: 1.2, x: 0.09 },
  { id: 'SIP4-4x25', label: 'СИП-4 4×25', group: 'sipDrop', r: 1.2, x: 0.09 },
  // Armoured cables in the ground (underground drops): close cores → low reactance.
  { id: 'AVBbShv-2x16', label: 'АВБбШв 2×16', group: 'cable', r: 1.94, x: 0.068 },
  { id: 'AVBbShv-4x16', label: 'АВБбШв 4×16', group: 'cable', r: 1.94, x: 0.068 },
  { id: 'AVBbShv-4x25', label: 'АВБбШв 4×25', group: 'cable', r: 1.24, x: 0.066 },
  { id: 'AVBbShv-4x35', label: 'АВБбШв 4×35', group: 'cable', r: 0.89, x: 0.064 },
  { id: 'VBbShv-4x10', label: 'ВБбШв 4×10', group: 'cable', r: 1.84, x: 0.073 },
  { id: 'VBbShv-4x16', label: 'ВБбШв 4×16', group: 'cable', r: 1.15, x: 0.068 },
];

export const CONDUCTORS: Record<string, Conductor> = Object.fromEntries(list.map((c) => [c.id, c]));
export const CONDUCTOR_GROUPS: ConductorGroup[] = ['bareAl', 'bareAs', 'bareCu', 'sipMain', 'sipDrop', 'cable'];
export const conductorsOf = (group: ConductorGroup) => list.filter((c) => c.group === group);

type ConductorLine = Pick<SchemeLine, 'kind' | 'suspension'> & Partial<Pick<SchemeLine, 'underground' | 'wires'>>;

/**
 * Default conductor for a line when none is chosen: A-35 bare main line, SIP-2 3×50 ABC, SIP-4 2×16 overhead drop,
 * an armoured aluminium cable 2×16 / 4×16 for an underground drop.
 */
export function defaultConductorId(line: ConductorLine): string {
  if (line.kind === 'drop' && line.underground) return (line.wires?.length ?? 2) >= 4 ? 'AVBbShv-4x16' : 'AVBbShv-2x16';
  if (line.kind === 'drop') return 'SIP4-2x16';
  return line.suspension === 'sip' ? 'SIP2-3x50+54.6' : 'A-35';
}

export function conductorOf(line: ConductorLine & Pick<SchemeLine, 'conductor'>): Conductor {
  return CONDUCTORS[line.conductor ?? ''] ?? CONDUCTORS[defaultConductorId(line)];
}
