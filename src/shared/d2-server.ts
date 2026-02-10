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

// --- Server reachability check with 30s cache ---

type RenderParams = { theme?: string; layout?: string; sketch?: string; scale?: string; preset?: string };

const reachabilityCache = new Map<string, { ok: boolean; ts: number }>();
const REACHABILITY_TTL = 30_000; // 30 seconds

/** Check if a D2 server URL is reachable (HEAD-like POST with short timeout, cached 30s) */
export async function checkServerReachable(serverUrl: string): Promise<boolean> {
  if (!serverUrl) return false;

  const cached = reachabilityCache.get(serverUrl);
  if (cached && Date.now() - cached.ts < REACHABILITY_TTL) return cached.ok;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${serverUrl}/svg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'd2=a',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const ok = res.status > 0;
    reachabilityCache.set(serverUrl, { ok, ts: Date.now() });
    return ok;
  } catch {
    reachabilityCache.set(serverUrl, { ok: false, ts: Date.now() });
    return false;
  }
}

/** Resolve which server URL to use: user-configured first (if reachable), then macro's server */
export async function resolveServerUrl(
  userServerUrl: string,
  macroServerUrl: string
): Promise<string> {
  if (userServerUrl) {
    const ok = await checkServerReachable(userServerUrl);
    if (ok) return userServerUrl;
  }
  return macroServerUrl || '';
}

/** Render SVG with fallback: tries user server first, then macro server */
export async function renderSvgWithFallback(
  userServerUrl: string,
  macroServerUrl: string,
  d2Code: string,
  params: RenderParams
): Promise<{ svg?: string; error?: string; usedServer: string }> {
  // Try user server first
  if (userServerUrl) {
    const result = await renderSvg(userServerUrl, d2Code, params);
    if (result.svg) return { ...result, usedServer: userServerUrl };
    // If user server failed and macro server is different, try macro server
    if (macroServerUrl && macroServerUrl !== userServerUrl) {
      const fallback = await renderSvg(macroServerUrl, d2Code, params);
      return { ...fallback, usedServer: macroServerUrl };
    }
    return { ...result, usedServer: userServerUrl };
  }
  // No user server — use macro server
  if (macroServerUrl) {
    const result = await renderSvg(macroServerUrl, d2Code, params);
    return { ...result, usedServer: macroServerUrl };
  }
  return { error: 'No server URL configured', usedServer: '' };
}

/** Render D2 code to PNG via d2server /png endpoint */
export async function renderPng(
  serverUrl: string,
  d2Code: string,
  params: RenderParams
): Promise<{ png?: Blob; error?: string }> {
  try {
    const body = new URLSearchParams();
    body.append('d2', d2Code);
    if (params.theme) body.append('theme', params.theme);
    if (params.layout) body.append('layout', params.layout);
    if (params.sketch) body.append('sketch', params.sketch);
    if (params.scale) body.append('scale', params.scale);
    if (params.preset) body.append('preset', params.preset);

    const res = await d2Fetch(`${serverUrl}/png`, {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) {
      const text = await res.text();
      return { error: text || `HTTP ${res.status}` };
    }

    const png = await res.blob();
    return { png };
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
