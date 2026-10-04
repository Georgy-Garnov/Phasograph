import { Fragment, useEffect, useState } from 'react';
import { store, useStore } from '../model/store';
import type { PoleKind, PoleNode, Side } from '../model/types';
import {
  addInsulator,
  isPole,
  isZigzag,
  layoutZigzag,
  linesAt,
  removeInsulator,
  sortInsulators,
  uid,
} from '../model/scheme';
import { portKey } from '../topology/trace';
import { PoleDiagram } from './PoleDiagram';
import { LampsSection } from './LampsSection';
import { Field, KtpDistanceInfo, MarkSelect, NodeLink, Section, TraceChip, editNode, editScheme, nodeName } from './common';
import { lineLength } from '../topology/distances';
import { formatLength, insLabel, lineKindLabel, nodeKindLabel } from '../i18n/labels';
import { useT } from '../i18n';

export function PoleEditor({ pole }: { pole: PoleNode }) {
  const t = useT();
  const scheme = useStore((s) => s.scheme);
  const trace = useStore((s) => s.trace);
  const focusKey = useStore((s) => s.focusKey);
  const [jumperA, setJumperA] = useState('');
  const [jumperB, setJumperB] = useState('');
  /** Jumper mode: the first click selects an insulator, the second one connects. */
  const [jumperMode, setJumperMode] = useState(false);
  const [jumperFirst, setJumperFirst] = useState<string | null>(null);
  useEffect(() => {
    setJumperMode(false);
    setJumperFirst(null);
  }, [pole.id]);

  const addJumper = (a: string, b: string) => {
    if (a === b) return;
    const exists = pole.jumpers.some((j) => (j.a === a && j.b === b) || (j.a === b && j.b === a));
    if (!exists) editNode(pole.id, pole.kind, (p) => void p.jumpers.push({ id: uid('j'), a, b }));
  };

  const onDiagramClick = (insId: string) => {
    if (!jumperMode) return focus(insId);
    if (!jumperFirst) return setJumperFirst(insId);
    addJumper(jumperFirst, insId);
    setJumperFirst(null);
  };
  const kinds: PoleKind[] = ['pole04', 'pole10', 'poleService'];
  const lines = linesAt(scheme, pole.id);
  const sorted = sortInsulators(pole.insulators);
  const selectedIns = focusKey?.startsWith(`${pole.id}#`) ? focusKey.slice(pole.id.length + 1) : null;

  const focus = (insId: string) =>
    store.set({ focusKey: selectedIns === insId ? null : portKey(pole.id, insId) });

  /** What is connected to an insulator: spans/service drops to neighboring nodes and jumpers. */
  const connections = (insId: string) => {
    const items: string[] = [];
    for (const l of lines) {
      for (const w of l.wires) {
        const here = l.from === pole.id ? w.fromPort : w.toPort;
        if (here !== insId) continue;
        const other = scheme.nodes[l.from === pole.id ? l.to : l.from];
        items.push(t(l.kind === 'drop' ? 'pole.conn.drop' : 'pole.conn.span', { node: nodeName(other) }));
      }
    }
    for (const j of pole.jumpers) {
      const other = j.a === insId ? j.b : j.b === insId ? j.a : null;
      const ins = other && pole.insulators.find((i) => i.id === other);
      if (ins) items.push(t('pole.conn.jumper', { ins: insLabel(ins) }));
    }
    return items;
  };

  const add = (side: Side, type: 'pin' | 'sipClamp' = 'pin') =>
    editNode(pole.id, pole.kind, (p) => {
      addInsulator(p, side, type);
    });

  return (
    <>
      <Section title={nodeName(pole)}>
        <div className="grid2">
          <Field label={t('pole.type')}>
            <select
              value={pole.kind}
              onChange={(e) => editNode(pole.id, kinds, (p) => void (p.kind = e.target.value as PoleKind))}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {nodeKindLabel(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('pole.number')}>
            <input
              value={pole.number}
              onChange={(e) => editNode(pole.id, pole.kind, (p) => void (p.number = e.target.value), 'number')}
            />
          </Field>
        </div>
        <div className="stats">
          <KtpDistanceInfo nodeId={pole.id} />
        </div>
        <div className="checks">
          <label>
            <input
              type="checkbox"
              checked={pole.hasInternet}
              onChange={(e) => editNode(pole.id, pole.kind, (p) => void (p.hasInternet = e.target.checked))}
            />
            {t('pole.internet')}
          </label>
        </div>
      </Section>

      <Section
        title={t('pole.builder')}
        actions={
          <div className="btn-row">
            <button onClick={() => add('L')}>{t('pole.addLeft')}</button>
            <button onClick={() => add('C')} title={t('pole.addCenterTitle')}>
              {t('pole.addCenter')}
            </button>
            <button onClick={() => add('R')}>{t('pole.addRight')}</button>
            <button onClick={() => add('R', 'sipClamp')} title={t('pole.addSipTitle')}>
              {t('pole.addSip')}
            </button>
          </div>
        }
      >
        <PoleDiagram
          pole={pole}
          trace={trace}
          selected={selectedIns && !jumperMode ? [selectedIns] : []}
          pending={jumperFirst}
          onClick={onDiagramClick}
        />
        <div className="row">
          <button
            className={jumperMode ? 'on-accent' : ''}
            disabled={pole.insulators.length < 2}
            onClick={() => {
              setJumperMode(!jumperMode);
              setJumperFirst(null);
            }}
          >
            {jumperMode ? t('common.done') : t('pole.jumperBtn')}
          </button>
          {jumperMode && (
            <span className="muted small">
              {jumperFirst ? t('pole.jumperSecond') : t('pole.jumperFirst')}
            </span>
          )}
        </div>
        {!isZigzag(pole) && (
          <div className="row">
            <button
              title={t('pole.zigzagTitle')}
              onClick={() => editNode(pole.id, pole.kind, (p) => layoutZigzag(p))}
            >
              {t('pole.zigzag')}
            </button>
            <button
              className="link"
              onClick={() => {
                const poles = Object.values(scheme.nodes).filter((n): n is PoleNode => isPole(n) && !isZigzag(n));
                if (!confirm(t('pole.zigzagAllConfirm', { n: poles.length }))) return;
                editScheme((d) => {
                  for (const n of Object.values(d.nodes)) if (isPole(n) && !isZigzag(n)) layoutZigzag(n);
                });
              }}
            >
              {t('pole.zigzagAll')}
            </button>
          </div>
        )}
        <p className="muted">{t('pole.help')}</p>
        <div className="table-scroll">
        <table className="table ins-table">
          <thead>
            <tr>
              <th />
              <th>{t('pole.col.ins')}</th>
              <th>{t('pole.col.side')}</th>
              <th title={t('pole.col.pos')}>№</th>
              <th title={t('pole.col.markTitle')}>{t('pole.col.mark')}</th>
              <th title={t('pole.col.phase')} />
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((ins) => (
              <Fragment key={ins.id}>
              <tr className={selectedIns === ins.id ? 'ins-row active' : 'ins-row'} onClick={() => focus(ins.id)}>
                <td className="ins-label">{insLabel(ins)}</td>
                <td>
                  <select
                    value={ins.type}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      editNode(pole.id, pole.kind, (p) => {
                        const i = p.insulators.find((x) => x.id === ins.id);
                        if (i) i.type = e.target.value as 'pin' | 'sipClamp';
                      })
                    }
                  >
                    <option value="pin">{t('ins.type.pin')}</option>
                    <option value="sipClamp">{t('ins.type.sipClamp')}</option>
                  </select>
                </td>
                <td>
                  <select
                    value={ins.side}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      editNode(pole.id, pole.kind, (p) => {
                        const i = p.insulators.find((x) => x.id === ins.id);
                        if (i) i.side = e.target.value as Side;
                      })
                    }
                  >
                    <option value="L">{t('side.L')}</option>
                    <option value="C">{t('side.C')}</option>
                    <option value="R">{t('side.R')}</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    className="num"
                    value={ins.position}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      editNode(pole.id, pole.kind, (p) => {
                        const i = p.insulators.find((x) => x.id === ins.id);
                        if (i) i.position = Math.max(1, Number(e.target.value) || 1);
                      })
                    }
                  />
                </td>
                <td>
                  <MarkSelect
                    value={ins.mark}
                    onChange={(mark) =>
                      editNode(pole.id, pole.kind, (p) => {
                        const i = p.insulators.find((x) => x.id === ins.id);
                        if (i) i.mark = mark;
                      })
                    }
                  />
                </td>
                <td>
                  <TraceChip trace={trace.ports.get(portKey(pole.id, ins.id))} />
                </td>
                <td>
                  <button
                    className="icon danger"
                    title={t('pole.removeIns')}
                    onClick={(e) => {
                      e.stopPropagation();
                      editScheme((d) => {
                        const p = d.nodes[pole.id];
                        if (p && p.kind === pole.kind) removeInsulator(d, p as PoleNode, ins.id);
                      });
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
              {/* Connections go on a second, full-width line so the table fits the sidebar. */}
              <tr className={selectedIns === ins.id ? 'ins-conn active' : 'ins-conn'} onClick={() => focus(ins.id)}>
                <td />
                <td colSpan={6} className="small muted">
                  {connections(ins.id).join('; ') || t('pole.free')}
                </td>
              </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </Section>

      <LampsSection pole={pole} />

      <Section title={t('pole.jumpers')}>
        <p className="muted">{t('pole.jumpersHelp')}</p>
        {pole.jumpers.map((j) => {
          const a = pole.insulators.find((i) => i.id === j.a);
          const b = pole.insulators.find((i) => i.id === j.b);
          return (
            <div key={j.id} className="row">
              {a ? insLabel(a) : '?'} ↔ {b ? insLabel(b) : '?'}
              <button
                className="icon danger"
                onClick={() => editNode(pole.id, pole.kind, (p) => void (p.jumpers = p.jumpers.filter((x) => x.id !== j.id)))}
              >
                ✕
              </button>
            </div>
          );
        })}
        <div className="row">
          {[jumperA, jumperB].map((v, k) => (
            <select key={k} value={v} onChange={(e) => (k ? setJumperB : setJumperA)(e.target.value)}>
              <option value="">—</option>
              {sorted.map((i) => (
                <option key={i.id} value={i.id}>
                  {insLabel(i)}
                </option>
              ))}
            </select>
          ))}
          <button
            disabled={!jumperA || !jumperB || jumperA === jumperB}
            onClick={() => {
              addJumper(jumperA, jumperB);
              setJumperA('');
              setJumperB('');
            }}
          >
            {t('pole.connect')}
          </button>
        </div>
      </Section>

      <Section title={t('pole.lines')}>
        {lines.length === 0 && <p className="muted">{t('pole.noLines')}</p>}
        <ul className="plain">
          {lines.map((l) => (
            <li key={l.id}>
              <button className="link" onClick={() => store.set({ selection: { type: 'line', id: l.id } })}>
                {lineKindLabel(l.kind)}
                {l.suspension === 'sip' ? t('pole.sipSuffix') : ''}
              </button>{' '}
              → <NodeLink node={scheme.nodes[l.from === pole.id ? l.to : l.from]} /> · {formatLength(lineLength(scheme, l))}
              {l.wires.length > 0 && ` · ${t('pole.wiresCount', { n: l.wires.length })}`}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
