import { describe, expect, it } from 'vitest';
import { formatNominatimAddress } from './geocoder';

describe('formatNominatimAddress', () => {
  it('builds a short address', () => {
    expect(
      formatNominatimAddress(
        { state: 'Московская область', village: 'Ивановка', road: 'Садовая улица', house_number: '12' },
        'длинный',
      ),
    ).toBe('Московская область, Ивановка, Садовая улица, 12');
  });
  it('does not repeat a region that matches the city', () => {
    expect(formatNominatimAddress({ state: 'Москва', city: 'Москва', road: 'Спасская улица' }, '')).toBe(
      'Москва, Спасская улица',
    );
  });
  it('returns display_name when there are too few details', () => {
    expect(formatNominatimAddress({ state: 'Тверская область' }, 'полный адрес')).toBe('полный адрес');
  });
});
