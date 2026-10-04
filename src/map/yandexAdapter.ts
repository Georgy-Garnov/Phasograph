import type { YMap, YMapFeature, YMapMarker } from '@yandex/ymaps3-types';
import type { MapEvent } from '@yandex/ymaps3-types/imperative/YMapFeature/types';
import type { LngLat, MapView } from '../model/types';
import { DiffingAdapter, type MapEvents } from './adapter';
import type { FeatureSpec, MarkerSpec } from './scene';
import { clickedPart } from './leafletAdapter';

const BEHAVIORS = ['drag', 'pinchZoom', 'scrollZoom'] as const;

/** Yandex Maps JS API v3 adapter. Requires ymaps3 to be loaded. */
export class YandexAdapter extends DiffingAdapter<{ entity: YMapMarker; el: HTMLElement }, YMapFeature> {
  private map: YMap;
  private currentZoom: number;

  constructor(container: HTMLElement, view: MapView, private events: MapEvents) {
    super();
    const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapListener } = ymaps3;
    this.currentZoom = view.zoom;
    this.map = new YMap(container, {
      location: { center: view.center, zoom: view.zoom },
      behaviors: [...BEHAVIORS, 'dblClick'],
      zoomRange: { min: 3, max: 21 },
    });
    this.map.addChild(new YMapDefaultSchemeLayer({}));
    this.map.addChild(new YMapDefaultFeaturesLayer({}));
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
    return {
      geometry: spec.geometry,
      style: {
        stroke: [spec.stroke],
        fill: spec.fill,
        zIndex: spec.zIndex,
        interactive: !!target,
        simplificationRate: 0,
        cursor: target ? 'pointer' : undefined,
      },
      onClick: target
        ? (_e: MouseEvent, mapEvent: MapEvent) =>
            this.events.featureClick(target, [mapEvent.coordinates[0], mapEvent.coordinates[1]])
        : undefined,
    };
  }
}
