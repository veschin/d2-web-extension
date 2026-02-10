/**
 * D2 parser for extracting top-level named blocks.
 * Uses tree-sitter AST when parser is provided, regex fallback otherwise.
 * Used by the reference library to split a D2 file into reusable components.
 */

import type { Parser, Node as TSNode } from 'web-tree-sitter';

export interface D2Block {
  name: string;
  code: string;
  startLine: number;
  endLine: number;
}

/**
 * Extract top-level named blocks from D2 source code.
 * Uses tree-sitter AST for accurate parsing when parser is available.
 */
export function extractD2Blocks(source: string, parser?: Parser): D2Block[] {
  if (parser) {
    try {
      return extractWithTreeSitter(source, parser);
    } catch {
      // Fall back to regex on any tree-sitter failure
    }
  }
  return extractWithRegex(source);
}

// --- Tree-sitter based extraction ---

function extractWithTreeSitter(source: string, parser: Parser): D2Block[] {
  const tree = parser.parse(source);
  if (!tree) return extractWithRegex(source);

  const blocks: D2Block[] = [];
  const root = tree.rootNode;

  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (!child || !child.isNamed) continue;

    // Skip comments
    if (child.type === 'comment' || child.type === 'block_comment') continue;

    const startLine = child.startPosition.row;
    const endLine = child.endPosition.row;
    const code = source.substring(child.startIndex, child.endIndex);

    const name = extractNodeName(child, source);
    if (!name) continue;

    blocks.push({ name, code, startLine, endLine });
  }

  return blocks;
}

/** Extract a human-readable name from a tree-sitter AST node */
function extractNodeName(node: TSNode, source: string): string {
  // Walk to find the first identifier or identifier_chain, and check for connections
  let hasConnection = false;
  const identifiers: string[] = [];

  function visitExpr(n: TSNode) {
    if (n.type === 'connection') {
      hasConnection = true;
      identifiers.push(source.substring(n.startIndex, n.endIndex));
    } else if (n.type === 'identifier' || n.type === 'identifier_chain') {
      identifiers.push(source.substring(n.startIndex, n.endIndex));
    } else {
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) visitExpr(child);
      }
    }
  }

  // For a declaration node, look at the expression part (before the colon/block)
  // The first named child is typically the _expr
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    // Stop before block content
    if (child.type === 'block' || child.type === 'block_definition') break;
    visitExpr(child);
  }

  if (hasConnection && identifiers.length > 0) {
    // Connection: combine "a -> b" style
    return identifiers.join(' ');
  }
  if (identifiers.length > 0) {
    return identifiers[0];
  }

  // Fallback: first line trimmed
  const text = source.substring(node.startIndex, node.endIndex);
  const first = text.split('\n')[0].trim();
  const m = first.match(/^([a-zA-Z_][\w.-]*)/);
  return m ? m[1] : '';
}

// --- Regex-based fallback ---

function extractWithRegex(source: string): D2Block[] {
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

    // Check if this line opens a braced block
    if (lineOpensBrace(trimmed)) {
      const startLine = i;
      let depth = 0;
      // Track brace depth accounting for strings
      for (let j = i; j < lines.length; j++) {
        depth += countBracesDelta(lines[j]);
        if (depth <= 0) {
          const blockLines = lines.slice(startLine, j + 1);
          const name = extractLeadingIdentifier(trimmed);
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
      if (depth > 0) {
        // Unclosed brace — take rest of file
        blocks.push({
          name: extractLeadingIdentifier(trimmed) || `block-${blocks.length + 1}`,
          code: lines.slice(i).join('\n'),
          startLine: i,
          endLine: lines.length - 1,
        });
        break;
      }
      continue;
    }

    // Standalone statement
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

/** Check if a line contains an opening brace (outside of strings) */
function lineOpensBrace(line: string): boolean {
  let inStr = false;
  let strChar = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === strChar) inStr = false;
    } else {
      if (ch === '"' || ch === "'") { inStr = true; strChar = ch; }
      else if (ch === '{') return true;
    }
  }
  return false;
}

/** Count net brace depth change for a line, ignoring braces inside strings */
function countBracesDelta(line: string): number {
  let delta = 0;
  let inStr = false;
  let strChar = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === strChar) inStr = false;
    } else {
      if (ch === '"' || ch === "'") { inStr = true; strChar = ch; }
      else if (ch === '{') delta++;
      else if (ch === '}') delta--;
    }
  }
  return delta;
}

/** Extract the leading identifier from a line */
function extractLeadingIdentifier(line: string): string {
  const m = line.match(/^([a-zA-Z_][\w.-]*)/);
  return m ? m[1] : '';
}

/** Extract a meaningful name from a standalone D2 statement */
function extractStatementName(line: string): string {
  if (line.match(/<->|-->|<--|->|<-|--/)) {
    return line.replace(/\s*:\s*\{.*/, '').trim();
  }
  const m = line.match(/^([a-zA-Z_][\w.-]*)/);
  return m ? m[1] : '';
}
