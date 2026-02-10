export interface ExtensionSettings {
  serverUrl: string; // empty string = not set
}

const STORAGE_KEY = 'd2ext-settings';

const DEFAULTS: ExtensionSettings = {
  serverUrl: '',
};

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      return { ...DEFAULTS, ...stored };
    }
  } catch {
    // storage unavailable
  }
  return { ...DEFAULTS };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: settings });
  } catch {
    // storage unavailable
  }
}
