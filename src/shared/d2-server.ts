import { logInfo, logError } from './logger';

/**
 * Fetch for D2 server requests.
 * Content scripts with host_permissions bypass CORS, so we fetch directly
 * instead of proxying through the service worker (which can sleep in Firefox MV3).
 */
async function d2Fetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET';
  const start = performance.now();
  try {
    const res = await fetch(url, init);
    const duration = Math.round(performance.now() - start);
    logInfo('api', `${method} ${url} → ${res.status} (${duration}ms)`);
    return res;
  } catch (e) {
    const duration = Math.round(performance.now() - start);
    logError('api', `${method} ${url} → FAILED (${duration}ms): ${(e as Error).message}`);
    throw e;
  }
}

/** Render D2 code to SVG via d2server */
export async function renderSvg(
  serverUrl: string,
  d2Code: string,
  params: { theme?: string; layout?: string; sketch?: string; scale?: string; preset?: string }
): Promise<{ svg?: string; error?: string }> {
  try {
    const body = new URLSearchParams();
    body.append('d2', d2Code);
    if (params.theme) body.append('theme', params.theme);
    if (params.layout) body.append('layout', params.layout);
    if (params.sketch) body.append('sketch', params.sketch);
    if (params.scale) body.append('scale', params.scale);
    if (params.preset) body.append('preset', params.preset);

    const res = await d2Fetch(`${serverUrl}/svg`, {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    const body = new URLSearchParams();
    body.append('d2', d2Code);

    const res = await d2Fetch(`${serverUrl}/format`, {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
