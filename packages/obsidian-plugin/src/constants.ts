const isLocalMode = process.env.NODE_ENV === 'local';

const BASE_URL = process.env.OBSIDIAN_LINE_API_URL || 
  (isLocalMode ? 'http://localhost:8787' : '');

if (!BASE_URL) {
  console.error('警告: OBSIDIAN_LINE_API_URLが設定されていません。APIとの通信ができません。');
}

export const API_ENDPOINTS = {
  BASE_URL,
  MESSAGES: (vaultId: string): string => `${BASE_URL}/messages/${vaultId}`,
  MAPPING: `${BASE_URL}/mapping`,
  UPDATE_SYNC_STATUS: `${BASE_URL}/messages/update-sync-status`,
} as const; 