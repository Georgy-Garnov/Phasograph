/**
 * Localization. Dictionaries use flat keys; English and Armenian must contain every Russian key (checked by TypeScript).
 * Substitutions: t('key', { n: 5 }) replaces "{n}".
 */
import { store, useStore, type Lang } from '../model/store';
import { ru } from './ru';
import { en } from './en';
import { hy } from './hy';

export type MessageKey = keyof typeof ru;
export type Params = Record<string, string | number>;

const DICTS: Record<Lang, Record<MessageKey, string>> = { ru, en, hy };

const LOCALES: Record<Lang, string> = { ru: 'ru-RU', en: 'en-GB', hy: 'hy-AM' };

export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  let text = DICTS[lang][key] ?? ru[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

/** Translation outside React (handlers, hints) — in the currently configured language. */
export function t(key: MessageKey, params?: Params): string {
  return translate(store.get().settings.lang, key, params);
}

/** Translation in components: re-renders on language change. */
export function useT(): (key: MessageKey, params?: Params) => string {
  const lang = useStore((s) => s.settings.lang);
  return (key, params) => translate(lang, key, params);
}

export function currentLocale(): string {
  return LOCALES[store.get().settings.lang];
}
