/**
 * D2 text parser for extracting top-level named blocks.
 * Used by the reference library to split a D2 file into reusable components.
 */

export interface D2Block {
  name: string;
  code: string;
  startLine: number;
  endLine: number;
}

/**
 * Extract top-level named blocks from D2 source code.
 * A block is a top-level identifier followed by a `{` ... `}` body.
 * Standalone connections (a -> b) without braces are grouped as individual blocks.
 */
export function extractD2Blocks(source: string): D2Block[] {
  const lines = source.split('\n');
  const blocks: D2Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    // Check if this line starts a braced block: "name: { ..." or "name { ..." or "name.sub { ..."
    const braceStart = trimmed.match(/^([a-zA-Z_][\w.-]*(?:\s*[^:{]*?)?)?\s*\{/);
    if (braceStart) {
      const startLine = i;
      let depth = 0;

      // Count braces to find the end
      for (let j = i; j < lines.length; j++) {
        const l = lines[j];
        for (const ch of l) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        if (depth <= 0) {
          const blockLines = lines.slice(startLine, j + 1);
          const name = extractBlockName(trimmed);
          blocks.push({
            name: name || `block-${blocks.length + 1}`,
            code: blockLines.join('\n'),
            startLine,
            endLine: j,
          });
          i = j + 1;
          break;
        }
      }
      // If depth never reached 0, skip to end
      if (depth > 0) {
        blocks.push({
          name: extractBlockName(trimmed) || `block-${blocks.length + 1}`,
          code: lines.slice(i).join('\n'),
          startLine: i,
          endLine: lines.length - 1,
        });
        break;
      }
      continue;
    }

    // Standalone statement (connection, assignment, etc.) — single line block
    const name = extractStatementName(trimmed);
    blocks.push({
      name: name || `line-${i + 1}`,
      code: trimmed,
      startLine: i,
      endLine: i,
    });
    i++;
  }

  return blocks;
}

/** Extract a name from a block header like "myShape: { ... }" or "myShape { ... }" */
function extractBlockName(line: string): string {
  // "name: {" or "name {"
  const m = line.match(/^([a-zA-Z_][\w.-]*)/);
  return m ? m[1] : '';
}

/** Extract a meaningful name from a standalone D2 statement */
function extractStatementName(line: string): string {
  // Connection: "a -> b" → "a -> b"
  if (line.match(/<->|-->|<--|->|<-|--/)) {
    return line.replace(/\s*:\s*\{.*/, '').trim();
  }
  // Simple assignment: "name: value"
  const m = line.match(/^([a-zA-Z_][\w.-]*)/);
  return m ? m[1] : '';
}
