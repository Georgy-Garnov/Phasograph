/** Scheme object labels in the current language: node, insulator and port names, validation message text. */
import type { Insulator, LineKind, NodeKind, Scheme, SchemeNode, Side } from '../model/types';
import { insulatorLabel, isPole, sortInsulators } from '../model/scheme';
import type { Issue } from '../topology/trace';
import { currentLocale, t, type MessageKey } from './index';

export const nodeKindLabel = (kind: NodeKind): string => t(`node.${kind}` as MessageKey);
export const lineKindLabel = (kind: LineKind): string => t(`line.${kind}` as MessageKey);

function sideLetters(): Record<Side, string> {
  return { L: t('side.letter.L'), C: t('side.letter.C'), B: t('side.letter.B'), R: t('side.letter.R') };
}

/** Side letter + position, e.g. "L3"; ABC clamps get a localized "ABC" prefix. */
export function insLabel(ins: Insulator): string {
  const base = insulatorLabel(ins, sideLetters());
  return ins.type === 'sipClamp' ? `${t('ins.sipShort')} ${base}` : base;
}

/** Node name: house address, "Pole 0.4 kV #12", "TS "T-15"". */
export function nodeName(node: SchemeNode | undefined): string {
  if (!node) return '—';
  if (node.kind === 'house') return node.address || node.name || t('house.noAddress');
  const label = nodeKindLabel(node.kind);
  if (isPole(node) && node.number) return t('node.withNumber', { label, n: node.number });
  return node.name ? `${label} «${node.name}»` : label;
}

export interface PortOption {
  id: string;
  label: string;
}

/** Node ports for choosing a wire end: pole insulators or substation feeder outputs. */
export function portOptions(node: SchemeNode | undefined): PortOption[] {
  if (!node) return [];
  if (node.kind === 'ktp') {
    return node.feeders.flatMap((f) =>
      f.outputs.map((o) => ({ id: o.id, label: t('port.ktpOutput', { feeder: f.name, n: o.index, role: o.role }) })),
    );
  }
  if (isPole(node)) return sortInsulators(node.insulators).map((i) => ({ id: i.id, label: insLabel(i) }));
  return [];
}

/** Validation message text in the current language. */
export function formatIssue(issue: Issue, scheme: Scheme): string {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(issue.params)) {
    if (k === 'node' || k === 'from' || k === 'to') params[k] = nodeName(scheme.nodes[String(v)]);
    else if (k === 'lineKind') params[k] = lineKindLabel(v as LineKind);
    else if (k === 'ins') {
      const node = scheme.nodes[String(issue.params.node)];
      const ins = isPole(node) ? node.insulators.find((i) => i.id === v) : undefined;
      params[k] = ins ? insLabel(ins) : '?';
    } else params[k] = v;
  }
  return t(issue.key, params);
}

/** Localized length, e.g. "37 m" / "1.24 km" (unit names and decimal separator follow the UI language). */
export function formatLength(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toLocaleString(currentLocale(), { maximumFractionDigits: 2 })} ${t('unit.km')}`;
  }
  return `${Math.round(meters)} ${t('unit.m')}`;
}
