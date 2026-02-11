import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSettings, saveSettings } from './extension-settings';

let storage: Record<string, unknown> = {};

beforeEach(() => {
  storage = {};
  vi.restoreAllMocks();

  (globalThis as any).browser = {
    ...((globalThis as any).browser),
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(storage, obj);
        }),
        remove: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
  };
});

describe('loadSettings', () => {
  it('returns defaults when nothing stored', async () => {
    const settings = await loadSettings();
    expect(settings).toEqual({ serverUrl: '' });
  });

  it('merges stored values with defaults', async () => {
    storage['d2ext-settings'] = { serverUrl: 'https://d2.example.com' };
    const settings = await loadSettings();
    expect(settings.serverUrl).toBe('https://d2.example.com');
  });

  it('returns defaults when storage throws', async () => {
    vi.mocked(browser.storage.local.get).mockRejectedValue(new Error('fail'));
    const settings = await loadSettings();
    expect(settings).toEqual({ serverUrl: '' });
  });

  it('returns defaults when stored value is not an object', async () => {
    storage['d2ext-settings'] = 'invalid';
    const settings = await loadSettings();
    expect(settings).toEqual({ serverUrl: '' });
  });
});

describe('saveSettings', () => {
  it('persists settings to storage', async () => {
    await saveSettings({ serverUrl: 'https://d2.test' });
    expect(storage['d2ext-settings']).toEqual({ serverUrl: 'https://d2.test' });
  });

  it('does not throw when storage fails', async () => {
    vi.mocked(browser.storage.local.set).mockRejectedValue(new Error('fail'));
    await expect(saveSettings({ serverUrl: '' })).resolves.not.toThrow();
  });

  it('round-trips correctly (save → load)', async () => {
    await saveSettings({ serverUrl: 'https://d2.roundtrip.test' });
    const loaded = await loadSettings();
    expect(loaded.serverUrl).toBe('https://d2.roundtrip.test');
  });
});
