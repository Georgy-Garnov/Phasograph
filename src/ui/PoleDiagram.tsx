import { useEffect, useState } from 'react';
import type { Insulator, PoleNode } from '../model/types';
import { COLOR_BUNDLE, COLOR_CONFLICT, COLOR_UNTRACED, ROLE_COLORS } from '../model/constants';
import { insLabel, portLabel } from '../i18n/labels';
import { coreMarkings, corePort, insulatorPorts, markingRibs, portInsulator, splitPort } from '../model/sip';
import { linesAt } from '../model/scheme';
import { useStore } from '../model/store';
import { useT } from '../i18n';
import { portKey, type TraceResult } from '../topology/trace';

interface Props {
  pole: PoleNode;
  trace: TraceResult;
  /** Highlighted ports — insulators or ABC cores (e.g. those selected for a service drop). */
  selected?: string[];
  /** Port selected first when creating a jumper. */
  pending?: string | null;
  /** Click on an insulator or on an ABC core (in the magnified cable view). */
  onClick?: (portId: string) => void;
  /** Labels above ports (e.g. "Ph", "N" for a service drop). */
  tags?: Record<string, string>;
}

const ROW_H = 26;
/** Spacing of the cores in the small cable cross-section on the pole. */
const CORE_STEP = 11;

/** Insulator label: "L5 L ✎" (number, traced role, manual marking indicator); a cable clamp shows its core set. */
function labelText(ins: Insulator, role: string): string {
  if (coreMarkings(ins).length) return `${insLabel(ins)} ${ins.cores}`;
  return `${insLabel(ins)}${role ? ` ${role}` : ''}${ins.mark ? ' ✎' : ''}`;
}
const ARM = 95;
/** Half width of the drawn insulator: a cable cross-section is as wide as its cores. */
const halfWidth = (ins: Insulator) => {
  const n = coreMarkings(ins).length;
  return n ? (n * CORE_STEP) / 2 + 3 : 12;
};

/** Phase color of a traced port (or the untraced / bundle / conflict color). */
function portColor(trace: TraceResult, poleId: string, portId: string): string {
  const t = trace.ports.get(portKey(poleId, portId));
  if (!t) return COLOR_UNTRACED;
  if (t.conflict) return COLOR_CONFLICT;
  if (t.roles.length === 1) return ROLE_COLORS[t.roles[0]];
  return t.bundledRoles.length ? COLOR_BUNDLE : COLOR_UNTRACED;
}

/**
 * Schematic front view of a pole: post, brackets/crossarms, left and right insulators by tier,
 * and center insulators on the pole body (branch on a T-pole). Jumpers are drawn as orange arcs.
 */
