import { useEffect, useRef, useState } from 'react';
import { store, useStore } from '../model/store';
import type { LngLat } from '../model/types';
import type { MapAdapter, MapEvents } from './adapter';
import { LeafletAdapter } from './leafletAdapter';
import { YandexAdapter } from './yandexAdapter';
import { clearApiKey, getApiKey, loadYmaps, saveApiKey } from './loader';
import { useT } from '../i18n';
import { buildPreview, buildScene } from './scene';
import {
  finishContour,
  focusedWires,
  handleFeatureClick,
  handleMapClick,
  handleNodeClick,
  moveNode,
  previewPoleRotation,
  rotatePoleTowards,
} from './interactions';

/** Map access from other parts of the UI (flying to an object, etc.). */
export const mapApi: { flyTo?: (c: LngLat, zoom?: number) => void } = {};

function YandexKeyForm({ onKey }: { onKey: (k: string) => void }) {
  const t = useT();
  const [value, setValue] = useState('');
  return (
    <form
      className="map-error"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        saveApiKey(value.trim());
        onKey(value.trim());
      }}
    >
      <p>
        {t('yandex.keyNeeded')} (
        <a href="https://developer.tech.yandex.ru/" target="_blank" rel="noreferrer">
          {t('yandex.cabinet')}
        </a>
        ).
      </p>
      <div className="row">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('yandex.keyPlaceholder')} autoFocus />
        <button type="submit">{t('yandex.open')}</button>
      </div>
      <button type="button" className="link" onClick={() => store.setSettings({ mapProvider: 'leaflet' })}>
        {t('yandex.backToOsm')}
      </button>
    </form>
  );
}

export function MapView() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  const provider = useStore((s) => s.settings.mapProvider);
  const baseLayer = useStore((s) => s.settings.baseLayer);
  const [apiKey, setApiKey] = useState(getApiKey());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (provider === 'yandex' && !apiKey) return;
    let adapter: MapAdapter | null = null;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    let cursor: LngLat | null = null;
    let renderedZoom = -1;

    const draw = () => {
      if (!adapter) return;
      const s = store.get();
      renderedZoom = adapter.zoom;
      // A provider error while drawing must not break the whole app: show it on the map instead.
      try {
        adapter.setDrawing(s.tool.type !== 'select');
        adapter.apply(buildScene(s, focusedWires(), adapter.zoom));
        adapter.applyPreview(buildPreview(s, cursor));
      } catch (e) {
        console.error(e);
        setError((e as Error).message || String(e));
      }
    };

    const events: MapEvents = {
      mapClick: handleMapClick,
      mapDblClick: () => {
        if (store.get().tool.type === 'houseContour') finishContour();
      },
      mouseMove: (c) => {
        cursor = c;
        const s = store.get();
        if (s.lineStart || s.contour.length) adapter?.applyPreview(buildPreview(s, cursor));
      },
      // The spacing between parallel wires is in pixels, so recompute it on zoom change.
      zoomChange: (z) => {
        if (Math.abs(z - renderedZoom) > 0.3) draw();
      },
      viewChange: (view) => store.set({ view }),
      markerClick: (id, part) => {
        if (!id.startsWith('rot:') && !id.startsWith('orient:')) handleNodeClick(id, part);
      },
      markerDrag: (id, coords) => {
        if (id.startsWith('rot:')) previewPoleRotation(id.slice(4), coords);
      },
      markerDragEnd: (id, coords) => {
        if (id.startsWith('rot:')) rotatePoleTowards(id.slice(4), coords);
        else moveNode(id, coords);
      },
      featureClick: handleFeatureClick,
    };

    const start = async () => {
      if (provider === 'yandex') await loadYmaps(apiKey);
      if (cancelled || !ref.current) return;
      const { view, settings } = store.get();
      adapter =
        provider === 'yandex'
          ? new YandexAdapter(ref.current, view, settings.baseLayer, events)
          : new LeafletAdapter(ref.current, view, settings.baseLayer, events);
      adapterRef.current = adapter;
      mapApi.flyTo = (c, z) => adapter?.flyTo(c, z);
      draw();
      let prev = store.get();
      unsubscribe = store.subscribe(() => {
        const s = store.get();
        const changed =
          s.scheme !== prev.scheme ||
          s.selection !== prev.selection ||
          s.focusKey !== prev.focusKey ||
          s.tool !== prev.tool ||
          s.lineStart !== prev.lineStart ||
          s.contour !== prev.contour ||
          s.photos !== prev.photos ||
          s.rotatePreview !== prev.rotatePreview ||
          s.settings.lang !== prev.settings.lang ||
          s.settings.showVoltage !== prev.settings.showVoltage ||
          s.settings.voltageMode !== prev.settings.voltageMode;
        prev = s;
        if (changed) draw();
      });
    };
    start().catch((e: Error) => setError(e.message));

    return () => {
      cancelled = true;
      unsubscribe?.();
      adapter?.destroy();
      adapterRef.current = null;
      mapApi.flyTo = undefined;
    };
  }, [provider, apiKey]);

  useEffect(() => {
    const a = adapterRef.current;
    if (a instanceof LeafletAdapter) a.setBaseLayer(baseLayer);
    if (a instanceof YandexAdapter) {
      a.setBaseLayer(baseLayer);
      if (baseLayer === 'satellite' && !a.satelliteSupported) store.set({ hint: t('yandex.noSatellite') });
    }
  }, [baseLayer]);

  return (
    <div className="map-wrap">
      {/* key: the container is recreated when the provider changes, since map libraries dislike foreign DOM. */}
      <div ref={ref} key={`${provider}:${apiKey}`} className="map" />
      {provider === 'yandex' && !apiKey && <YandexKeyForm onKey={setApiKey} />}
      {error && (
        <div className="map-error">
          {error === 'ymaps-load-failed' ? (
            <>
              <p>{t('yandex.loadFailed')}</p>
              <p className="muted small">{t('yandex.checkKey')}</p>
            </>
          ) : (
            <p>{t('map.drawError', { error })}</p>
          )}
          <div className="row">
            {error === 'ymaps-load-failed' ? (
              <button
                onClick={() => {
                  clearApiKey();
                  location.reload();
                }}
              >
                {t('yandex.otherKey')}
              </button>
            ) : (
              <button onClick={() => setError(null)}>{t('common.close')}</button>
            )}
            {provider === 'yandex' && (
              <button onClick={() => store.setSettings({ mapProvider: 'leaflet' })}>{t('yandex.openOsm')}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
