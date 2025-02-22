const BASE_URL = process.env.OBSIDIAN_LINE_API_URL

export const API_ENDPOINTS = {
  BASE_URL,
  MESSAGES: (vaultId: string): string => `${BASE_URL}/messages/${vaultId}`,
  MAPPING: `${BASE_URL}/mapping`,
} as const; 