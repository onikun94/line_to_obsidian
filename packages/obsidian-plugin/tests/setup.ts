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

// Environment variables
process.env.NODE_ENV = 'test'; 