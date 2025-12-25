import { describe, it, expect } from 'vitest';
import {
  getDateString,
  getDateWithHyphens,
  getDateTimeForFileName,
  getTimeOnly,
  getTimeString
} from '../../src/dateUtils';

describe('dateUtils', () => {
  // JST 2025-09-12 07:54:38 = UTC 2025-09-11 22:54:38
  // このケースで {date} が前日になるバグがあった
  const jst20250912_075438 = new Date('2025-09-12T07:54:38+09:00').getTime();

  // JST 2025-09-12 09:00:00 = UTC 2025-09-12 00:00:00
  const jst20250912_090000 = new Date('2025-09-12T09:00:00+09:00').getTime();

  // JST 2025-01-15 23:59:59 = UTC 2025-01-15 14:59:59
  const jst20250115_235959 = new Date('2025-01-15T23:59:59+09:00').getTime();

  describe('getDateString (datecompact)', () => {
    it('JST午前9時前でも当日の日付を返す（UTCでは前日でもJSTでは当日）', () => {
      const result = getDateString(jst20250912_075438);
      expect(result).toBe('20250912');
    });

    it('JST午前9時以降は当日の日付を返す', () => {
      const result = getDateString(jst20250912_090000);
      expect(result).toBe('20250912');
    });

    it('JST深夜でも当日の日付を返す', () => {
      const result = getDateString(jst20250115_235959);
      expect(result).toBe('20250115');
    });
  });

  describe('getDateWithHyphens (date)', () => {
    it('JST午前9時前でも当日の日付を返す（UTCでは前日でもJSTでは当日）', () => {
      const result = getDateWithHyphens(jst20250912_075438);
      expect(result).toBe('2025-09-12');
    });

    it('JST午前9時以降は当日の日付を返す', () => {
      const result = getDateWithHyphens(jst20250912_090000);
      expect(result).toBe('2025-09-12');
    });

    it('JST深夜でも当日の日付を返す', () => {
      const result = getDateWithHyphens(jst20250115_235959);
      expect(result).toBe('2025-01-15');
    });
  });

  describe('getDateTimeForFileName (datetime)', () => {
    it('JST午前9時前でも正しい日時を返す', () => {
      const result = getDateTimeForFileName(jst20250912_075438);
      expect(result).toBe('20250912075438');
    });

    it('JST午前9時以降で正しい日時を返す', () => {
      const result = getDateTimeForFileName(jst20250912_090000);
      expect(result).toBe('20250912090000');
    });
  });

  describe('getTimeOnly (time)', () => {
    it('JST午前9時前でも正しい時刻を返す', () => {
      const result = getTimeOnly(jst20250912_075438);
      expect(result).toBe('075438');
    });

    it('JST午前9時以降で正しい時刻を返す', () => {
      const result = getTimeOnly(jst20250912_090000);
      expect(result).toBe('090000');
    });
  });

  describe('getTimeString', () => {
    it('コロン区切りの時刻を返す', () => {
      const result = getTimeString(jst20250912_075438);
      expect(result).toBe('07:54:38');
    });
  });

  describe('日付変数の一貫性', () => {
    it('{date}と{datetime}の日付部分が一致する', () => {
      const date = getDateWithHyphens(jst20250912_075438);
      const datetime = getDateTimeForFileName(jst20250912_075438);
      const datetimeDatePart = datetime.slice(0, 4) + '-' + datetime.slice(4, 6) + '-' + datetime.slice(6, 8);
      expect(date).toBe(datetimeDatePart);
    });

    it('{datecompact}と{datetime}の日付部分が一致する', () => {
      const datecompact = getDateString(jst20250912_075438);
      const datetime = getDateTimeForFileName(jst20250912_075438);
      const datetimeDatePart = datetime.slice(0, 8);
      expect(datecompact).toBe(datetimeDatePart);
    });
  });
});
