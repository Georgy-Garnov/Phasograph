import type { LngLat, MapView } from '../model/types';
import type { FeatureSpec, FeatureTarget, MarkerSpec, Scene } from './scene';

/** Map events the adapter forwards to the app. */
export interface MapEvents {
  mapClick(coords: LngLat): void;
  mapDblClick(): void;
  mouseMove(coords: LngLat): void;
  /** Zoom changed (including during animation). */
  zoomChange(zoom: number): void;
  /** The map stopped after moving. */
  viewChange(view: MapView): void;
  /** part = 'lamp' — the click hit the luminaire icon on a pole. */
  markerClick(id: string, part?: 'lamp'): void;
  /** Fired continuously while a marker is dragged. */
  markerDrag(id: string, coords: LngLat): void;
  markerDragEnd(id: string, coords: LngLat): void;
  featureClick(target: FeatureTarget, coords: LngLat): void;
}

export interface MapAdapter {
  readonly zoom: number;
  apply(scene: Scene): void;
  applyPreview(features: Map<string, FeatureSpec>): void;
  setDrawing(drawing: boolean): void;
  flyTo(center: LngLat, zoom?: number): void;
  destroy(): void;
}

const featureSig = (f: FeatureSpec) => JSON.stringify([f.geometry, f.stroke, f.fill, f.zIndex, f.target]);
const markerSig = (m: MarkerSpec) => JSON.stringify([m.coords, m.className, m.html, m.title, m.draggable, m.zIndex]);

/**
 * Base adapter: keeps created map objects and updates only the changed ones.
 * Subclasses implement creating/updating/removing objects for a specific provider.
 */
export abstract class DiffingAdapter<M, F> implements MapAdapter {
  private markers = new Map<string, { handle: M; sig: string }>();
  private groups = { main: new Map<string, { handle: F; sig: string }>(), preview: new Map<string, { handle: F; sig: string }>() };

  abstract readonly zoom: number;
  abstract setDrawing(drawing: boolean): void;
  abstract flyTo(center: LngLat, zoom?: number): void;
  abstract destroy(): void;

  protected abstract addMarker(spec: MarkerSpec): M;
  protected abstract updateMarker(handle: M, spec: MarkerSpec): void;
  protected abstract removeMarker(handle: M): void;
  protected abstract addFeature(id: string, spec: FeatureSpec): F;
  protected abstract updateFeature(handle: F, spec: FeatureSpec): void;
  protected abstract removeFeature(handle: F): void;

  apply(scene: Scene) {
    const seen = new Set<string>();
    for (const spec of scene.markers) {
      seen.add(spec.id);
      const sig = markerSig(spec);
      const cur = this.markers.get(spec.id);
      if (cur?.sig === sig) continue;
      if (cur) {
        this.updateMarker(cur.handle, spec);
        cur.sig = sig;
      } else this.markers.set(spec.id, { handle: this.addMarker(spec), sig });
    }
    for (const [id, m] of this.markers) {
      if (!seen.has(id)) {
        this.removeMarker(m.handle);
        this.markers.delete(id);
      }
    }
    this.applyGroup('main', scene.features);
  }

  applyPreview(features: Map<string, FeatureSpec>) {
    this.applyGroup('preview', features);
  }

  private applyGroup(name: 'main' | 'preview', specs: Map<string, FeatureSpec>) {
    const group = this.groups[name];
    for (const [id, spec] of specs) {
      const sig = featureSig(spec);
      const cur = group.get(id);
      if (cur?.sig === sig) continue;
      if (cur) {
        this.updateFeature(cur.handle, spec);
        cur.sig = sig;
      } else group.set(id, { handle: this.addFeature(id, spec), sig });
    }
    for (const [id, f] of group) {
      if (!specs.has(id)) {
        this.removeFeature(f.handle);
        group.delete(id);
      }
    }
  }
}
