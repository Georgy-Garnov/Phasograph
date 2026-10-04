import type { ReactNode } from 'react';
import type { Draft } from 'immer';
import { store, useStore } from '../model/store';
import { cachedDistances } from '../topology/distances';
import { formatLength, nodeName } from '../i18n/labels';
import { useT, type MessageKey } from '../i18n';
import type { Role, Scheme, SchemeNode } from '../model/types';
import { COLOR_BUNDLE, COLOR_CONFLICT, ROLE_COLORS } from '../model/constants';
import type { ConductorTrace } from '../topology/trace';

export function editScheme(recipe: (d: Draft<Scheme>) => void, coalesce?: string) {
  store.edit(recipe, { coalesce });
}

/** Update a node of the given type; edits to the same field are merged into a single undo step. */
export function editNode<K extends SchemeNode['kind']>(
  id: string,
  kind: K | K[],
  fn: (n: Extract<SchemeNode, { kind: K }>) => void,
  coalesce?: string,
) {
  const kinds = Array.isArray(kind) ? kind : [kind];
  editScheme((d) => {
    const n = d.nodes[id];
    if (n && kinds.includes(n.kind as K)) fn(n as Extract<SchemeNode, { kind: K }>);
  }, coalesce && `${id}:${coalesce}`);
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h3>{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function RoleChip({ role, title }: { role: Role | 'bundle' | 'conflict' | null; title?: string }) {
  const t = useT();
  if (!role) return <span className="chip chip-none" title={title ?? t('chip.untraced')}>?</span>;
  const color = role === 'bundle' ? COLOR_BUNDLE : role === 'conflict' ? COLOR_CONFLICT : ROLE_COLORS[role];
  const text = role === 'bundle' ? t('chip.sip') : role === 'conflict' ? t('chip.short') : role === 'P' ? t('chip.phaseUnknown') : role;
  return (
    <span className="chip" style={{ background: color, color: role === 'A' ? '#222' : '#fff' }} title={title}>
      {text}
    </span>
  );
}

const MARKS: Role[] = ['A', 'B', 'C', 'N', 'L', 'P'];

/** Manual wire marking on an insulator: the operator knows which wire this is. */
export function MarkSelect({ value, onChange }: { value: Role | null | undefined; onChange: (v: Role | null) => void }) {
  const t = useT();
  return (
    <select
      value={value ?? ''}
      title={t('mark.title')}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange((e.target.value || null) as Role | null)}
    >
      <option value="">—</option>
      {MARKS.map((m) => (
        <option key={m} value={m}>
          {t(`mark.${m}` as MessageKey)}
        </option>
      ))}
    </select>
  );
}

export function TraceChip({ trace }: { trace: ConductorTrace | undefined }) {
  const t = useT();
  if (!trace) return <RoleChip role={null} />;
  if (trace.conflict) return <RoleChip role="conflict" title={t('chip.conflictTitle', { roles: trace.roles.join(', ') })} />;
  if (trace.roles.length === 1) return <RoleChip role={trace.roles[0]} />;
  if (trace.bundledRoles.length) return <RoleChip role="bundle" title={t('chip.bundleTitle')} />;
  return <RoleChip role={null} />;
}

export { nodeName };

/** "Distance to TS along the network: 412 m (TS "T-15")" for a node. */
export function KtpDistanceInfo({ nodeId }: { nodeId: string }) {
  const t = useT();
  const scheme = useStore((s) => s.scheme);
  const d = cachedDistances(scheme).get(nodeId);
  if (!d) return <span className="muted">{t('dist.noKtp')}</span>;
  const ktp = scheme.nodes[d.ktpId];
  return (
    <span>
      {t('dist.toKtp')}: <b>{formatLength(d.meters)}</b>
      {ktp?.name ? ` (${t('node.ktp')} «${ktp.name}»)` : ''}
    </span>
  );
}

export function NodeLink({ node }: { node: SchemeNode | undefined }) {
  useT();
  if (!node) return <span>—</span>;
  return (
    <button className="link" onClick={() => store.set({ selection: { type: 'node', id: node.id }, focusKey: null })}>
      {nodeName(node)}
    </button>
  );
}
