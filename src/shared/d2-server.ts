/** Render D2 code to SVG via d2server */
export async function renderSvg(
  serverUrl: string,
  d2Code: string,
  params: { theme?: string; layout?: string; sketch?: string; scale?: string; preset?: string }
): Promise<{ svg?: string; error?: string }> {
  try {
    const formData = new FormData();
    formData.append('d2', d2Code);
    if (params.theme) formData.append('theme', params.theme);
    if (params.layout) formData.append('layout', params.layout);
    if (params.sketch) formData.append('sketch', params.sketch);
    if (params.scale) formData.append('scale', params.scale);
    if (params.preset) formData.append('preset', params.preset);

    const res = await fetch(`${serverUrl}/svg`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      return { error: text || `HTTP ${res.status}` };
    }

    const svg = await res.text();
    return { svg };
  } catch (e) {
    return { error: `Server unreachable: ${(e as Error).message}` };
  }
}

/** Format D2 code via d2server */
export async function formatD2(
  serverUrl: string,
  d2Code: string
): Promise<{ formatted?: string; error?: string }> {
  try {
    const formData = new FormData();
    formData.append('d2', d2Code);

    const res = await fetch(`${serverUrl}/format`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      return { error: text || `HTTP ${res.status}` };
    }

    const formatted = await res.text();
    return { formatted };
  } catch (e) {
    return { error: `Server unreachable: ${(e as Error).message}` };
  }
}

/** Extract d2server URL from macro's inline script */
export function extractServerUrl(macroElement: Element): string {
  const script = macroElement.querySelector('script');
  if (script) {
    const match = script.textContent?.match(/fetch\(['"]([^'"]+)\/(svg|png)['"]/);
    if (match) return match[1];
  }
  return '';
}
