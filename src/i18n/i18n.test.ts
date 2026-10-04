import { describe, expect, it } from 'vitest';
import { ru } from './ru';
import { en } from './en';
import { hy } from './hy';

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('dictionaries', () => {
  const dicts = { en, hy };
  for (const [lang, dict] of Object.entries(dicts)) {
    it(`${lang}: same keys as ru`, () => {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(ru).sort());
    });

    it(`${lang}: same placeholders as ru and no empty strings`, () => {
      for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
        expect(placeholders(dict[key]), `${lang}.${key}`).toEqual(placeholders(ru[key]));
        expect(dict[key].trim(), `${lang}.${key}`).not.toBe('');
      }
    });
  }
});
