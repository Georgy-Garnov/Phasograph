import { store, useStore } from '../model/store';
import type { HvKv, KtpNode, OutputRole } from '../model/types';
import { TAP_POSITIONS, TRANSFORMER_RATINGS, hvNominalV, transformerType } from '../model/transformers';
import { cachedVoltages } from '../topology/voltage';
import { detachPort, makeFeeder, uid } from '../model/scheme';
import { portKey } from '../topology/trace';
import { Field, Section, TraceChip, editNode, editScheme } from './common';
import { feederLengths } from '../topology/distances';
import { formatLength } from '../i18n/labels';
import { currentLocale, useT, type MessageKey } from '../i18n';
import { confirmDialog } from './dialog';
import { KTP_GROUND_OHM } from '../model/earthing';

const ROLES: OutputRole[] = ['A', 'B', 'C', 'N', 'L', 'SIP'];

export function KtpEditor({ ktp }: { ktp: KtpNode }) {
  const t = useT();
  const trace = useStore((s) => s.trace);
  const focusKey = useStore((s) => s.focusKey);
  const stats = trace.feederStats.filter((s) => s.feeder.ktpId === ktp.id);
  const scheme = useStore((s) => s.scheme);
  const lengths = feederLengths(scheme, trace);

  return (
    <>
      <Section title={t('ktp.title')}>
        <div className="grid2">
          <Field label={t('ktp.name')}>
            <input value={ktp.name} onChange={(e) => editNode(ktp.id, 'ktp', (k) => void (k.name = e.target.value), 'name')} />
          </Field>
        </div>
      </Section>

      <TransformerSection ktp={ktp} />

      <Section
        title={t('ktp.feeders')}
        actions={
          <button onClick={() => editNode(ktp.id, 'ktp', (k) => void k.feeders.push(makeFeeder(k.feeders.length + 1)))}>
            {t('ktp.addFeeder')}
          </button>
        }
      >
        <p className="muted">
          {t('ktp.help')}
        </p>
        {ktp.feeders.map((f) => (
          <div key={f.id} className="feeder">
            <div className="row">
              <input
                value={f.name}
                onChange={(e) =>
                  editNode(ktp.id, 'ktp', (k) => {
                    const ff = k.feeders.find((x) => x.id === f.id);
                    if (ff) ff.name = e.target.value;
                  }, `feeder-${f.id}`)
                }
              />
              <button
                className="icon danger"
                title={t('ktp.removeFeeder')}
                onClick={async () => {
                  if (!(await confirmDialog(t('ktp.removeFeederConfirm', { name: f.name }), { okLabel: t('dialog.delete'), danger: true }))) return;
                  editScheme((d) => {
                    const k = d.nodes[ktp.id];
                    if (k?.kind !== 'ktp') return;
                    f.outputs.forEach((o) => detachPort(d, ktp.id, o.id));
                    k.feeders = k.feeders.filter((x) => x.id !== f.id);
                  });
                }}
              >
                ✕
              </button>
            </div>
            <div className="stats">
              {lengths.get(f.id) ? (
                <>
                  <span>
                    {t('ktp.mainLength')}: <b>{formatLength(lengths.get(f.id)!.main)}</b>
                  </span>
                  <span>
                    {t('ktp.dropsLength')}: <b>{formatLength(lengths.get(f.id)!.drops)}</b>
                  </span>
                </>
              ) : (
                <span className="muted">{t('ktp.feederUntraced')}</span>
              )}
            </div>
            <table className="table">
              <tbody>
                {f.outputs.map((o) => {
                  const key = portKey(ktp.id, o.id);
                  return (
                    <tr
                      key={o.id}
                      className={focusKey === key ? 'active' : ''}
                      onClick={() => store.set({ focusKey: focusKey === key ? null : key })}
                    >
                      <td>{t('ktp.output', { n: o.index })}</td>
                      <td>
                        <select
                          value={o.role}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            editNode(ktp.id, 'ktp', (k) => {
                              const out = k.feeders.find((x) => x.id === f.id)?.outputs.find((x) => x.id === o.id);
                              if (out) out.role = e.target.value as OutputRole;
                            })
                          }
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {t(`role.${r}` as MessageKey)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <TraceChip trace={trace.ports.get(key)} />
                      </td>
                      <td>
                        <button
                          className="icon danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            editScheme((d) => {
                              const k = d.nodes[ktp.id];
                              if (k?.kind !== 'ktp') return;
                              detachPort(d, ktp.id, o.id);
                              const ff = k.feeders.find((x) => x.id === f.id);
                              if (ff) ff.outputs = ff.outputs.filter((x) => x.id !== o.id);
                            });
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
            <button
              onClick={() =>
                editNode(ktp.id, 'ktp', (k) => {
                  const ff = k.feeders.find((x) => x.id === f.id);
                  if (ff) ff.outputs.push({ id: uid('out'), index: ff.outputs.length + 1, role: 'N' });
                })
              }
            >
              {t('ktp.addOutput')}
            </button>
          </div>
        ))}
      </Section>

      {stats.length > 0 && (
        <Section title={t('ktp.distribution')}>
          <table className="table">
            <thead>
              <tr>
                <th>{t('col.feeder')}</th>
                <th>A</th>
                <th>B</th>
                <th>C</th>
                <th>{t('col.three')}</th>
                <th>?</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.feeder.id}>
                  <td>{s.feeder.name}</td>
                  <td>{s.single.A}</td>
                  <td>{s.single.B}</td>
                  <td>{s.single.C}</td>
                  <td>{s.three}</td>
                  <td>{s.unknown}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}

/** Transformer: rating, HV class and actual supply, off-circuit tap changer, live readings. */
function TransformerSection({ ktp }: { ktp: KtpNode }) {
  const t = useT();
  const scheme = useStore((s) => s.scheme);
  const trace = useStore((s) => s.trace);
  const mode = useStore((s) => s.settings.voltageMode);
  const reading = cachedVoltages(scheme, trace, mode).ktps.get(ktp.id);
  const fmt = (v: number, digits = 1) => v.toLocaleString(currentLocale(), { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const phases = ['A', 'B', 'C'] as const;
  return (
    <Section title={`${t('ktp.transformer')} · ${transformerType(ktp, t('node.ktp'))}`}>
      <div className="grid2">
        <Field label={t('ktp.power')}>
          <select value={ktp.powerKva} onChange={(e) => editNode(ktp.id, 'ktp', (k) => void (k.powerKva = e.target.value))}>
            <option value="">{t('ktp.powerUnknown')}</option>
            {TRANSFORMER_RATINGS.map((kva) => (
              <option key={kva} value={String(kva)}>
                {kva} {t('unit.kva')}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('ktp.hv')}>
          <div className="seg">
            {([6, 10] as HvKv[]).map((kv) => (
              <button key={kv} className={ktp.hvKv === kv ? 'on' : ''} onClick={() => editNode(ktp.id, 'ktp', (k) => void (k.hvKv = kv))}>
                {kv} {t('unit.kv')}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('ktp.hvActual')}>
          <input
            inputMode="decimal"
            value={ktp.hvActualV}
            placeholder={String(hvNominalV(ktp.hvKv))}
            onChange={(e) => editNode(ktp.id, 'ktp', (k) => void (k.hvActualV = e.target.value), 'hvActual')}
          />
        </Field>
        <Field label={t('ktp.tap')}>
          <div className="seg tap-seg">
            {TAP_POSITIONS.map((tap) => (
              <button
                key={tap}
                className={ktp.tapPct === tap ? 'on' : ''}
                title={t('ktp.tapTitle', { tap: formatTap(tap) })}
                onClick={() => editNode(ktp.id, 'ktp', (k) => void (k.tapPct = tap))}
              >
                {formatTap(tap)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('ktp.groundOhm')}>
          <input
            inputMode="decimal"
            value={ktp.groundOhm}
            placeholder={String(KTP_GROUND_OHM)}
            title={t('ktp.groundOhmTitle')}
            onChange={(e) => editNode(ktp.id, 'ktp', (k) => void (k.groundOhm = e.target.value), 'groundOhm')}
          />
        </Field>
      </div>
      <p className="muted small">{t('ktp.tapHelp')}</p>
      {reading && (
        <div className="ktp-readings">
          <div>
            {t('ktp.noLoad')}: <b>{fmt(reading.noLoadVoltage)} {t('unit.v')}</b>
          </div>
          <div>
            {t('ktp.busbars')}: {phases.map((p) => `${p} ${fmt(reading.voltages[p])}`).join(' · ')} {t('unit.v')}
          </div>
          <div>
            {t('ktp.currents')}: {phases.map((p) => `${p} ${fmt(reading.currents[p])}`).join(' · ')} {t('unit.a')}
          </div>
          <div>
            {t('ktp.loading')}: <b>{fmt(reading.apparentVa / 1000)} {t('unit.kva')}</b>
            {reading.loadingPct !== null && (
              <b className={reading.loadingPct > 100 ? 'status-conflict' : ''}> ({fmt(reading.loadingPct, 0)}%)</b>
            )}
          </div>
          <div>
            {t('ktp.hvReading')}: {fmt(reading.hvVoltage / 1000, 2)} {t('unit.kv')} · {fmt(reading.hvCurrent, 2)} {t('unit.a')}
          </div>
          {reading.groundAmps > 0.005 && (
            <div>{t('ktp.groundReading', { a: fmt(reading.groundAmps, 2), v: fmt(reading.neutralV, 1) })}</div>
          )}
        </div>
      )}
    </Section>
  );
}

/** "+2.5%" / "0" / "−5%". */
export function formatTap(tap: number): string {
  if (tap === 0) return '0';
  return `${tap > 0 ? '+' : '−'}${Math.abs(tap).toLocaleString(currentLocale())}%`;
}
