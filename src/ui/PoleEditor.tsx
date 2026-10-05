import { Fragment, useEffect, useState } from 'react';
import { store, useStore } from '../model/store';
import type { Insulator, PoleKind, PoleNode, Side, SipCores } from '../model/types';
import {
  addInsulator,
  isPole,
  isZigzag,
  layoutZigzag,
  linesAt,
  poleAzimuth,
  removeInsulator,
  sortInsulators,
  uid,
} from '../model/scheme';
import { portKey } from '../topology/trace';
import { SIP_CORE_TYPES, coreMarkings, corePort, polePorts, portMark, setPortMark } from '../model/sip';
import { addSipClamp, setInsulatorKind } from '../model/sipOps';
import { COLOR_UNTRACED, ROLE_COLORS } from '../model/constants';
import { setPoleAzimuth } from '../map/interactions';
import { PoleDiagram } from './PoleDiagram';
import { confirmDialog } from './dialog';
import { LampsSection } from './LampsSection';
import { Field, KtpDistanceInfo, MarkSelect, NodeLink, Section, TraceChip, editNode, editScheme, nodeName } from './common';
import { lineLength } from '../topology/distances';
import { formatLength, insLabel, lineKindLabel, nodeKindLabel, portLabel, portOptions } from '../i18n/labels';
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
      if (other) items.push(t('pole.conn.jumper', { ins: portLabel(pole, other) }));
    }
    for (const lamp of pole.lamps) {
      if (lamp.phasePort === insId || lamp.neutralPort === insId) items.push(t('pole.conn.lamp'));
    }
    return items;
  };

  const add = (side: Side) =>
    editNode(pole.id, pole.kind, (p) => {
      addInsulator(p, side);
    });
  const addCable = () => editNode(pole.id, pole.kind, (p) => void addSipClamp(p, '3+N+L'));

  const setKind = (ins: Insulator, kind: 'pin' | SipCores) => {
    let changed = 0;
    editScheme((d) => {
      const p = d.nodes[pole.id];
      if (isPole(p)) changed = setInsulatorKind(d, p, ins.id, kind);
    });
    if (changed > 1) store.set({ hint: t('pole.cableRunApplied', { n: changed }) });
  };

  /** Core rows of an ABC clamp: marking, manual mark, traced phase and connections of every core. */
  const coreRows = (ins: Insulator) =>
    coreMarkings(ins).map((m, k) => {
      const p = corePort(ins.id, k);
      const pt = trace.ports.get(portKey(pole.id, p));
      const color = pt && !pt.conflict && pt.roles.length === 1 ? ROLE_COLORS[pt.roles[0]] : COLOR_UNTRACED;
      return (
        <tr key={p} className={selectedIns === p ? 'core-row active' : 'core-row'} onClick={() => focus(p)}>
          <td />
          <td className="ins-label" title={t('pole.coreTitle', { m })}>
            <span className="core-dot" style={{ background: color }}>
              {m}
            </span>
          </td>
          <td colSpan={2} className="small muted">
            {connections(p).join('; ') || t('pole.free')}
          </td>
          <td>
            <MarkSelect
              value={portMark(pole, p)}
              onChange={(mark) => editNode(pole.id, pole.kind, (pp) => setPortMark(pp, p, mark))}
            />
          </td>
          <td>
            <TraceChip trace={pt} />
          </td>
          <td />
        </tr>
      );
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
          <label>
            <input
              type="checkbox"
              checked={pole.fiberBox}
              onChange={(e) => editNode(pole.id, pole.kind, (p) => void (p.fiberBox = e.target.checked))}
            />
            {t('pole.fiberBox')}
          </label>
        </div>
        <PoleOrientation pole={pole} />
      </Section>

      <Section
        title={t('pole.builder')}
        actions={
          <div className="btn-row">
            <button onClick={() => add('L')}>{t('pole.addLeft')}</button>
            <button onClick={() => add('C')} title={t('pole.addCenterTitle')}>
              {t('pole.addCenter')}
            </button>
            <button onClick={() => add('B')} title={t('pole.addBackTitle')}>
              {t('pole.addBack')}
            </button>
            <button onClick={() => add('R')}>{t('pole.addRight')}</button>
            <button onClick={addCable} title={t('pole.addSipTitle')}>
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
            disabled={polePorts(pole).length < 2}
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
              onClick={async () => {
                const poles = Object.values(scheme.nodes).filter((n): n is PoleNode => isPole(n) && !isZigzag(n));
                if (!(await confirmDialog(t('pole.zigzagAllConfirm', { n: poles.length }), { okLabel: t('dialog.apply') }))) return;
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
                    value={ins.type === 'pin' ? 'pin' : (ins.cores ?? '')}
                    title={t('pole.typeTitle')}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setKind(ins, e.target.value as 'pin' | SipCores)}
                  >
                    <option value="pin">{t('ins.type.pin')}</option>
                    {!ins.cores && ins.type === 'sipClamp' && <option value="">{t('ins.type.sipClamp')}</option>}
                    {SIP_CORE_TYPES.map((c) => (
                      <option key={c} value={c}>
                        {t('ins.type.sip', { cores: c })}
                      </option>
                    ))}
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
                    <option value="B">{t('side.B')}</option>
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
                  {coreMarkings(ins).length === 0 && <MarkSelect
                    value={ins.mark}
                    onChange={(mark) =>
                      editNode(pole.id, pole.kind, (p) => {
                        const i = p.insulators.find((x) => x.id === ins.id);
                        if (i) i.mark = mark;
                      })
                    }
                  />}
                </td>
                <td>
                  {coreMarkings(ins).length === 0 && <TraceChip trace={trace.ports.get(portKey(pole.id, ins.id))} />}
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
              {/* Connections go on a second, full-width line so the table fits the sidebar; a cable lists its cores. */}
              {coreMarkings(ins).length ? (
                coreRows(ins)
              ) : (
                <tr className={selectedIns === ins.id ? 'ins-conn active' : 'ins-conn'} onClick={() => focus(ins.id)}>
                  <td />
                  <td colSpan={6} className="small muted">
                    {connections(ins.id).join('; ') || t('pole.free')}
                  </td>
                </tr>
              )}
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
          return (
            <div key={j.id} className="row">
              {portLabel(pole, j.a)} ↔ {portLabel(pole, j.b)}
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
              {portOptions(pole).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
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

/** Pole orientation: "forward" azimuth that defines which side is left and right. */
function PoleOrientation({ pole }: { pole: PoleNode }) {
  const t = useT();
  const scheme = useStore((s) => s.scheme);
  const azimuth = poleAzimuth(scheme, pole);
  const auto = pole.azimuth === null;
  return (
    <div className="pole-orientation">
      <div className="row">
        <span className="orient-legend" aria-hidden>
          <i className="left" />
          <i className="right" />
        </span>
        <span>{t('pole.azimuth')}</span>
        <button className="icon" title={t('pole.rotateLeft')} onClick={() => setPoleAzimuth(pole.id, azimuth - 15)}>
          ⟲
        </button>
        <input
          type="number"
          className="num"
          min={0}
          max={359}
          value={azimuth}
          onChange={(e) => setPoleAzimuth(pole.id, Number(e.target.value) || 0)}
        />
        °
        <button className="icon" title={t('pole.rotateRight')} onClick={() => setPoleAzimuth(pole.id, azimuth + 15)}>
          ⟳
        </button>
        {auto ? (
          <span className="muted small">{t('pole.azimuthAuto')}</span>
        ) : (
          <button className="link" onClick={() => setPoleAzimuth(pole.id, null)} title={t('pole.azimuthResetTitle')}>
            {t('pole.azimuthReset')}
          </button>
        )}
      </div>
      <p className="muted small">{t('pole.orientHelp')}</p>
    </div>
  );
}