export function PoleDiagram({ pole, trace, selected = [], pending = null, onClick, tags = {} }: Props) {
  const tr = useT();
  const scheme = useStore((s) => s.scheme);
  // Magnified ABC cable: its cores are too small on the pole drawing to hit reliably.
  // A pole with a single cable shows it magnified right away.
  const cables = pole.insulators.filter((i) => coreMarkings(i).length > 0);
  const initialZoom = cables.length === 1 ? cables[0].id : null;
  const [zoomed, setZoomed] = useState<string | null>(initialZoom);
  // Reset only when another pole is shown: adding an insulator must not close the magnifier.
  useEffect(() => setZoomed(initialZoom), [pole.id]);
  const zoomedIns = pole.insulators.find((i) => i.id === zoomed && coreMarkings(i).length);
  const levels = Math.max(1, ...pole.insulators.map((i) => i.position));
  // Space above the insulators is reserved for luminaires.
  const lampSpace = pole.lamps.length ? 34 : 0;
  // Fiber cable hangs at the very bottom, below all insulators.
  const showFiber = pole.hasInternet || pole.fiberBox || linesAt(scheme, pole.id).some((l) => l.kind === 'fiber');
  const fiberSpace = showFiber ? 30 : 0;
  const height = levels * ROW_H + 40 + lampSpace + fiberSpace;
  // Side margins for "L5 Ph? ✎" labels: width is based on the longest label so it is not clipped.
  const labelPx = (i: Insulator) => labelText(i, roleText(i)).length * 7 + (i.mark ? 14 : 0) + halfWidth(i);
  const longest = Math.max(30, ...pole.insulators.map(labelPx));
  // The label starts 4 px beyond the insulator edge; the insulator itself sits 18 px from the crossarm end.
  const margin = Math.max(0, longest + 6 + 6 - 18);
  const width = ARM * 2 + 2 * margin + 10;
  const cx = width / 2;
  const y = (pos: number) => height - 20 - fiberSpace - (pos - 0.5) * ROW_H;
  const yFiber = height - 18;
  const xOf = (ins: Insulator) => (ins.side === 'L' ? cx - ARM + 18 : ins.side === 'R' ? cx + ARM - 18 : cx);
  /** Drawing point of a port: the insulator top, or a core in the cable cross-section. */
  const portXY = (portId: string): [number, number] | null => {
    const ins = portInsulator(pole, portId);
    if (!ins) return null;
    const { core } = splitPort(portId);
    const n = coreMarkings(ins).length;
    if (core !== null && n) return [xOf(ins) + (core - (n - 1) / 2) * CORE_STEP, y(ins.position) + 1];
    return [xOf(ins), y(ins.position) - 8];
  };

  function roleText(ins: Insulator): string {
    const t = trace.ports.get(portKey(pole.id, ins.id));
    if (t?.roles.length === 1) return t.roles[0] === 'P' ? tr('chip.phaseUnknown') : t.roles[0];
    return t?.bundledRoles.length ? tr('chip.sip') : '';
  }

  const colorOf = (ins: Insulator) => portColor(trace, pole.id, ins.id);
  const isSelected = (portId: string) => selected.includes(portId) || pending === portId;

  /** ABC clamp with known cores: a small cable cross-section; a click magnifies it. */
  const renderCable = (ins: Insulator) => {
    const x = xOf(ins);
    const yy = y(ins.position);
    const markings = coreMarkings(ins);
    const hw = halfWidth(ins);
    const anySel = insulatorPorts(ins).some(isSelected);
    const labelX = ins.side === 'L' || ins.side === 'B' ? x - hw - 4 : x + hw + 4;
    return (
      <g
        key={ins.id}
        className={`insulator cable${zoomed === ins.id ? ' zoomed' : ''}`}
        onClick={() => setZoomed(zoomed === ins.id ? null : ins.id)}
        style={{ cursor: 'zoom-in' }}
      >
        <title>{tr('diagram.cableZoom', { ins: insLabel(ins), cores: ins.cores ?? '' })}</title>
        <rect
          x={x - hw}
          y={yy - 7}
          width={hw * 2}
          height={16}
          rx={8}
          fill="#1d1f22"
          stroke={zoomed === ins.id ? '#008cff' : anySel ? '#008cff' : '#000'}
          strokeWidth={zoomed === ins.id || anySel ? 2.5 : 1}
        />
        {markings.map((m, k) => {
          const p = corePort(ins.id, k);
          const [cxk, cyk] = portXY(p)!;
          return (
            <circle
              key={m}
              cx={cxk}
              cy={cyk}
              r={4.2}
              fill={portColor(trace, pole.id, p)}
              stroke={isSelected(p) ? (pending === p ? '#ff7a00' : '#4fb3ff') : '#000'}
              strokeWidth={isSelected(p) ? 2 : 0.8}
            />
          );
        })}
        <text
          x={labelX}
          y={yy + 4}
          fontSize={11}
          textAnchor={ins.side === 'L' || ins.side === 'B' ? 'end' : 'start'}
          fill="#222"
          paintOrder="stroke"
          stroke="#f8fafc"
          strokeWidth={3}
        >
          {labelText(ins, '')}
        </text>
      </g>
    );
  };

  const renderInsulator = (ins: Insulator) => {
      if (coreMarkings(ins).length) return renderCable(ins);
      const color = colorOf(ins);
      const x = xOf(ins);
      const yy = y(ins.position);
      const isSel = selected.includes(ins.id) || pending === ins.id;
      const strokeColor = pending === ins.id ? '#ff7a00' : isSel ? '#008cff' : '#222';
      const role = roleText(ins);
        const back = ins.side === 'B';
    // Labels: left-side and back ones go left of the insulator, right-side and center ones go right.
    const labelX = ins.side === 'L' || back ? x - 16 : x + 16;
      return (
        <g
        key={ins.id}
        className={back ? 'insulator back' : 'insulator'}
        onClick={() => onClick?.(ins.id)}
        style={{ cursor: onClick ? 'pointer' : 'default' }}
      >
          <title>{`${insLabel(ins)}${role ? ` — ${role}` : ''}`}</title>
          {ins.type === 'sipClamp' ? (
            <rect x={x - 12} y={yy - 6} width={24} height={14} rx={4} fill={color} stroke={strokeColor} strokeWidth={isSel ? 4 : 1} />
          ) : (
            <>
              {ins.side === 'C' || back ? (
                <rect x={x - 7} y={yy + 4} width={14} height={4} fill="#555" />
              ) : (
                <rect x={x - 3} y={yy} width={6} height={9} fill="#555" />
              )}
              <ellipse
            cx={x}
            cy={yy - 2}
            rx={11}
            ry={8}
            fill={color}
            stroke={strokeColor}
            strokeWidth={isSel ? 4 : 1}
            // Behind the pole: faded with a dashed outline.
            strokeDasharray={back && !isSel ? '3 2' : undefined}
            fillOpacity={back ? 0.55 : 1}
          />
            </>
          )}
          <text
            x={labelX}
            y={yy + 2}
            fontSize={11}
            textAnchor={ins.side === 'L' || back ? 'end' : 'start'}
            fill="#222"
            paintOrder="stroke"
            stroke="#f8fafc"
            strokeWidth={3}
          >
            {labelText(ins, role)}
          </text>
          {tags[ins.id] && (
            <text x={x} y={yy - 13} fontSize={10} fontWeight={700} textAnchor="middle" fill="#008cff">
              {tags[ins.id]}
            </text>
          )}
        </g>
      );
  };

  return (
    <>
    <svg className="pole-diagram" viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxHeight: 340 }}>
      {/* Back insulators are drawn first so the pole body covers them; the pole itself ignores clicks. */}
      {pole.insulators.filter((i) => i.side === 'B').map(renderInsulator)}
      <rect x={cx - 5} y={6} width={10} height={height - 6} fill="#8d7b68" rx={3} pointerEvents="none" />

      {/* A bracket for each side insulator; if both sides have insulators at the same height, draw a full crossarm. */}
      {Array.from({ length: levels }, (_, k) => {
        const level = k + 1;
        const sides = new Set(pole.insulators.filter((i) => i.position === level).map((i) => i.side));
        if (!sides.has('L') && !sides.has('R')) return null;
        const x1 = sides.has('L') ? cx - ARM : cx;
        const x2 = sides.has('R') ? cx + ARM : cx;
        return <line key={k} x1={x1} x2={x2} y1={y(level) + 9} y2={y(level) + 9} stroke="#6b6b6b" strokeWidth={3} />;
      })}

      {pole.jumpers.map((j) => {
        const pa = portXY(j.a);
        const pb = portXY(j.b);
        if (!pa || !pb) return null;
        const [xa, ya, xb, yb] = [pa[0], pa[1], pb[0], pb[1]];
        const lift = Math.max(18, Math.abs(xa - xb) / 4);
        return (
          <path
            key={j.id}
            d={`M${xa},${ya} C${xa},${ya - lift} ${xb},${yb - lift} ${xb},${yb}`}
            fill="none"
            stroke="#ff7a00"
            strokeWidth={2.5}
            strokeDasharray="5 2"
          >
            <title>{tr('diagram.jumper', { a: portLabel(pole, j.a), b: portLabel(pole, j.b) })}</title>
          </path>
        );
      })}

      {pole.insulators.filter((i) => i.side !== 'B').map(renderInsulator)}

      {/* Luminaires on brackets near the pole top and their connections to insulators. */}
      {pole.lamps.map((lamp, k) => {
        const lx = cx + (k % 2 === 0 ? 1 : -1) * (42 + 26 * Math.floor(k / 2));
        const ly = 16;
        const status = trace.lamps.get(lamp.id)?.status;
        const wire = (portId: string | null, fallback: string) => {
          const at = portId ? portXY(portId) : null;
          if (!portId || !at) return null;
          const color = portColor(trace, pole.id, portId);
          return (
            <line
              x1={lx}
              y1={ly + 4}
              x2={at[0]}
              y2={at[1]}
              stroke={color === COLOR_UNTRACED ? fallback : color}
              strokeWidth={1.3}
              strokeDasharray="3 2"
              opacity={0.85}
            />
          );
        };
        return (
          <g key={lamp.id}>
            <title>{`${tr('diagram.lamp', { n: k + 1 })}${lamp.powerW ? `, ${lamp.powerW} ${tr('unit.w')}` : ''}`}</title>
            {wire(lamp.phasePort, '#999')}
            {wire(lamp.neutralPort, '#999')}
            <path d={`M${cx},${ly + 12} Q${(cx + lx) / 2},${ly - 6} ${lx},${ly}`} fill="none" stroke="#555" strokeWidth={2.5} />
            <path
              d={`M${lx - 10},${ly} L${lx + 10},${ly} L${lx + 6},${ly + 6} L${lx - 6},${ly + 6} Z`}
              fill={status === 'ok' ? '#ffcc00' : '#c9ced4'}
              stroke="#555"
              strokeWidth={1}
            />
          </g>
        );
      })}

      {showFiber && (
        <g className="fiber">
          <title>{tr('diagram.fiber')}</title>
          <line x1={cx - ARM} x2={cx + ARM} y1={yFiber} y2={yFiber} stroke="#00a3a3" strokeWidth={3} strokeDasharray="2 5" strokeLinecap="round" />
          <text x={cx - ARM} y={yFiber - 6} fontSize={10} fill="#007f7f" fontWeight={600}>
            {tr('diagram.fiber')}
          </text>
          {pole.fiberBox && (
            <g>
              <title>{tr('pole.fiberBox')}</title>
              <rect x={cx + 8} y={yFiber - 12} width={20} height={16} rx={2} fill="#00a3a3" stroke="#006b6b" />
              <line x1={cx + 8} x2={cx + 28} y1={yFiber - 6} y2={yFiber - 6} stroke="#e0ffff" strokeWidth={1} />
            </g>
          )}
        </g>
      )}

      {pole.insulators.length === 0 && (
        <text x={cx} y={height / 2} textAnchor="middle" fontSize={12} fill="#888">
          {tr('diagram.noIns')}
        </text>
      )}
    </svg>
    {zoomedIns && (
      <CableZoom
        pole={pole}
        ins={zoomedIns}
        trace={trace}
        isSelected={isSelected}
        pending={pending}
        tags={tags}
        onClick={onClick}
        onClose={() => setZoomed(null)}
      />
    )}
    </>
  );
}

