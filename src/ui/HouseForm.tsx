import { store, useStore } from '../model/store';
import type { HouseNode, Phase, PhaseMode } from '../model/types';
import { PHASES } from '../model/constants';
import { distanceMeters, linesAt, uid } from '../model/scheme';
import { refreshAddress } from '../map/interactions';
import type { HouseStatus, HouseTrace } from '../topology/trace';
import { Field, KtpDistanceInfo, NodeLink, RoleChip, Section, editNode, editScheme } from './common';
import { lineLength } from '../topology/distances';
import { formatLength, nodeName } from '../i18n/labels';
import { t as tr, useT, type MessageKey } from '../i18n';

/** Status label; a phase found only via manual marking (no connection to a TS) is labeled separately. */
export function statusLabel(h: HouseTrace): string {
  if (h.status === 'ok' && h.feeders.length === 0) return tr('house.status.byMarks');
  return tr(`house.status.${h.status satisfies HouseStatus}` as MessageKey);
}

/** Consumer form. Used in the house card and in the service drop editor. */
export function HouseForm({ house, compact = false }: { house: HouseNode; compact?: boolean }) {
  const tr = useT();
  const trace = useStore((s) => s.trace);
  const scheme = useStore((s) => s.scheme);
  const t = trace.houses.get(house.id);
  const feederNames = (t?.feeders ?? []).map((f) => trace.feeders.get(f)?.name ?? f);
  const entries = Object.values(scheme.nodes).filter((n) => n.kind === 'entry' && n.houseId === house.id);
  const drops = [house, ...entries].flatMap((n) => linesAt(scheme, n.id)).filter((l) => l.kind === 'drop');

  const setPhaseMode = (mode: PhaseMode) =>
    editScheme((d) => {
      const h = d.nodes[house.id];
      if (h?.kind !== 'house') return;
      h.phaseMode = mode;
      if (mode === '3') h.manualPhase = null;
      // Adjust the number of service drop wires: 1-phase — phase + neutral, 3-phase — A, B, C, N.
      const want = mode === '3' ? 4 : 2;
      for (const l of Object.values(d.lines)) {
        if (l.kind !== 'drop' || (l.to !== house.id && !entries.some((e) => e.id === l.to))) continue;
        if (l.suspension === 'sip') continue;
        while (l.wires.length < want) l.wires.push({ id: uid('w'), fromPort: null, toPort: null });
        if (l.wires.length > want) l.wires = mode === '1' ? [l.wires[0], l.wires[l.wires.length - 1]] : l.wires.slice(0, want);
      }
    });

  return (
    <Section title={compact ? tr('house.subscriber') : tr('house.title')}>
      <Field label={tr('house.address')}>
        <div className="row">
          <input
            value={house.address}
            placeholder={tr('house.addressPlaceholder')}
            onChange={(e) =>
              editNode(house.id, 'house', (h) => {
                h.address = e.target.value;
                h.addressSource = 'manual';
              }, 'address')
            }
          />
          <button
            title={tr('house.geocodeTitle')}
            onClick={() => {
              editNode(house.id, 'house', (h) => void (h.addressSource = null));
              refreshAddress(house.id);
            }}
          >
            ⟳
          </button>
        </div>
        {house.addressSource === 'geocoder' && <small className="muted">{tr('house.fromGeocoder')}</small>}
      </Field>
      <div className="grid2">
        <Field label={tr('house.connType')}>
          <div className="seg">
            {(['1', '3'] as PhaseMode[]).map((m) => (
              <button key={m} className={house.phaseMode === m ? 'on' : ''} onClick={() => setPhaseMode(m)}>
                {m === '1' ? tr('house.single') : tr('house.three')}
              </button>
            ))}
          </div>
        </Field>
        <Field label={tr('house.meter')}>
          <input
            value={house.meterNumber}
            onChange={(e) => editNode(house.id, 'house', (h) => void (h.meterNumber = e.target.value), 'meter')}
          />
        </Field>
      </div>

      {house.phaseMode === '1' ? (
        <Field label={tr('house.phase')}>
          <div className="seg">
            {PHASES.map((p) => {
              const computed = t?.computedPhases.length === 1 && t.computedPhases[0] === p;
              const active = t?.effectivePhases.length === 1 && t.effectivePhases[0] === p;
              return (
                <button
                  key={p}
                  className={`${active ? 'on' : ''} phase-${p}`}
                  title={computed ? tr('house.phaseComputedTitle') : tr('house.phaseManualTitle')}
                  onClick={() =>
                    editNode(house.id, 'house', (h) => void (h.manualPhase = h.manualPhase === p ? null : (p as Phase)))
                  }
                >
                  {p}
                  {computed ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
          {t && t.computedPhases.length === 1 && (
            <small className="muted">
              {tr('house.computedFrom')} <b>{t.computedPhases[0]}</b>
              {house.manualPhase && house.manualPhase !== t.computedPhases[0] && tr('house.manualMismatch')}
            </small>
          )}
        </Field>
      ) : (
        <p className="muted">
          {tr('house.threeInfo')}{' '}
          {t?.computedPhases.length ? tr('house.traced', { phases: t.computedPhases.join(', ') }) : ''}
        </p>
      )}

      <div className="status-line">
        {t && (
          <>
            {(t.effectivePhases.length ? t.effectivePhases : [null]).map((p, i) => (
              <RoleChip key={i} role={p} />
            ))}
            <span className={`status status-${t.status}`}>{statusLabel(t)}</span>
            {feederNames.length > 0 && <span className="muted">· {feederNames.join(', ')}</span>}
            {t.dropCount > 0 && !t.hasNeutral && <span className="status status-conflict">{tr('house.noNeutral')}</span>}
          </>
        )}
      </div>

      <div className="stats">
        <KtpDistanceInfo nodeId={house.id} />
        {drops.length > 0 && (
          <span>
            {drops.length > 1 ? tr('house.drops') : tr('house.drop')}: <b>{drops.map((l) => formatLength(lineLength(scheme, l))).join(', ')}</b>
          </span>
        )}
      </div>

      {!compact && (
        <>
          <Field label={tr('common.note')}>
            <textarea
              rows={2}
              value={house.note}
              onChange={(e) => editNode(house.id, 'house', (h) => void (h.note = e.target.value), 'note')}
            />
          </Field>
          <div className="muted small">
            {house.contour ? tr('house.contourInfo', { n: house.contour.length }) : tr('house.pointInfo')} ·{' '}
            {tr('house.dropsCount', { n: drops.length })}
            {entries.length > 0 && tr('house.entries')}
            {entries.map((e) => (
              <NodeLink key={e.id} node={e} />
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

export function EntryEditor({ entryId }: { entryId: string }) {
  const tr = useT();
  const scheme = useStore((s) => s.scheme);
  const entry = scheme.nodes[entryId];
  if (entry?.kind !== 'entry') return null;
  const house = entry.houseId ? scheme.nodes[entry.houseId] : undefined;
  const houses = Object.values(scheme.nodes)
    .filter((n): n is HouseNode => n.kind === 'house')
    .map((h) => ({ h, d: distanceMeters(h.coords, entry.coords) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 30);
  return (
    <>
      <Section title={tr('entry.title')}>
        <Field label={tr('entry.house')}>
          <select
            value={entry.houseId ?? ''}
            onChange={(e) => editNode(entry.id, 'entry', (n) => void (n.houseId = e.target.value || null))}
          >
            <option value="">{tr('entry.unlinked')}</option>
            {houses.map(({ h, d }) => (
              <option key={h.id} value={h.id}>
                {nodeName(h)} ({Math.round(d)} {tr('unit.m')})
              </option>
            ))}
          </select>
        </Field>
        {house?.kind === 'house' && (
          <button className="link" onClick={() => store.set({ selection: { type: 'node', id: house.id } })}>
            {tr('entry.openHouse')}
          </button>
        )}
      </Section>
      {house?.kind === 'house' && <HouseForm house={house} compact />}
    </>
  );
}
