import { store, useStore } from '../model/store';
import type { KtpNode, OutputRole } from '../model/types';
import { detachPort, makeFeeder, uid } from '../model/scheme';
import { portKey } from '../topology/trace';
import { Field, Section, TraceChip, editNode, editScheme } from './common';
import { feederLengths } from '../topology/distances';
import { formatLength } from '../i18n/labels';
import { useT, type MessageKey } from '../i18n';

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
          <Field label={t('ktp.power')}>
            <input
              value={ktp.powerKva}
              onChange={(e) => editNode(ktp.id, 'ktp', (k) => void (k.powerKva = e.target.value), 'power')}
            />
          </Field>
        </div>
      </Section>

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
                onClick={() => {
                  if (!confirm(t('ktp.removeFeederConfirm', { name: f.name }))) return;
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
