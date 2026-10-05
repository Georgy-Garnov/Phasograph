/**
 * ABC (SIP) cable cores. A clamp with a known core set exposes every core as its own port `${insulatorId}:${k}`,
 * so span wires, service drops, luminaires and jumpers attach to a specific core and tracing keeps the phase.
 *
 * Core marking follows GOST 31946: phase cores are numbered 1, 2, 3 (or carry 1, 2, 3 longitudinal ribs),
 * the neutral messenger is 0, the street lighting core is 4.
 */
import type { Insulator, PoleNode, Role, SipCores } from './types';

export type CoreMarking = '1' | '2' | '3' | '0' | '4';

export const SIP_CORE_TYPES: SipCores[] = ['1+N', '3+N', '3+N+L'];

const MARKINGS: Record<SipCores, CoreMarking[]> = {
  '1+N': ['1', '0'],
  '3+N': ['1', '2', '3', '0'],
  '3+N+L': ['1', '2', '3', '0', '4'],
};

/** Conventional role of a core when a cable is laid out automatically (tracing decides the real one). */
export const MARKING_ROLE: Record<CoreMarking, Role> = { '1': 'A', '2': 'B', '3': 'C', '0': 'N', '4': 'L' };

/** Number of longitudinal ribs on a phase core (0 for the neutral and lighting cores). */
export const markingRibs = (m: CoreMarking): number => (m === '1' || m === '2' || m === '3' ? Number(m) : 0);

/** Core markings of a clamp in port order; empty for pin insulators and legacy clamps. */
export function coreMarkings(ins: Insulator): CoreMarking[] {
  return ins.type === 'sipClamp' && ins.cores ? MARKINGS[ins.cores] : [];
}

export const coreMarkingsOf = (cores: SipCores): CoreMarking[] => MARKINGS[cores];

export const corePort = (insId: string, k: number): string => `${insId}:${k}`;

/** Splits a pole port id into the insulator id and the core index (null for a whole insulator). */
export function splitPort(portId: string): { insId: string; core: number | null } {
  const i = portId.lastIndexOf(':');
  if (i < 0) return { insId: portId, core: null };
  const core = Number(portId.slice(i + 1));
  return Number.isInteger(core) ? { insId: portId.slice(0, i), core } : { insId: portId, core: null };
}

/** Ports of one insulator: its cores, or the insulator itself. */
export function insulatorPorts(ins: Insulator): string[] {
  const m = coreMarkings(ins);
  return m.length ? m.map((_, k) => corePort(ins.id, k)) : [ins.id];
}

/** All connection points of a pole in insulator order. */
export function polePorts(pole: PoleNode, insulators: Insulator[] = pole.insulators): string[] {
  return insulators.flatMap(insulatorPorts);
}

export function portInsulator(pole: PoleNode, portId: string): Insulator | undefined {
  return pole.insulators.find((i) => i.id === splitPort(portId).insId);
}

export function hasPolePort(pole: PoleNode, portId: string): boolean {
  const { core } = splitPort(portId);
  const ins = portInsulator(pole, portId);
  if (!ins) return false;
  const n = coreMarkings(ins).length;
  return core === null ? n === 0 : core < n;
}

/** Marking of the core behind a port, or null for a whole insulator. */
export function portMarking(pole: PoleNode, portId: string): CoreMarking | null {
  const { core } = splitPort(portId);
  const ins = portInsulator(pole, portId);
  return ins && core !== null ? (coreMarkings(ins)[core] ?? null) : null;
}

/** Core of a clamp with the given marking. */
export function coreWithMarking(ins: Insulator, marking: CoreMarking): string | null {
  const k = coreMarkings(ins).indexOf(marking);
  return k < 0 ? null : corePort(ins.id, k);
}

/**
 * Core of a clamp for a conductor role: A/B/C → 1/2/3 (a single-phase cable takes any phase on core 1),
 * N → 0, L → 4.
 */
export function coreForRole(ins: Insulator, role: Role | null): string | null {
  if (!role) return null;
  const markings = coreMarkings(ins);
  const phases = markings.filter((m) => MARKING_ROLE[m] !== 'N' && MARKING_ROLE[m] !== 'L');
  if ((role === 'A' || role === 'B' || role === 'C' || role === 'P') && phases.length === 1) return coreWithMarking(ins, phases[0]);
  const m = markings.find((x) => MARKING_ROLE[x] === role);
  return m ? coreWithMarking(ins, m) : null;
}

/** Manual marking of a port (insulator mark or core mark). */
export function portMark(pole: PoleNode, portId: string): Role | null {
  const { core } = splitPort(portId);
  const ins = portInsulator(pole, portId);
  if (!ins) return null;
  return (core === null ? ins.mark : ins.coreMarks?.[core]) ?? null;
}

export function setPortMark(pole: PoleNode, portId: string, mark: Role | null): void {
  const { core } = splitPort(portId);
  const ins = portInsulator(pole, portId);
  if (!ins) return;
  if (core === null) {
    ins.mark = mark;
    return;
  }
  const marks = [...(ins.coreMarks ?? [])];
  while (marks.length < coreMarkings(ins).length) marks.push(null);
  marks[core] = mark;
  ins.coreMarks = marks;
}

/** Core set by the number of conductors it has to carry: 5 → with lighting core, 2 → single phase, else 3+N. */
export function coresForCount(n: number): SipCores {
  return n >= 5 ? '3+N+L' : n === 2 ? '1+N' : '3+N';
}
