import { useState } from 'react';
import { store, useStore } from '../model/store';
import type { HouseNode, PoleNode } from '../model/types';
import { mapApi } from '../map/MapView';
import { RoleChip, nodeName } from './common';
import { lampStatusLabel } from './LampsSection';
import { currentLocale, useT, type MessageKey } from '../i18n';
import { formatIssue } from '../i18n/labels';
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
  const [tab, setTab] = useState<'houses' | 'issues' | 'feeders' | 'lighting'>('houses');
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
