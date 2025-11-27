// Test setup file
import { vi } from 'vitest';

// Obsidian APIのモック
global.requestUrl = vi.fn();

// Window オブジェクトのモック
Object.defineProperty(window, 'setInterval', {
  value: vi.fn((fn: Function, delay: number) => {
    return setTimeout(fn, delay);
  }),
});

Object.defineProperty(window, 'clearInterval', {
  value: vi.fn((id: number) => {
    clearTimeout(id);
  }),
});

// Console のモック（ノイズを減らすため）
global.console = {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

// TextEncoder/TextDecoderのポリフィル
if (typeof TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encode(input: string): Uint8Array {
      const encoder = new TextEncoder();
      return encoder.encode(input);
    }
  };
}

if (typeof TextDecoder === 'undefined') {
  global.TextDecoder = class TextDecoder {
    decode(input: Uint8Array): string {
      const decoder = new TextDecoder();
      return decoder.decode(input);
    }
  };
}

// localStorageのモック
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock as any;

// navigatorのモック
global.navigator = {
  userAgent: 'Mozilla/5.0 (Test)',
  language: 'ja-JP',
  platform: 'MacIntel',
  hardwareConcurrency: 4,
} as any;

// Environment variables
process.env.NODE_ENV = 'test';
