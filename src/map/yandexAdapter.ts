import type { DrawingStyle, YMap, YMapFeature, YMapMarker } from '@yandex/ymaps3-types';
import type { BaseLayer } from '../model/store';
import type { MapEvent } from '@yandex/ymaps3-types/imperative/YMapFeature/types';
import type { LngLat, MapView } from '../model/types';
import { DiffingAdapter, type MapEvents } from './adapter';
import type { FeatureSpec, MarkerSpec } from './scene';
import { clickedPart } from './leafletAdapter';

const BEHAVIORS = ['drag', 'pinchZoom', 'scrollZoom'] as const;

/** Scheme customization that hides all geometry and keeps only labels (for the hybrid mode). */
const LABELS_ONLY = [{ elements: 'geometry', stylers: [{ visibility: 'off' }] }];

function withoutUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * The satellite layer exists in the ymaps3 runtime but is not declared in @yandex/ymaps3-types,
 * so it is looked up at runtime and may be missing in some API builds.
 */
type LayerEntity = Parameters<YMap['addChild']>[0] & { update(props: { visible: boolean }): void };
function satelliteLayerClass(): (new (props: { visible: boolean }) => LayerEntity) | undefined {
  return (ymaps3 as unknown as Record<string, unknown>).YMapDefaultSatelliteLayer as
    | (new (props: { visible: boolean }) => LayerEntity)
    | undefined;
}

/** Yandex Maps JS API v3 adapter. Requires ymaps3 to be loaded. */
export class YandexAdapter extends DiffingAdapter<{ entity: YMapMarker; el: HTMLElement }, YMapFeature> {
  private map: YMap;
  private currentZoom: number;
  private scheme: LayerEntity;
  private satellite: LayerEntity | null = null;

  constructor(container: HTMLElement, view: MapView, baseLayer: BaseLayer, private events: MapEvents) {
    super();
    const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapListener } = ymaps3;
    this.currentZoom = view.zoom;
    this.map = new YMap(container, {
      location: { center: view.center, zoom: view.zoom },
      behaviors: [...BEHAVIORS, 'dblClick'],
      zoomRange: { min: 3, max: 21 },
    });
    this.scheme = new YMapDefaultSchemeLayer({}) as unknown as LayerEntity;
    this.map.addChild(this.scheme);
    const Satellite = satelliteLayerClass();
    if (Satellite) {
      this.satellite = new Satellite({ visible: false });
      this.map.addChild(this.satellite);
    }
    this.setBaseLayer(baseLayer);
    // Explicit z-index keeps our lines and markers above the base layers (the satellite layer otherwise covers them).
    this.map.addChild(new YMapDefaultFeaturesLayer({ zIndex: 1800 }));
    this.map.addChild(
      new YMapListener({
        layer: 'any',
        onClick: (object, event) => {
          // Clicks on our markers/lines are handled by their own handlers.
          if (object?.type === 'marker' || object?.type === 'feature') return;
          events.mapClick(event.coordinates as LngLat);
        },
        onDblClick: () => events.mapDblClick(),
        onMouseMove: (_object, event) => events.mouseMove(event.coordinates as LngLat),
        onUpdate: ({ location, mapInAction }) => {
          this.currentZoom = location.zoom;
          events.zoomChange(location.zoom);
          if (!mapInAction) events.viewChange({ center: location.center as LngLat, zoom: location.zoom });
        },
      }),
    );
  }

  get zoom() {
    return this.currentZoom;
  }

  get satelliteSupported() {
    return this.satellite !== null;
  }

  /**
   * Scheme, satellite or hybrid (satellite with the scheme's labels on top: the scheme stays visible but all its
   * geometry is hidden by customization). Falls back to the scheme when the satellite layer is unavailable.
   */
  setBaseLayer(layer: BaseLayer) {
    const mode = layer !== 'osm' && this.satellite !== null ? layer : 'osm';
    this.satellite?.update({ visible: mode !== 'osm' });
    this.scheme.update({
      visible: mode !== 'satellite',
      customization: mode === 'hybrid' ? LABELS_ONLY : [],
    } as never);
  }

  setDrawing(drawing: boolean) {
    this.map.setBehaviors(drawing ? [...BEHAVIORS] : [...BEHAVIORS, 'dblClick']);
  }

  flyTo(center: LngLat, zoom?: number) {
    this.map.setLocation({ center, zoom: zoom ?? Math.max(this.currentZoom, 18), duration: 300 });
  }

  destroy() {
    this.map.destroy();
  }

  protected addMarker(spec: MarkerSpec) {
    const el = document.createElement('div');
    this.fillMarker(el, spec);
    const id = spec.id;
    const entity = new ymaps3.YMapMarker(
      {
        coordinates: spec.coords,
        draggable: spec.draggable,
        zIndex: spec.zIndex,
        onClick: (e) => this.events.markerClick(id, clickedPart(e)),
        onDragMove: (coords) => this.events.markerDrag(id, coords as LngLat),
        onDragEnd: (coords) => this.events.markerDragEnd(id, coords as LngLat),
      },
      el,
    );
    this.map.addChild(entity);
    return { entity, el };
  }

  protected updateMarker(handle: { entity: YMapMarker; el: HTMLElement }, spec: MarkerSpec) {
    this.fillMarker(handle.el, spec);
    handle.entity.update({ coordinates: spec.coords, draggable: spec.draggable, zIndex: spec.zIndex });
  }

  protected removeMarker(handle: { entity: YMapMarker }) {
    this.map.removeChild(handle.entity);
  }

  private fillMarker(el: HTMLElement, spec: MarkerSpec) {
    el.className = spec.className;
    el.innerHTML = spec.html;
    el.title = spec.title;
  }

  protected addFeature(id: string, spec: FeatureSpec) {
    const entity = new ymaps3.YMapFeature({ id, ...this.featureProps(spec) });
    this.map.addChild(entity);
    return entity;
  }

  protected updateFeature(handle: YMapFeature, spec: FeatureSpec) {
    handle.update(this.featureProps(spec));
  }

  protected removeFeature(handle: YMapFeature) {
    this.map.removeChild(handle);
  }

  private featureProps(spec: FeatureSpec) {
    const target = spec.target;
    // ymaps3 iterates any present style key (e.g. `dash`), so undefined values must be omitted, not passed.
    const style: DrawingStyle = { stroke: [withoutUndefined(spec.stroke)], zIndex: spec.zIndex, interactive: !!target, simplificationRate: 0 };
    if (spec.fill) style.fill = spec.fill;
    if (target) style.cursor = 'pointer';
    return {
      geometry: spec.geometry,
      style,
      onClick: target
        ? (_e: MouseEvent, mapEvent: MapEvent) =>
            this.events.featureClick(target, [mapEvent.coordinates[0], mapEvent.coordinates[1]])
        : undefined,
    };
  }
}
