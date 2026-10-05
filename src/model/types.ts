/** Geographic coordinate [longitude, latitude] — same order as in GeoJSON and Yandex Maps v3. */
export type LngLat = [number, number];

export type Phase = 'A' | 'B' | 'C';
/**
 * Conductor role: phase, neutral (N), lighting wire (L)
 * or P — "a phase, but unknown which" (manual marking only).
 */
export type Role = Phase | 'N' | 'L' | 'P';
/** Substation output role. SIP — output directly as an ABC bundle (cores are not distinguished). */
export type OutputRole = Role | 'SIP';

export type NodeKind = 'ktp' | 'pole10' | 'pole04' | 'poleService' | 'entry' | 'house';
export type PoleKind = 'pole10' | 'pole04' | 'poleService';
export type LineKind = 'line10' | 'line04' | 'drop' | 'lighting' | 'fiber';

interface NodeBase {
  id: string;
  coords: LngLat;
  name: string;
  note: string;
}

/** Substation feeder output (a separate wire leaving the 0.4 kV switchgear). */
export interface KtpOutput {
  id: string;
  /** Output number (1, 2, 3...). */
  index: number;
  role: OutputRole;
}

/** Feeder — a three-phase line leaving the substation. */
export interface Feeder {
  id: string;
  name: string;
  outputs: KtpOutput[];
}

/** Nominal high voltage of distribution transformers and HV lines/poles, kV. */
export type HvKv = 6 | 10;

export interface KtpNode extends NodeBase {
  kind: 'ktp';
  /** Transformer rating, kVA (one of the standard values, see TRANSFORMER_RATINGS; empty = unknown). */
  powerKva: string;
  /** Nominal high voltage of the transformer, kV. */
  hvKv: HvKv;
  /** Actual high-voltage supply, V (string as typed; empty = nominal) — to emulate HV sags. */
  hvActualV: string;
  /** Off-circuit tap changer position, % of the HV winding: -5, -2.5, 0, +2.5, +5. */
  tapPct: number;
  feeders: Feeder[];
}

/**
 * Insulator position: left/right of the pole axis (along the line), center — on the front of the pole body
 * (e.g. a branch on a T-shaped pole), or back — on the opposite face, behind the pole.
 */
export type Side = 'L' | 'R' | 'C' | 'B';
/** pin — pin insulator/hook for a separate wire; sipClamp — anchor/suspension clamp for an ABC bundle. */
export type InsulatorType = 'pin' | 'sipClamp';
/**
 * Core set of an ABC (SIP) cable: one phase + neutral, three phases + neutral,
 * or three phases + neutral + street lighting core.
 */
export type SipCores = '1+N' | '3+N' | '3+N+L';

export interface Insulator {
  id: string;
  side: Side;
  /** Ordinal number from the bottom: 1 is the lowest. */
  position: number;
  type: InsulatorType;
  /** Manual marking of the conductor on the insulator (the operator knows which wire it is). */
  mark?: Role | null;
  /**
   * ABC clamp: cores of the cable held by the clamp. Every core is a separate port `${id}:${k}` (see model/sip.ts);
   * a clamp without cores is a legacy bundle whose cores are not distinguished.
   */
  cores?: SipCores;
  /** ABC clamp: manual marking per core (same index as the cores). */
  coreMarks?: (Role | null)[];
}

/** Jumper (loop) on a pole between two insulators — used for switching at junctions. */
export interface Jumper {
  id: string;
  a: string;
  b: string;
}

export type LampKind = 'led' | 'dnat' | 'drl' | 'other';

/** Street lighting luminaire on a pole. */
export interface Lamp {
  id: string;
  kind: LampKind;
  /** Power, W (string — as entered). */
  powerW: string;
  /** Insulator the luminaire is fed from (lighting wire or a phase). */
  phasePort: string | null;
  /** Neutral wire insulator. */
  neutralPort: string | null;
}

export interface PoleNode extends NodeBase {
  kind: PoleKind;
  number: string;
  insulators: Insulator[];
  jumpers: Jumper[];
  /** Street lighting luminaires on the pole. */
  lamps: Lamp[];
  hasInternet: boolean;
  /** A fiber splice/junction box is mounted on the pole. */
  fiberBox: boolean;
  /**
   * Direction "forward along the line" in degrees clockwise from north; left/right insulator sides are
   * relative to it. null — derived automatically from the spans at the pole (see poleAzimuth).
   */
  azimuth: number | null;
}

/** Connection point (service entry) on the house facade. */
export interface EntryNode extends NodeBase {
  kind: 'entry';
  houseId: string | null;
}

export type PhaseMode = '1' | '3';

export interface HouseNode extends NodeBase {
  kind: 'house';
  /** Building outline (optional). If set, coords is its center. */
  contour: LngLat[] | null;
  address: string;
  addressSource: 'geocoder' | 'manual' | null;
  meterNumber: string;
  phaseMode: PhaseMode;
  /** Manually specified phase (for ABC or when tracing is unavailable). */
  manualPhase: Phase | null;
  /** Permitted/design connection power, kW (string as typed). */
  designPowerKw: string;
  /** Current consumption, kW (string as typed). */
  currentPowerKw: string;
  /**
   * Three-phase house: design and current load per phase, kW (strings as typed); null — the totals are split
   * equally over A, B, C. While set, designPowerKw/currentPowerKw are kept equal to the per-phase sums.
   */
  phaseLoads: PhaseLoads | null;
}

export type LoadKind = 'design' | 'current';
export type PhaseLoads = Record<LoadKind, Record<Phase, string>>;

export type SchemeNode = KtpNode | PoleNode | EntryNode | HouseNode;

/**
 * Wire on a span. Ports are a pole insulator id or a substation output id.
 * Ends at a service entry/house need no port (null).
 */
export interface Wire {
  id: string;
  fromPort: string | null;
  toPort: string | null;
}

export type Suspension = 'bare' | 'sip';

export interface SchemeLine {
  id: string;
  kind: LineKind;
  from: string;
  to: string;
  suspension: Suspension;
  wires: Wire[];
  /** Wire type/cross-section, e.g. "A-35" or "SIP-2 3x50+1x54.6". */
  mark: string;
  /** Conductor from the catalog used for voltage-drop calculation; null — default for the line type. */
  conductor: string | null;
  note: string;
}

export interface Scheme {
  nodes: Record<string, SchemeNode>;
  lines: Record<string, SchemeLine>;
}

export interface MapView {
  center: LngLat;
  zoom: number;
}
