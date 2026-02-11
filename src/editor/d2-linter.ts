import { linter, type Diagnostic } from '@codemirror/lint';

export interface LinterConfig {
  getServerUrl: () => string;
}

/**
 * CodeMirror linter extension that validates D2 code against the D2 server.
 * Sends code to {serverUrl}/svg and parses error responses for line/column info.
 * Debounce: 1500ms.
 */
export function d2Linter(config: LinterConfig) {
  return linter(async (view) => {
    const serverUrl = config.getServerUrl();
    if (!serverUrl) return [];

    const code = view.state.doc.toString();
    if (!code.trim()) return [];

    const diagnostics: Diagnostic[] = [];

    try {
      const body = new URLSearchParams();
      body.append('d2', code);

      let result: { status: number; data: string };

      if (typeof browser !== 'undefined' && browser.runtime?.sendMessage && browser.runtime?.id) {
        const response = await browser.runtime.sendMessage({
          type: 'proxy-fetch',
          url: `${serverUrl}/svg`,
          method: 'POST',
          body: body.toString(),
          contentType: 'application/x-www-form-urlencoded',
        });
        if (!response || typeof response.status !== 'number') return [];
        result = response;
      } else {
        const res = await fetch(`${serverUrl}/svg`, {
          method: 'POST',
          body: body.toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        result = { status: res.status, data: await res.text() };
      }

      if (result.status >= 400 && result.data) {
        const parsed = parseD2Errors(result.data, view.state.doc);
        diagnostics.push(...parsed);
      }
    } catch {
      // Server unreachable — don't show lint errors
    }

    return diagnostics;
  }, { delay: 1500 });
}

/**
 * Parse D2 server error output into CodeMirror diagnostics.
 * D2 error format: `<stdin>:LINE:COL: message` or just a plain message.
 */
export function parseD2Errors(
  errorText: string,
  doc: { line(n: number): { from: number; to: number }; lines: number }
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = errorText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try to parse structured error: <stdin>:LINE:COL: message
    const match = trimmed.match(/<stdin>:(\d+):(\d+):\s*(.*)/);
    if (match) {
      const lineNum = parseInt(match[1], 10);
      const col = parseInt(match[2], 10);
      const message = match[3] || trimmed;

      if (lineNum >= 1 && lineNum <= doc.lines) {
        const docLine = doc.line(lineNum);
        const from = Math.min(docLine.from + col - 1, docLine.to);
        const to = docLine.to;
        diagnostics.push({ from, to, severity: 'error', message });
        continue;
      }
    }

    // Try simpler format: line LINE:COL
    const simpleMatch = trimmed.match(/line (\d+):(\d+)/i);
    if (simpleMatch) {
      const lineNum = parseInt(simpleMatch[1], 10);
      if (lineNum >= 1 && lineNum <= doc.lines) {
        const docLine = doc.line(lineNum);
        diagnostics.push({ from: docLine.from, to: docLine.to, severity: 'error', message: trimmed });
        continue;
      }
    }

    // Fallback: mark the whole first line
    if (diagnostics.length === 0) {
      const docLine = doc.line(1);
      diagnostics.push({ from: docLine.from, to: docLine.to, severity: 'error', message: trimmed });
    }
  }

  return diagnostics;
}
