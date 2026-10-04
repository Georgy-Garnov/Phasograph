import type { Insulator, PoleNode } from '../model/types';
import { COLOR_BUNDLE, COLOR_CONFLICT, COLOR_UNTRACED, ROLE_COLORS } from '../model/constants';
import { insLabel } from '../i18n/labels';
import { linesAt } from '../model/scheme';
import { useStore } from '../model/store';
import { useT } from '../i18n';
import { portKey, type TraceResult } from '../topology/trace';

interface Props {
  pole: PoleNode;
  trace: TraceResult;
  /** Highlighted insulators (e.g. those selected for a service drop). */
  selected?: string[];
  /** Insulator selected first when creating a jumper. */
  pending?: string | null;
  onClick?: (insulatorId: string) => void;
  /** Labels above insulators (e.g. "Ph", "N" for a service drop). */
  tags?: Record<string, string>;
}

const ROW_H = 26;

/** Insulator label: "L5 L ✎" (number, traced role, manual marking indicator). */
function labelText(ins: Insulator, role: string): string {
  return `${insLabel(ins)}${role ? ` ${role}` : ''}${ins.mark ? ' ✎' : ''}`;
}
const ARM = 95;

/**
 * Schematic front view of a pole: post, brackets/crossarms, left and right insulators by tier,
 * and center insulators on the pole body (branch on a T-pole). Jumpers are drawn as orange arcs.
 */
export function PoleDiagram({ pole, trace, selected = [], pending = null, onClick, tags = {} }: Props) {
  const tr = useT();
  const scheme = useStore((s) => s.scheme);
  const levels = Math.max(1, ...pole.insulators.map((i) => i.position));
  // Space above the insulators is reserved for luminaires.
  const lampSpace = pole.lamps.length ? 34 : 0;
  // Fiber cable hangs at the very bottom, below all insulators.
  const showFiber = pole.hasInternet || pole.fiberBox || linesAt(scheme, pole.id).some((l) => l.kind === 'fiber');
  const fiberSpace = showFiber ? 30 : 0;
  const height = levels * ROW_H + 40 + lampSpace + fiberSpace;
  // Side margins for "L5 Ph? ✎" labels: width is based on the longest label so it is not clipped.
  const labelPx = (i: Insulator) => labelText(i, roleText(i)).length * 7 + (i.mark ? 14 : 0);
  const longest = Math.max(30, ...pole.insulators.map(labelPx));
  // The label starts 16 px from the insulator center; the insulator itself sits 18 px from the crossarm end.
  const margin = Math.max(0, longest + 16 + 6 - 18);
  const width = ARM * 2 + 2 * margin + 10;
  const cx = width / 2;
  const y = (pos: number) => height - 20 - fiberSpace - (pos - 0.5) * ROW_H;
  const yFiber = height - 18;
  const xOf = (ins: Insulator) => (ins.side === 'L' ? cx - ARM + 18 : ins.side === 'R' ? cx + ARM - 18 : cx);

  function roleText(ins: Insulator): string {
    const t = trace.ports.get(portKey(pole.id, ins.id));
    if (t?.roles.length === 1) return t.roles[0] === 'P' ? tr('chip.phaseUnknown') : t.roles[0];
    return t?.bundledRoles.length ? tr('chip.sip') : '';
  }

  const colorOf = (ins: Insulator) => {
    const t = trace.ports.get(portKey(pole.id, ins.id));
    if (!t) return COLOR_UNTRACED;
    if (t.conflict) return COLOR_CONFLICT;
    if (t.roles.length === 1) return ROLE_COLORS[t.roles[0]];
    return t.bundledRoles.length ? COLOR_BUNDLE : COLOR_UNTRACED;
  };

  const renderInsulator = (ins: Insulator) => {
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
        const a = pole.insulators.find((i) => i.id === j.a);
        const b = pole.insulators.find((i) => i.id === j.b);
        if (!a || !b) return null;
        const [xa, ya, xb, yb] = [xOf(a), y(a.position) - 8, xOf(b), y(b.position) - 8];
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
            <title>{tr('diagram.jumper', { a: insLabel(a), b: insLabel(b) })}</title>
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
          const ins = portId ? pole.insulators.find((i) => i.id === portId) : undefined;
          if (!ins) return null;
          return (
            <line
              x1={lx}
              y1={ly + 4}
              x2={xOf(ins)}
              y2={y(ins.position) - 8}
              stroke={colorOf(ins) === COLOR_UNTRACED ? fallback : colorOf(ins)}
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
  );
}
