/**
 * タイムスタンプをDateオブジェクトに変換
 */
export function toLocalDate(timestamp: number): Date {
  return new Date(timestamp);
}

/**
 * 日付文字列を取得（ハイフンなし）
 * 例: 20250912
 */
export function getDateString(timestamp: number): string {
  const date = toLocalDate(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 日付文字列を取得（ハイフンあり）
 * 例: 2025-09-12
 */
export function getDateWithHyphens(timestamp: number): string {
  const date = toLocalDate(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * ISO形式の日時文字列を取得
 */
export function getISOString(timestamp: number): string {
  const date = toLocalDate(timestamp);
  return date.toISOString();
}

/**
 * ファイル名用の日時文字列を取得
 * 例: 20250912075438
 */
export function getDateTimeForFileName(timestamp: number): string {
  const date = toLocalDate(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hour}${minute}${second}`;
}

/**
 * 時刻のみを取得（コロンなし）
 * 例: 075438
 */
export function getTimeOnly(timestamp: number): string {
  const date = toLocalDate(timestamp);
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');

  return `${hour}${minute}${second}`;
}

/**
 * 時刻文字列を取得（コロンあり）
 * 例: 07:54:38
 */
export function getTimeString(timestamp: number): string {
  const date = toLocalDate(timestamp);
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');

  return `${hour}:${minute}:${second}`;
}
