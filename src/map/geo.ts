import type { LngLat } from '../model/types';

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320;

/** Meters per pixel at the given zoom (256 px tiles, Web Mercator). */
export function metersPerPixel(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Shifts a segment perpendicular to its direction by offset meters (positive is to the left of travel). */
export function offsetSegment(a: LngLat, b: LngLat, offset: number): [LngLat, LngLat] {
  if (offset === 0) return [a, b];
  const cos = Math.cos((a[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * cos * M_PER_DEG_LNG;
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * offset;
  const ny = (dx / len) * offset;
  const dLng = nx / (cos * M_PER_DEG_LNG);
  const dLat = ny / M_PER_DEG_LAT;
  return [
    [a[0] + dLng, a[1] + dLat],
    [b[0] + dLng, b[1] + dLat],
  ];
}
