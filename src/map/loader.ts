let loading: Promise<void> | null = null;

/** Loads Yandex Maps JS API v3 and waits until it is ready. */
export function loadYmaps(apiKey: string): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.async = true;
    script.onload = () => ymaps3.ready.then(resolve, reject);
    // The browser does not show the failure reason (usually a 403 due to the key): the response is blocked as ERR_BLOCKED_BY_ORB.
    script.onerror = () => reject(new Error('ymaps-load-failed'));
    document.head.appendChild(script);
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

const KEY_STORAGE = 'electro-ymaps-key';

export function getApiKey(): string {
  return import.meta.env.VITE_YMAPS_API_KEY || localStorage.getItem(KEY_STORAGE) || '';
}

export function saveApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}

export function getGeocoderKey(): string {
  return import.meta.env.VITE_YMAPS_GEOCODER_KEY || getApiKey();
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}
