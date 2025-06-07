const isLocalMode = process.env.NODE_ENV === 'local';

const BASE_URL = process.env.OBSIDIAN_LINE_API_URL || 
  (isLocalMode ? 'http://localhost:8787' : '');

if (!BASE_URL) {
  console.error('警告: OBSIDIAN_LINE_API_URLが設定されていません。APIとの通信ができません。');
}

export const API_ENDPOINTS = {
  BASE_URL,
  MESSAGES: (vaultId: string, userId: string): string => {
    if (!vaultId || !userId) {
      throw new Error('vaultIdとuserIdは必須パラメータです');
    }
    return `${BASE_URL}/messages/${vaultId}/${userId}`;
  },
  MAPPING: `${BASE_URL}/mapping`,
  UPDATE_SYNC_STATUS: `${BASE_URL}/messages/update-sync-status`,
} as const; 