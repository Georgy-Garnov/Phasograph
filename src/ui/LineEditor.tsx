import { useEffect, useState } from 'react';
import { store, useStore } from '../model/store';
import type { PoleNode, SchemeLine, SchemeNode, Suspension } from '../model/types';
import { addWire, assignFeeder, houseOf, isPole, isWired, mapWiresByPosition, routeLines } from '../model/scheme';
import { formatLength, lineKindLabel, portOptions } from '../i18n/labels';
import { t as tr, useT, type MessageKey } from '../i18n';
import { CONDUCTORS, CONDUCTOR_GROUPS, conductorsOf, defaultConductorId } from '../model/conductors';
import { portKey, wireKey } from '../topology/trace';
import { PoleDiagram } from './PoleDiagram';
import { confirmDialog } from './dialog';
import { portMark, setPortMark } from '../model/sip';
import { HouseForm } from './HouseForm';
import { Field, MarkSelect, NodeLink, Section, TraceChip, editScheme } from './common';
import { cachedDistances, lineLength } from '../topology/distances';

function editLine(id: string, fn: (l: SchemeLine) => void, coalesce?: string) {
  editScheme((d) => {
    const l = d.lines[id];
    if (l) fn(l);
  }, coalesce && `${id}:${coalesce}`);
}

