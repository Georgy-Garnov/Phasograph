import type { LngLat } from '../model/types';
import { store, type GeocoderProvider, type Lang } from '../model/store';
import { getGeocoderKey } from './loader';

interface Geocoder {
  /** Address of the nearest house by coordinates. */
  reverse(coords: LngLat): Promise<string | null>;
  /** Place search by text. */
  search(text: string): Promise<LngLat | null>;
}

// ---------- Nominatim (OpenStreetMap) ----------

const NOMINATIM = 'https://nominatim.openstreetmap.org';
let nominatimQueue: Promise<unknown> = Promise.resolve();

/** Nominatim policy: at most 1 request per second, so requests are queued. */
function nominatimFetch<T>(path: string): Promise<T> {
  const run = nominatimQueue.then(async () => {
    const res = await fetch(`${NOMINATIM}${path}`, { headers: { 'Accept-Language': store.get().settings.lang } });
    if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
    return (await res.json()) as T;
  });
  nominatimQueue = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  allotments?: string;
  neighbourhood?: string;
  hamlet?: string;
  village?: string;
  town?: string;
  city?: string;
  suburb?: string;
  county?: string;
  state?: string;
}

/** Short "locality, street, house" address instead of the long display_name. */
export function formatNominatimAddress(a: NominatimAddress, fallback: string): string {
  const locality = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.allotments;
  const street = a.road ?? a.pedestrian ?? a.neighbourhood;
  // For federal cities the region matches the city ("Moscow, Moscow"), so drop the duplicate.
  const parts = [a.state, locality ?? a.county, street, a.house_number].filter(
    (p, i, arr): p is string => !!p && p !== arr[i - 1],
  );
  return parts.length >= 2 ? parts.join(', ') : fallback;
}

const nominatim: Geocoder = {
  async reverse([lng, lat]) {
    const data = await nominatimFetch<{ display_name?: string; address?: NominatimAddress }>(
      `/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`,
    );
    if (!data.display_name) return null;
    return formatNominatimAddress(data.address ?? {}, data.display_name);
  },
  async search(text) {
    const data = await nominatimFetch<{ lat: string; lon: string }[]>(
      `/search?format=jsonv2&limit=1&q=${encodeURIComponent(text)}`,
    );
    return data[0] ? [Number(data[0].lon), Number(data[0].lat)] : null;
  },
};

// ---------- Yandex ----------

/** Yandex Geocoder has no Armenian locale — English is used instead. */
const YANDEX_LANG: Record<Lang, string> = { ru: 'ru_RU', en: 'en_US', hy: 'en_US' };

interface YandexResponse {
  response?: {
    GeoObjectCollection?: {
      featureMember?: {
        GeoObject?: { Point?: { pos?: string }; metaDataProperty?: { GeocoderMetaData?: { text?: string } } };
      }[];
    };
  };
}

async function yandexGeocode(query: string, extra = ''): Promise<YandexResponse> {
  const key = getGeocoderKey();
  if (!key) throw new Error('Yandex geocoder key is not set');
  const res = await fetch(
    `https://geocode-maps.yandex.ru/1.x/?format=json&lang=${YANDEX_LANG[store.get().settings.lang]}&results=1${extra}` +
      `&apikey=${encodeURIComponent(key)}&geocode=${encodeURIComponent(query)}`,
  );
  if (!res.ok) throw new Error(`Yandex geocoder: HTTP ${res.status}`);
  return (await res.json()) as YandexResponse;
}

const yandex: Geocoder = {
  async reverse(coords) {
    const data = await yandexGeocode(`${coords[0]},${coords[1]}`, '&kind=house');
    return data.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.metaDataProperty?.GeocoderMetaData?.text ?? null;
  },
  async search(text) {
    const data = await yandexGeocode(text);
    const pos = data.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
    if (!pos) return null;
    const [lng, lat] = pos.split(' ').map(Number);
    return [lng, lat];
  },
};

const GEOCODERS: Record<GeocoderProvider, Geocoder> = { nominatim, yandex };

function current(): Geocoder {
  return GEOCODERS[store.get().settings.geocoder];
}

export async function reverseGeocode(coords: LngLat): Promise<string | null> {
  try {
    return await current().reverse(coords);
  } catch (e) {
    console.warn('Geocoder unavailable', e);
    return null;
  }
}

export async function searchPlace(text: string): Promise<LngLat | null> {
  try {
    return await current().search(text);
  } catch (e) {
    console.warn('Search unavailable', e);
    return null;
  }
}
