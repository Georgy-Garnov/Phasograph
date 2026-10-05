import { useState } from 'react';
import { store, useStore } from '../model/store';
import type { HouseNode, PoleNode } from '../model/types';
import { mapApi } from '../map/MapView';
import { RoleChip, nodeName } from './common';
import { lampStatusLabel } from './LampsSection';
import { currentLocale, useT, type MessageKey } from '../i18n';
import { formatIssue } from '../i18n/labels';
import { COS_PHI, VOLTAGE_MAX, VOLTAGE_MIN, cachedVoltages, type LoadMode } from '../topology/voltage';
import { transformerType } from '../model/transformers';
import { isPole } from '../model/scheme';
import { statusLabel } from './HouseForm';

function select(id: string) {
  const s = store.get();
  const node = s.scheme.nodes[id];
  const line = s.scheme.lines[id];
  if (node) {
    store.set({ selection: { type: 'node', id }, focusKey: null });
    mapApi.flyTo?.(node.coords);
  } else if (line) {
    store.set({ selection: { type: 'line', id }, focusKey: null });
    const a = s.scheme.nodes[line.from];
    if (a) mapApi.flyTo?.(a.coords);
  }
}

export function ReportPanel() {
  const t = useT();
  const [tab, setTab] = useState<'houses' | 'issues' | 'feeders' | 'lighting' | 'voltage'>('houses');
  const scheme = useStore((s) => s.scheme);
  const trace = useStore((s) => s.trace);
  const houses = Object.values(scheme.nodes).filter((n): n is HouseNode => n.kind === 'house');
  const errors = trace.issues.filter((i) => i.level !== 'info').length;

  return (
    <div className="report">
      <div className="tabs">
        <button className={tab === 'houses' ? 'on' : ''} onClick={() => setTab('houses')}>
          {t('report.houses', { n: houses.length })}
        </button>
        <button className={tab === 'issues' ? 'on' : ''} onClick={() => setTab('issues')}>
          {t('report.issues')} {errors > 0 && <span className="count">{errors}</span>}
        </button>
        <button className={tab === 'feeders' ? 'on' : ''} onClick={() => setTab('feeders')}>
          {t('report.feeders')}
        </button>
        <button className={tab === 'lighting' ? 'on' : ''} onClick={() => setTab('lighting')}>
          {t('report.lighting')}
        </button>
        <button className={tab === 'voltage' ? 'on' : ''} onClick={() => setTab('voltage')}>
          {t('report.voltage')}
        </button>
      </div>

      {tab === 'houses' && (
        <table className="table clickable">
          <thead>
            <tr>
              <th>{t('col.address')}</th>
              <th>{t('col.meter')}</th>
              <th>{t('col.type')}</th>
              <th>{t('col.phase')}</th>
              <th>{t('col.feeder')}</th>
              <th>{t('col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {houses.map((h) => {
              const ht = trace.houses.get(h.id);
              return (
                <tr key={h.id} onClick={() => select(h.id)}>
                  <td>{h.address || h.name || <span className="muted">{t('report.noAddress')}</span>}</td>
                  <td>{h.meterNumber}</td>
                  <td>{t('report.phaseMode', { n: h.phaseMode })}</td>
                  <td>
                    {(ht?.effectivePhases.length ? ht.effectivePhases : [null]).map((p, i) => (
                      <RoleChip key={i} role={p} />
                    ))}
                  </td>
                  <td>{(ht?.feeders ?? []).map((f) => trace.feeders.get(f)?.name).join(', ')}</td>
                  <td className={`status status-${ht?.status}`}>{ht && statusLabel(ht)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {tab === 'issues' && (
        <ul className="issues">
          {trace.issues.length === 0 && <li className="muted">{t('report.noIssues')}</li>}
          {trace.issues.map((i, k) => (
            <li key={k} className={`issue issue-${i.level}`} onClick={() => select(i.targetId)}>
              {formatIssue(i, scheme)}
            </li>
          ))}
        </ul>
      )}

      {tab === 'lighting' && <LightingReport />}
      {tab === 'voltage' && <VoltageReport />}

      {tab === 'feeders' && (
        <table className="table">
          <thead>
            <tr>
              <th>{t('col.ktpFeeder')}</th>
              <th>A</th>
              <th>B</th>
              <th>C</th>
              <th>{t('col.three')}</th>
              <th>{t('col.undetermined')}</th>
              <th>{t('col.imbalance')}</th>
            </tr>
          </thead>
          <tbody>
            {trace.feederStats.map((s) => {
              const v = [s.single.A, s.single.B, s.single.C];
              const max = Math.max(...v);
              const min = Math.min(...v);
              return (
                <tr key={s.feeder.id}>
                  <td>
                    {s.feeder.ktpName || t('node.ktp')} / {s.feeder.name}
                  </td>
                  <td>{s.single.A}</td>
                  <td>{s.single.B}</td>
                  <td>{s.single.C}</td>
                  <td>{s.three}</td>
                  <td>{s.unknown}</td>
                  <td className={max - min > 2 ? 'status status-conflict' : ''}>{max - min}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Street lighting luminaires: list and per-feeder totals. */
function LightingReport() {
  const tr = useT();
  const scheme = useStore((s) => s.scheme);
  const trace = useStore((s) => s.trace);
  const rows = Object.values(scheme.nodes)
    .filter((n): n is PoleNode => isPole(n))
    .flatMap((pole) => pole.lamps.map((lamp) => ({ pole, lamp, t: trace.lamps.get(lamp.id) })));
  if (rows.length === 0) return <p className="muted pad">{tr('report.noLamps')}</p>;

  const watts = (w: string) => Number(w.replace(',', '.')) || 0;
  const totals = new Map<string, { count: number; watts: number }>();
  for (const { lamp, t } of rows) {
    const key = t?.feeders[0] ? (trace.feeders.get(t.feeders[0])?.name ?? '?') : tr('report.lampsUntraced');
    const cur = totals.get(key) ?? { count: 0, watts: 0 };
    totals.set(key, { count: cur.count + 1, watts: cur.watts + watts(lamp.powerW) });
  }
  const off = rows.filter((r) => r.t?.status !== 'ok').length;

  return (
    <>
      <div className="stats pad">
        <span>
          {tr('report.lampsCount')}: <b>{rows.length}</b>
        </span>
        <span>
          {tr('report.lampsPower')}: <b>{rows.reduce((s, r) => s + watts(r.lamp.powerW), 0).toLocaleString(currentLocale())} {tr('unit.w')}</b>
        </span>
        {off > 0 && <span className="status status-sip">{tr('report.lampsOff', { n: off })}</span>}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>{tr('col.feeder')}</th>
            <th>{tr('report.lampsCount')}</th>
            <th>{tr('unit.w')}</th>
          </tr>
        </thead>
        <tbody>
          {[...totals].map(([name, v]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{v.count}</td>
              <td>{v.watts.toLocaleString(currentLocale())}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="table clickable">
        <thead>
          <tr>
            <th>{tr('col.pole')}</th>
            <th>{tr('col.type')}</th>
            <th>{tr('unit.w')}</th>
            <th>{tr('col.supply')}</th>
            <th>{tr('col.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ pole, lamp, t }) => (
            <tr key={lamp.id} onClick={() => select(pole.id)}>
              <td>{nodeName(pole)}</td>
              <td>{tr(`lamp.kind.${lamp.kind}` as MessageKey)}</td>
              <td>{lamp.powerW}</td>
              <td>
                <RoleChip role={t?.supply ?? null} />
              </td>
              <td className={`status ${t?.status === 'ok' ? 'status-ok' : t?.status === 'wrong' ? 'status-conflict' : 'status-sip'}`}>
                {t && lampStatusLabel(t.status)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Voltage-drop report: load mode, voltmeters on the map, houses sorted from the lowest voltage. */
function VoltageReport() {
  const t = useT();
  const scheme = useStore((s) => s.scheme);
  const trace = useStore((s) => s.trace);
  const settings = useStore((s) => s.settings);
  const calc = cachedVoltages(scheme, trace, settings.voltageMode);
  const voltages = calc.houses;
  const houses = Object.values(scheme.nodes).filter((n): n is HouseNode => n.kind === 'house');
  const rows = houses
    .filter((h) => voltages.has(h.id))
    .map((h) => ({ h, v: voltages.get(h.id)! }))
    .sort((a, b) => a.v.voltage - b.v.voltage);
  const bad = rows.filter((r) => !r.v.ok).length;
  const totalKw = rows.reduce((sum, r) => sum + r.v.loadKw, 0);

  return (
    <div className="pad voltage-report">
      <div className="row">
        <div className="seg">
          {(['current', 'design'] as LoadMode[]).map((m) => (
            <button key={m} className={settings.voltageMode === m ? 'on' : ''} onClick={() => store.setSettings({ voltageMode: m })}>
              {t(m === 'current' ? 'voltage.modeCurrent' : 'voltage.modeDesign')}
            </button>
          ))}
        </div>
        <label className="checks">
          <input
            type="checkbox"
            checked={settings.showVoltage}
            onChange={(e) => store.setSettings({ showVoltage: e.target.checked })}
          />
          {t('voltage.showOnMap')}
        </label>
      </div>
      <p className="muted small">{t('voltage.help', { cos: COS_PHI, min: VOLTAGE_MIN, max: VOLTAGE_MAX })}</p>
      {[...calc.ktps].map(([id, k]) => {
        const node = scheme.nodes[id];
        if (node?.kind !== 'ktp') return null;
        return (
          <div key={id} className="stats ktp-summary" onClick={() => select(id)}>
            <b>{node.name || transformerType(node, t('node.ktp'))}</b>
            <span>
              {t('ktp.loading')}: {(k.apparentVa / 1000).toFixed(1)} {t('unit.kva')}
              {k.loadingPct !== null && <b className={k.loadingPct > 100 ? 'status-conflict' : ''}> ({k.loadingPct.toFixed(0)}%)</b>}
            </span>
            <span>
              {t('ktp.busbars')}: {(['A', 'B', 'C'] as const).map((p) => k.voltages[p].toFixed(0)).join(' / ')} {t('unit.v')}
            </span>
            <span>
              {t('ktp.hvReading')}: {(k.hvVoltage / 1000).toFixed(2)} {t('unit.kv')}
            </span>
          </div>
        );
      })}
      <div className="stats">
        <span>
          {t('voltage.computed')}: <b>{rows.length}</b> / {houses.length}
        </span>
        <span>
          {t('voltage.totalLoad')}: <b>{totalKw.toLocaleString(currentLocale(), { maximumFractionDigits: 1 })} {t('unit.kw')}</b>
        </span>
        {rows.length > 0 && (
          <span>
            {t('voltage.min')}: <b className={rows[0].v.ok ? '' : 'status-conflict'}>{rows[0].v.voltage.toFixed(1)} {t('unit.v')}</b>
          </span>
        )}
        {bad > 0 && <span className="status status-conflict">{t('voltage.outOfRange', { n: bad })}</span>}
      </div>
      {rows.length < houses.length && <p className="muted small">{t('voltage.notComputed', { n: houses.length - rows.length })}</p>}
      <table className="table clickable">
        <thead>
          <tr>
            <th>{t('col.address')}</th>
            <th>{t('col.phase')}</th>
            <th>{t('unit.kw')}</th>
            <th>{t('unit.v')}</th>
            <th>ΔU</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ h, v }) => (
            <tr key={h.id} className={v.ok ? '' : 'bad-row'} onClick={() => select(h.id)}>
              <td>{nodeName(h)}</td>
              <td>{v.phases.map((p) => p.phase).join('')}</td>
              <td>
                {v.phases.length > 1
                  ? v.phases.map((p) => p.loadKw.toLocaleString(currentLocale(), { maximumFractionDigits: 1 })).join(' / ')
                  : v.loadKw.toLocaleString(currentLocale(), { maximumFractionDigits: 1 })}
              </td>
              <td>
                {v.phases.length > 1 ? v.phases.map((p) => p.voltage.toFixed(0)).join(' / ') : <b>{v.voltage.toFixed(1)}</b>}
              </td>
              <td>{v.dropPct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