function PortSelect({ node, value, onChange }: { node: SchemeNode | undefined; value: string | null; onChange: (v: string | null) => void }) {
  const t = useT();
  if (!node || node.kind === 'entry' || node.kind === 'house') return <span className="muted">{t('line.endEntry')}</span>;
  const ports = portOptions(node);
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={value ? '' : 'warn'}>
      <option value="">{t('line.portNone')}</option>
      {ports.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

function LineStats({ line }: { line: SchemeLine }) {
  const t = useT();
  const scheme = useStore((s) => s.scheme);
  const dist = cachedDistances(scheme);
  const ends = [dist.get(line.from), dist.get(line.to)].filter((d): d is NonNullable<typeof d> => !!d);
  const near = ends.length ? Math.min(...ends.map((d) => d.meters)) : null;
  const far = ends.length ? Math.max(...ends.map((d) => d.meters)) : null;
  return (
    <div className="stats">
      <span>
        {line.kind === 'drop' ? t('line.dropLength') : t('line.spanLength')}: <b>{formatLength(lineLength(scheme, line))}</b>
      </span>
      {near !== null && far !== null ? (
        <span>
          {t('dist.toKtp')}: <b>{formatLength(near)}</b>
          {far - near > 0.5 && ` – ${formatLength(far)}`}
        </span>
      ) : (
        line.kind !== 'line10' && line.kind !== 'fiber' && <span className="muted">{t('line.noKtp')}</span>
      )}
    </div>
  );
}

/** Span wire marking is stored on the pole insulator or ABC core (at the span start, or at the end if the start is a TS). */
function WireMark({ line, wireIndex }: { line: SchemeLine; wireIndex: number }) {
  const t = useT();
  const scheme = useStore((s) => s.scheme);
  const w = line.wires[wireIndex];
  const end = [
    { node: scheme.nodes[line.from], port: w.fromPort },
    { node: scheme.nodes[line.to], port: w.toPort },
  ].find(({ node, port }) => isPole(node) && port);
  if (!end) return <span className="muted small">{t('line.noInsulator')}</span>;
  const pole = end.node as PoleNode;
  return (
    <MarkSelect
      value={portMark(pole, end.port!)}
      onChange={(mark) =>
        editScheme((d) => {
          const p = d.nodes[pole.id];
          if (isPole(p)) setPortMark(p, end.port!, mark);
        })
      }
    />
  );
}

/** Copies the span's conductor (and its mark, if filled) to every span of the same route. */
function ApplyToRoute({ line }: { line: SchemeLine }) {
  const t = useT();
  const scheme = useStore((s) => s.scheme);
  const trace = useStore((s) => s.trace);
  if (line.kind !== 'line04') return null;
  const feedersOf = (l: SchemeLine) => [...new Set(l.wires.flatMap((w) => trace.wires.get(wireKey(l.id, w.id))?.feeders ?? []))];
  const ids = routeLines(scheme, line.id, feedersOf);
  if (ids.length < 2) return null;
  const name = CONDUCTORS[line.conductor ?? defaultConductorId(line)].label;
  return (
    <button
      className="link small"
      onClick={async () => {
        const msg = line.mark.trim()
          ? t('line.applyRouteConfirmMark', { name, mark: line.mark.trim(), n: ids.length })
          : t('line.applyRouteConfirm', { name, n: ids.length });
        if (!(await confirmDialog(msg, { title: t('line.applyRouteTitle'), okLabel: t('dialog.apply') }))) return;
        editScheme((d) => {
          for (const id of ids) {
            const l = d.lines[id];
            if (!l) continue;
            l.conductor = line.conductor;
            if (line.mark.trim()) l.mark = line.mark;
          }
        });
        store.set({ hint: t('line.applyRouteDone', { n: ids.length }) });
      }}
    >
      {t('line.applyRoute', { n: ids.length })}
    </button>
  );
}

/** Service drop wire labels. */
function dropWireLabel(line: SchemeLine, i: number): string {
  if (line.wires.length === 2) return i === 0 ? tr('drop.wire.phase') : tr('drop.wire.neutral');
  if (line.wires.length === 4) return ['L1', 'L2', 'L3', 'N'][i];
  return tr('drop.wire.n', { n: i + 1 });
}

export function LineEditor({ line }: { line: SchemeLine }) {
  const t = useT();
  const scheme = useStore((s) => s.scheme);
  const trace = useStore((s) => s.trace);
  const focusKey = useStore((s) => s.focusKey);
  const from = scheme.nodes[line.from];
  const to = scheme.nodes[line.to];
  const [activeWire, setActiveWire] = useState(0);
  useEffect(() => setActiveWire(0), [line.id]);

  const wired = isWired(line.kind);
  const isDrop = line.kind === 'drop';
  const house = isDrop ? houseOf(scheme, line.to) : null;

  const focusWire = (fromPort: string | null, toPort: string | null) => {
    const key = fromPort ? portKey(line.from, fromPort) : toPort ? portKey(line.to, toPort) : null;
    store.set({ focusKey: key === focusKey ? null : key });
  };

  return (
    <>
      <Section title={lineKindLabel(line.kind)}>
        <p>
          <NodeLink node={from} /> → <NodeLink node={to} />
        </p>
        <LineStats line={line} />
        <div className="grid2">
          {(line.kind === 'line04' || line.kind === 'lighting' || isDrop) && (
            <Field label={t('line.suspension')}>
              <select
                value={line.suspension}
                onChange={(e) => editLine(line.id, (l) => void (l.suspension = e.target.value as Suspension))}
              >
                <option value="bare">{t('line.suspension.bare')}</option>
                <option value="sip">{t('line.suspension.sip')}</option>
              </select>
            </Field>
          )}
          <Field label={t('line.mark')}>
            <input
              value={line.mark}
              placeholder={line.suspension === 'sip' ? t('line.markPlaceholderSip') : t('line.markPlaceholderBare')}
              onChange={(e) => editLine(line.id, (l) => void (l.mark = e.target.value), 'mark')}
            />
          </Field>
          {(line.kind === 'line04' || isDrop) && (
            <Field label={t('line.conductor')}>
              <select
                value={line.conductor ?? ''}
                title={t('line.conductorTitle')}
                onChange={(e) => editLine(line.id, (l) => void (l.conductor = e.target.value || null))}
              >
                <option value="">{t('line.conductorDefault', { name: CONDUCTORS[defaultConductorId(line)].label })}</option>
                {CONDUCTOR_GROUPS.map((g) => (
                  <optgroup key={g} label={t(`conductor.group.${g}` as MessageKey)}>
                    {conductorsOf(g).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} · {c.r} {t('unit.ohmPerKm')}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ApplyToRoute line={line} />
            </Field>
          )}
        </div>
      </Section>

      {isDrop && isPole(from) && (
        <Section title={t('drop.onPole')}>
          <p className="muted">
            {t('drop.help')}
          </p>
          <PoleDiagram
            pole={from}
            trace={trace}
            selected={line.wires.map((w) => w.fromPort).filter((p): p is string => !!p)}
            tags={Object.fromEntries(
              line.wires.filter((w) => w.fromPort).map((w) => [w.fromPort!, dropWireLabel(line, line.wires.indexOf(w))]),
            )}
            onClick={(insId) => {
              editLine(line.id, (l) => {
                const w = l.wires[activeWire];
                if (w) w.fromPort = insId;
              });
              setActiveWire((i) => (i + 1) % Math.max(1, line.wires.length));
            }}
          />
        </Section>
      )}

      {wired && (
        <Section
          title={isDrop ? t('drop.wires') : t('line.wires')}
          actions={
            <div className="btn-row">
              <button onClick={() => editLine(line.id, (l) => void addWire(l))}>{t('line.addWire')}</button>
              {isPole(from) && isPole(to) && !isDrop && (
                <button
                  title={t('line.byPositionTitle')}
                  onClick={() => editScheme((d) => mapWiresByPosition(d, d.lines[line.id]))}
                >
                  {t('line.byPosition')}
                </button>
              )}
            </div>
          }
        >
          {from?.kind === 'ktp' && (
            <Field label={t('line.feederOnSpan')}>
              <select
                value=""
                onChange={(e) => e.target.value && editScheme((d) => assignFeeder(d, d.lines[line.id], e.target.value))}
              >
                <option value="">{t('line.assignFeeder')}</option>
                {from.feeders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('line.col.start')}</th>
                <th>{t('line.col.end')}</th>
                <th title={t('line.col.markTitle')}>{t('pole.col.mark')}</th>
                <th>{t('pole.col.phase')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {line.wires.map((w, i) => {
                const key = w.fromPort ? portKey(line.from, w.fromPort) : null;
                return (
                  <tr
                    key={w.id}
                    className={(isDrop ? activeWire === i : key !== null && key === focusKey) ? 'active' : ''}
                    onClick={() => (isDrop ? setActiveWire(i) : focusWire(w.fromPort, w.toPort))}
                  >
                    <td>{isDrop ? dropWireLabel(line, i) : i + 1}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <PortSelect
                        node={from}
                        value={w.fromPort}
                        onChange={(v) => editLine(line.id, (l) => void (l.wires[i].fromPort = v))}
                      />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <PortSelect
                        node={to}
                        value={w.toPort}
                        onChange={(v) => editLine(line.id, (l) => void (l.wires[i].toPort = v))}
                      />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <WireMark line={line} wireIndex={i} />
                    </td>
                    <td>
                      <TraceChip trace={trace.wires.get(wireKey(line.id, w.id))} />
                    </td>
                    <td>
                      <button
                        className="icon danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          editLine(line.id, (l) => void (l.wires = l.wires.filter((x) => x.id !== w.id)));
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!isDrop && (
            <p className="muted small">
              {t('line.help')}
            </p>
          )}
        </Section>
      )}

      {house && <HouseForm house={house} compact />}

      <Section title={t('common.note')}>
        <textarea rows={2} value={line.note} onChange={(e) => editLine(line.id, (l) => void (l.note = e.target.value), 'note')} />
      </Section>
    </>
  );
}
