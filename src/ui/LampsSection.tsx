import { useEffect, useRef } from 'react';
import { store, useStore } from '../model/store';
import { removeLamp } from '../map/interactions';
import type { Lamp, LampKind, PoleNode } from '../model/types';
import { t as tr, useT, type MessageKey } from '../i18n';
import { portLabel } from '../i18n/labels';
import { polePorts, portMark } from '../model/sip';

const LAMP_KINDS: LampKind[] = ['led', 'dnat', 'drl', 'other'];
import { addLamp, sortInsulators } from '../model/scheme';
import { portKey, type LampStatus } from '../topology/trace';
import { RoleChip, Section, editNode } from './common';

export const lampStatusLabel = (status: LampStatus): string => tr(`lamp.status.${status}` as MessageKey);

/** Pole card section: street lighting luminaires and their connections to insulators. */
export function LampsSection({ pole }: { pole: PoleNode }) {
  const t = useT();
  const trace = useStore((s) => s.trace);
  const selectedLamp = useStore((s) => s.selectedLamp);
  const sectionRef = useRef<HTMLDivElement>(null);
  // Clicking a luminaire icon on the map scrolls the card to the luminaires section.
  useEffect(() => {
    if (selectedLamp && pole.lamps.some((l) => l.id === selectedLamp)) {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedLamp, pole.lamps]);
  const ports = polePorts(pole, sortInsulators(pole.insulators));

  const editLamp = (id: string, fn: (l: Lamp) => void, coalesce?: string) =>
    editNode(
      pole.id,
      pole.kind,
      (p) => {
        const l = p.lamps.find((x) => x.id === id);
        if (l) fn(l);
      },
      coalesce && `${id}:${coalesce}`,
    );

  const roleOf = (insId: string) => {
    const pt = trace.ports.get(portKey(pole.id, insId));
    if (pt && !pt.conflict && pt.roles.length === 1) return pt.roles[0];
    return portMark(pole, insId);
  };

  const portOptions = (
    <>
      <option value="">{t('lamp.notConnected')}</option>
      {ports.map((p) => {
        const r = roleOf(p);
        return (
          <option key={p} value={p}>
            {portLabel(pole, p)}
            {r ? ` (${r === 'L' ? t('lamp.roleLighting') : r === 'P' ? t('lamp.rolePhaseUnknown') : r})` : ''}
          </option>
        );
      })}
    </>
  );

  return (
    <div ref={sectionRef}>
    <Section
      title={t('lamp.section')}
      actions={
        <button onClick={() => editNode(pole.id, pole.kind, (p) => void addLamp(p, roleOf))}>{t('lamp.add')}</button>
      }
    >
      {pole.lamps.length === 0 && <p className="muted">{t('lamp.none')}</p>}
      {pole.lamps.map((lamp, k) => {
        const lt = trace.lamps.get(lamp.id);
        return (
          <div
            key={lamp.id}
            className={`lamp-card${selectedLamp === lamp.id ? ' selected' : ''}`}
            onClick={() => store.set({ selectedLamp: lamp.id })}
          >
            <div className="row">
              <b>{t('lamp.title', { n: k + 1 })}</b>
              {lt && (
                <>
                  <RoleChip role={lt.supply} title={t('lamp.supplyWire')} />
                  <span className={`status ${lt.status === 'ok' ? 'status-ok' : lt.status === 'wrong' ? 'status-conflict' : 'status-sip'}`}>
                    {lampStatusLabel(lt.status)}
                  </span>
                </>
              )}
              <span className="spacer" />
              <button
                className="danger small-btn"
                title={t('lamp.removeTitle')}
                onClick={(e) => {
                  e.stopPropagation();
                  removeLamp(pole.id, lamp.id);
                }}
              >
                {t('lamp.remove')}
              </button>
            </div>
            <div className="grid2">
              <label className="field">
                <span>{t('lamp.type')}</span>
                <select value={lamp.kind} onChange={(e) => editLamp(lamp.id, (l) => void (l.kind = e.target.value as LampKind))}>
                  {LAMP_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`lamp.kind.${kind}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('lamp.power')}</span>
                <input
                  inputMode="numeric"
                  value={lamp.powerW}
                  onChange={(e) => editLamp(lamp.id, (l) => void (l.powerW = e.target.value), 'power')}
                />
              </label>
              <label className="field">
                <span>{t('lamp.supplyIns')}</span>
                <select
                  value={lamp.phasePort ?? ''}
                  className={lamp.phasePort ? '' : 'warn'}
                  onChange={(e) => editLamp(lamp.id, (l) => void (l.phasePort = e.target.value || null))}
                >
                  {portOptions}
                </select>
              </label>
              <label className="field">
                <span>{t('lamp.neutralIns')}</span>
                <select
                  value={lamp.neutralPort ?? ''}
                  className={lamp.neutralPort ? '' : 'warn'}
                  onChange={(e) => editLamp(lamp.id, (l) => void (l.neutralPort = e.target.value || null))}
                >
                  {portOptions}
                </select>
              </label>
            </div>
          </div>
        );
      })}
    </Section>
    </div>
  );
}
