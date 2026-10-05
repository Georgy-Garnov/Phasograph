import { store, useStore, type BaseLayer, type GeocoderProvider, type Lang, type MapProvider } from '../model/store';
import { useT } from '../i18n';

export function LanguageSelect() {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  return (
    <label className="lang-select" title={t('settings.language')}>
      🌐
      <select value={lang} onChange={(e) => store.setSettings({ lang: e.target.value as Lang })}>
        <option value="ru">Русский</option>
        <option value="en">English</option>
        <option value="hy">Հայերեն</option>
      </select>
    </label>
  );
}

/** Map and geocoder provider selection, language. */
export function ProviderSettings() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  return (
    <div className="providers">
      <label title={t('settings.mapTitle')}>
        {t('settings.map')}
        <select value={settings.mapProvider} onChange={(e) => store.setSettings({ mapProvider: e.target.value as MapProvider })}>
          <option value="leaflet">OpenStreetMap (Leaflet)</option>
          <option value="yandex">{t('settings.yandexMaps')}</option>
        </select>
      </label>
      {/* Yandex satellite availability is checked at runtime (see YandexAdapter). */}
      <select
        value={settings.baseLayer}
        onChange={(e) => store.setSettings({ baseLayer: e.target.value as BaseLayer })}
        title={t('settings.baseLayer')}
      >
        <option value="osm">{t('settings.layerScheme')}</option>
        <option value="satellite">
          {settings.mapProvider === 'yandex' ? t('settings.layerSatelliteYandex') : t('settings.layerSatellite')}
        </option>
        <option value="hybrid">{t('settings.layerHybrid')}</option>
      </select>
      <label title={t('settings.geocoderTitle')}>
        {t('settings.geocoder')}
        <select value={settings.geocoder} onChange={(e) => store.setSettings({ geocoder: e.target.value as GeocoderProvider })}>
          <option value="nominatim">Nominatim (OSM)</option>
          <option value="yandex">{t('settings.yandexGeocoder')}</option>
        </select>
      </label>
      <LanguageSelect />
    </div>
  );
}