const ZOOM_R = 21;
const ZOOM_STEP = 58;

/**
 * Magnified cross-section of an ABC cable: big cores with their marking (GOST 31946: phases 1, 2, 3 with as many
 * ribs, neutral 0, lighting 4), colored by the traced phase, easy to hit with jumpers and service drops.
 */
function CableZoom({
  pole,
  ins,
  trace,
  isSelected,
  pending,
  tags,
  onClick,
  onClose,
}: {
  pole: PoleNode;
  ins: Insulator;
  trace: TraceResult;
  isSelected: (portId: string) => boolean;
  pending: string | null;
  tags: Record<string, string>;
  onClick?: (portId: string) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const markings = coreMarkings(ins);
  const width = markings.length * ZOOM_STEP + 16;
  const height = 104;
  const cy = 50;
  return (
    <div className="cable-zoom">
      <div className="row">
        <b>{tr('diagram.cableTitle', { ins: insLabel(ins), cores: ins.cores ?? '' })}</b>
        <button className="icon" title={tr('common.close')} onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="muted small">{tr('diagram.cableHelp')}</div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width * 1.4, maxHeight: 150 }}>
        <rect x={4} y={cy - ZOOM_R - 8} width={width - 8} height={(ZOOM_R + 8) * 2} rx={ZOOM_R + 8} fill="#2b2e33" />
        {markings.map((m, k) => {
          const p = corePort(ins.id, k);
          const x = 8 + ZOOM_STEP / 2 + k * ZOOM_STEP;
          const t = trace.ports.get(portKey(pole.id, p));
          const color = portColor(trace, pole.id, p);
          const role = t?.roles.length === 1 ? (t.roles[0] === 'P' ? tr('chip.phaseUnknown') : t.roles[0]) : t?.bundledRoles.length ? tr('chip.sip') : '';
          const sel = isSelected(p);
          const ribs = markingRibs(m);
          return (
            <g key={m} className="cable-core" onClick={() => onClick?.(p)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
              <title>{`${portLabel(pole, p)}${role ? ` — ${role}` : ''}`}</title>
              <circle cx={x} cy={cy} r={ZOOM_R} fill={color} stroke={sel ? (pending === p ? '#ff7a00' : '#4fb3ff') : '#0b0c0d'} strokeWidth={sel ? 5 : 4} />
              {Array.from({ length: ribs }, (_, r) => {
                const a = (-90 + (r - (ribs - 1) / 2) * 22) * (Math.PI / 180);
                return (
                  <line
                    key={r}
                    x1={x + Math.cos(a) * (ZOOM_R - 1)}
                    y1={cy + Math.sin(a) * (ZOOM_R - 1)}
                    x2={x + Math.cos(a) * (ZOOM_R + 5)}
                    y2={cy + Math.sin(a) * (ZOOM_R + 5)}
                    stroke="#0b0c0d"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                );
              })}
              <text x={x} y={cy + 6} fontSize={18} fontWeight={700} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={2.5} paintOrder="stroke">
                {m}
              </text>
              <text x={x} y={height - 4} fontSize={11} textAnchor="middle" fill="#222">
                {role || '—'}
              </text>
              {tags[p] && (
                <text x={x} y={12} fontSize={11} fontWeight={700} textAnchor="middle" fill="#008cff">
                  {tags[p]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
