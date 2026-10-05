import L from 'leaflet';
import type { BaseLayer } from '../model/store';
import type { LngLat, MapView } from '../model/types';
import { DiffingAdapter, type MapEvents } from './adapter';
import { t } from '../i18n';
import type { FeatureSpec, FeatureTarget, MarkerSpec } from './scene';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const esriLayer = (service: string, attribution?: string) =>
  L.tileLayer(`${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 19, maxZoom: 21, crossOrigin: true, attribution });

const BASE_LAYERS: Record<BaseLayer, () => L.Layer> = {
  osm: () =>
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19,
      maxZoom: 21,
      // CORS request: the service worker can cache such a response for offline use without inflating the quota.
      crossOrigin: true,
      attribution: `&copy; <a href="https://www.openstreetmap.org/copyright">${t('map.osmAttribution')}</a>`,
    }),
  satellite: () => esriLayer('World_Imagery', `${t('map.esriAttribution')} &copy; Esri, Maxar, Earthstar Geographics`),
  // Hybrid: satellite imagery with transparent road and place-name reference layers on top.
  hybrid: () =>
    L.layerGroup([
      esriLayer('World_Imagery', `${t('map.esriAttribution')} &copy; Esri, Maxar, Earthstar Geographics`),
      esriLayer('Reference/World_Transportation'),
      esriLayer('Reference/World_Boundaries_and_Places'),
    ]),
};

/** Which part of the marker was clicked (the luminaire icon on a pole or the marker itself). */
export function clickedPart(e: Event | undefined): 'lamp' | undefined {
  return e?.target instanceof Element && e.target.closest('.lamp') ? 'lamp' : undefined;
}

const toLatLng = ([lng, lat]: LngLat): L.LatLngTuple => [lat, lng];
const toLngLat = (ll: L.LatLng): LngLat => [ll.lng, ll.lat];

interface MarkerHandle {
  marker: L.Marker;
  el: HTMLElement;
}

interface FeatureHandle {
  layer: L.Path;
  target: FeatureTarget | null;
}

/** Leaflet adapter: free OpenStreetMap and Esri satellite base layers, no key required. */
export class LeafletAdapter extends DiffingAdapter<MarkerHandle, FeatureHandle> {
  private map: L.Map;
  private base: L.Layer;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, view: MapView, baseLayer: BaseLayer, private events: MapEvents) {
    super();
    this.map = L.map(container, { center: toLatLng(view.center), zoom: Math.round(view.zoom), maxZoom: 21 });
    // Leaflet does not notice container size changes (e.g. sidebar resize) on its own.
    this.resizeObserver = new ResizeObserver(() => this.map.invalidateSize({ pan: false }));
    this.resizeObserver.observe(container);
    this.base = BASE_LAYERS[baseLayer]().addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => events.mapClick(toLngLat(e.latlng)));
    this.map.on('dblclick', () => events.mapDblClick());
    this.map.on('mousemove', (e: L.LeafletMouseEvent) => events.mouseMove(toLngLat(e.latlng)));
    this.map.on('zoom', () => events.zoomChange(this.map.getZoom()));
    this.map.on('moveend', () => events.viewChange({ center: toLngLat(this.map.getCenter()), zoom: this.map.getZoom() }));
  }

  get zoom() {
    return this.map.getZoom();
  }

  setBaseLayer(layer: BaseLayer) {
    this.base.remove();
    this.base = BASE_LAYERS[layer]().addTo(this.map);
  }

  setDrawing(drawing: boolean) {
    if (drawing) this.map.doubleClickZoom.disable();
    else this.map.doubleClickZoom.enable();
  }

  flyTo(center: LngLat, zoom?: number) {
    this.map.setView(toLatLng(center), zoom ?? Math.max(this.map.getZoom(), 18));
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.map.remove();
  }

  /** A separate pane for each z-order level (below markers, which have zIndex 600). */
  private pane(zIndex: number): string {
    const name = `z${zIndex}`;
    if (!this.map.getPane(name)) this.map.createPane(name).style.zIndex = String(400 + Math.round(zIndex / 10));
    return name;
  }

  protected addMarker(spec: MarkerSpec): MarkerHandle {
    const el = document.createElement('div');
    this.fillMarker(el, spec);
    const marker = L.marker(toLatLng(spec.coords), {
      icon: L.divIcon({ className: 'node-icon', html: el, iconSize: [0, 0] }),
      draggable: spec.draggable,
      zIndexOffset: spec.zIndex * 100,
      keyboard: false,
    });
    const id = spec.id;
    marker.on('click', (e) => this.events.markerClick(id, clickedPart(e.originalEvent)));
    marker.on('drag', () => this.events.markerDrag(id, toLngLat(marker.getLatLng())));
    marker.on('dragend', () => this.events.markerDragEnd(id, toLngLat(marker.getLatLng())));
    marker.addTo(this.map);
    return { marker, el };
  }

  protected updateMarker(handle: MarkerHandle, spec: MarkerSpec) {
    this.fillMarker(handle.el, spec);
    handle.marker.setLatLng(toLatLng(spec.coords));
    handle.marker.setZIndexOffset(spec.zIndex * 100);
    if (spec.draggable) handle.marker.dragging?.enable();
    else handle.marker.dragging?.disable();
  }

  protected removeMarker(handle: MarkerHandle) {
    handle.marker.remove();
  }

  private fillMarker(el: HTMLElement, spec: MarkerSpec) {
    el.className = spec.className;
    el.innerHTML = spec.html;
    el.title = spec.title;
  }

  protected addFeature(_id: string, spec: FeatureSpec): FeatureHandle {
    const handle: FeatureHandle = { layer: this.createLayer(spec), target: spec.target };
    this.bind(handle);
    return handle;
  }

  protected updateFeature(handle: FeatureHandle, spec: FeatureSpec) {
    handle.target = spec.target;
    // A Leaflet layer's pane (z-order) cannot be changed, so recreate it.
    if (handle.layer.options.pane !== this.pane(spec.zIndex) || handle.layer.options.interactive !== !!spec.target) {
      handle.layer.remove();
      handle.layer = this.createLayer(spec);
      this.bind(handle);
      return;
    }
    (handle.layer as L.Polyline).setLatLngs(this.latLngs(spec));
    handle.layer.setStyle(this.style(spec));
  }

  protected removeFeature(handle: FeatureHandle) {
    handle.layer.remove();
  }

  private bind(handle: FeatureHandle) {
    handle.layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (handle.target) this.events.featureClick(handle.target, toLngLat((e as L.LeafletMouseEvent).latlng));
    });
  }

  private latLngs(spec: FeatureSpec) {
    return spec.geometry.type === 'Polygon'
      ? spec.geometry.coordinates.map((ring) => ring.map(toLatLng))
      : spec.geometry.coordinates.map(toLatLng);
  }

  private style(spec: FeatureSpec): L.PathOptions {
    return {
      color: spec.stroke.color,
      weight: spec.stroke.width,
      opacity: spec.stroke.opacity ?? 1,
      dashArray: spec.stroke.dash?.join(' ') ?? '',
      fill: !!spec.fill,
      fillColor: spec.fill,
      fillOpacity: 1,
    };
  }

  private createLayer(spec: FeatureSpec): L.Path {
    const options: L.PolylineOptions = {
      ...this.style(spec),
      pane: this.pane(spec.zIndex),
      interactive: !!spec.target,
      bubblingMouseEvents: false,
    };
    const layer =
      spec.geometry.type === 'Polygon'
        ? L.polygon(this.latLngs(spec) as L.LatLngTuple[][], options)
        : L.polyline(this.latLngs(spec) as L.LatLngTuple[], options);
    return layer.addTo(this.map);
  }
}
