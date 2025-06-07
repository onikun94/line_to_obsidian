import { vi } from 'vitest';

// Cloudflare Worker環境のモック
global.fetch = vi.fn();

// KVNamespaceのモック
export const mockKVNamespace = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
};

// Console のモック
global.console = {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

// Environment variables
process.env.NODE_ENV = 'test'; 