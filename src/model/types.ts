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

export interface KtpNode extends NodeBase {
  kind: 'ktp';
  powerKva: string;
  feeders: Feeder[];
}

/**
 * Insulator position: left/right of the pole axis (along the line), center — on the front of the pole body
 * (e.g. a branch on a T-shaped pole), or back — on the opposite face, behind the pole.
 */
export type Side = 'L' | 'R' | 'C' | 'B';
/** pin — pin insulator/hook for a separate wire; sipClamp — anchor/suspension clamp for an ABC bundle. */
export type InsulatorType = 'pin' | 'sipClamp';

export interface Insulator {
  id: string;
  side: Side;
  /** Ordinal number from the bottom: 1 is the lowest. */
  position: number;
  type: InsulatorType;
  /** Manual marking of the conductor on the insulator (the operator knows which wire it is). */
  mark?: Role | null;
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
}

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
