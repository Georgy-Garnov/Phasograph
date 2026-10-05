/**
 * Distribution transformers 6(10)/0.4 kV: standard ratings and typical nameplate data used to model the
 * busbar voltage — short-circuit voltage uk (%) and load (copper) losses Pk (kW), Dyn11/Yyn0 class.
 */
import type { HvKv, KtpNode } from './types';

export interface TransformerData {
  kva: number;
  /** Short-circuit voltage, %. */
  uk: number;
  /** Load losses at rated current, kW. */
  pk: number;
}

const DATA: TransformerData[] = [
  { kva: 25, uk: 4.5, pk: 0.6 },
  { kva: 40, uk: 4.5, pk: 0.88 },
  { kva: 63, uk: 4.5, pk: 1.28 },
  { kva: 100, uk: 4.5, pk: 1.97 },
  { kva: 160, uk: 4.5, pk: 2.65 },
  { kva: 250, uk: 4.5, pk: 3.7 },
  { kva: 400, uk: 4.5, pk: 5.5 },
  { kva: 630, uk: 5.5, pk: 7.6 },
  { kva: 1000, uk: 5.5, pk: 10.8 },
  { kva: 1250, uk: 6, pk: 13.5 },
  { kva: 1600, uk: 6, pk: 16.5 },
  { kva: 2500, uk: 6, pk: 25 },
];

export const TRANSFORMER_RATINGS = DATA.map((d) => d.kva);
/** Off-circuit tap changer positions, % of the HV winding turns. */
export const TAP_POSITIONS = [5, 2.5, 0, -2.5, -5];
/** Nominal LV no-load voltage: 0.4 kV line → 230.9 V phase. */
export const LV_NOMINAL_LINE = 400;
export const LV_NOMINAL_PHASE = LV_NOMINAL_LINE / Math.sqrt(3);

export function transformerData(ktp: Pick<KtpNode, 'powerKva'>): TransformerData | null {
  const kva = Number(String(ktp.powerKva).replace(',', '.'));
  return DATA.find((d) => d.kva === kva) ?? null;
}

/** "КТП-250/10/0.4"-style type designation (prefix is localized by the caller). */
export function transformerType(ktp: Pick<KtpNode, 'powerKva' | 'hvKv'>, prefix: string): string {
  const d = transformerData(ktp);
  return d ? `${prefix}-${d.kva}/${ktp.hvKv}/0,4` : `${prefix}-…/${ktp.hvKv}/0,4`;
}

export function hvNominalV(hvKv: HvKv): number {
  return hvKv * 1000;
}

/** Actual HV supply voltage, V (the nominal one when not set). */
export function hvActualV(ktp: Pick<KtpNode, 'hvKv' | 'hvActualV'>): number {
  const v = Number(String(ktp.hvActualV).replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : hvNominalV(ktp.hvKv);
}

/**
 * No-load LV phase voltage: the ratio is set by the tap (a "+5%" tap adds HV turns and lowers the LV voltage),
 * U0 = 230.9 · (U_hv / U_hv_nom) / (1 + tap).
 */
export function noLoadPhaseVoltage(ktp: Pick<KtpNode, 'hvKv' | 'hvActualV' | 'tapPct'>): number {
  return (LV_NOMINAL_PHASE * (hvActualV(ktp) / hvNominalV(ktp.hvKv))) / (1 + ktp.tapPct / 100);
}

/** Per-phase short-circuit impedance referred to 0.4 kV, Ohm: [R, X]. */
export function transformerImpedance(data: TransformerData): [number, number] {
  const s = data.kva * 1000;
  const z = (data.uk / 100) * (LV_NOMINAL_LINE ** 2 / s);
  const r = (data.pk * 1000 * LV_NOMINAL_LINE ** 2) / s ** 2;
  return [r, Math.sqrt(Math.max(z * z - r * r, 0))];
}
