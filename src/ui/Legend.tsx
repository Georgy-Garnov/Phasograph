import { COLOR_BUNDLE, COLOR_CONFLICT, COLOR_UNTRACED, LINE_STYLES, ROLE_COLORS } from '../model/constants';
import { useT, type MessageKey } from '../i18n';

interface LegendItem {
  label: MessageKey;
  color: string;
  width: number;
  dash?: number[];
}

const WIRE_LEGEND: LegendItem[] = [
  { label: 'legend.A', color: ROLE_COLORS.A, width: 3 },
  { label: 'legend.B', color: ROLE_COLORS.B, width: 3 },
  { label: 'legend.C', color: ROLE_COLORS.C, width: 3 },
  { label: 'legend.N', color: ROLE_COLORS.N, width: 3 },
  { label: 'legend.L', color: ROLE_COLORS.L, width: 3 },
  { label: 'legend.P', color: ROLE_COLORS.P, width: 3 },
  { label: 'legend.untraced', color: COLOR_UNTRACED, width: 3 },
  { label: 'legend.noInsulator', color: COLOR_UNTRACED, width: 3, dash: [3, 3] },
  { label: 'legend.conflict', color: COLOR_CONFLICT, width: 3 },
];

const LINE_LEGEND: LegendItem[] = [
  { label: 'legend.sip', color: COLOR_BUNDLE, width: 6 },
  { label: 'legend.line10', ...LINE_STYLES.line10 },
  { label: 'legend.lighting', ...LINE_STYLES.lighting },
  { label: 'legend.fiber', ...LINE_STYLES.fiber },
  { label: 'legend.noWires', color: COLOR_UNTRACED, width: 4, dash: [6, 6] },
];

function LegendSample({ item }: { item: LegendItem }) {
  const t = useT();
  return (
    <span className="legend-item">
      <svg width="26" height="10">
        <line x1="1" y1="5" x2="25" y2="5" stroke={item.color} strokeWidth={Math.min(item.width, 6)} strokeDasharray={item.dash?.join(' ')} />
      </svg>
      {t(item.label)}
    </span>
  );
}

/** Legend: wire colors from tracing results and line type styles. */
export function Legend() {
  const t = useT();
  return (
    <div className="legend">
      <div>
        <b>{t('legend.wires')}</b>
        {WIRE_LEGEND.map((i) => (
          <LegendSample key={i.label} item={i} />
        ))}
      </div>
      <div>
        <b>{t('legend.lines')}</b>
        {LINE_LEGEND.map((i) => (
          <LegendSample key={i.label} item={i} />
        ))}
        <span className="legend-item">
          <span className="legend-lamp">✹</span>
          {t('legend.lamp')}
          <span className="legend-lamp off">✹</span>
          {t('legend.lampOff')}
          <span className="legend-photo">📷</span>
          {t('legend.photo')}
        </span>
      </div>
    </div>
  );
}
