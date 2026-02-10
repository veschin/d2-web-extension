/**
 * D2 parser for extracting top-level named blocks.
 * Uses tree-sitter AST when parser is provided, regex fallback otherwise.
 * Used by the reference library to split a D2 file into reusable components.
 */

import type { Parser, Node as TSNode } from 'web-tree-sitter';
import { isD2Keyword } from './d2-keywords';

export interface D2Block {
  name: string;
  code: string;
  startLine: number;
  endLine: number;
  /** Human-readable label extracted from D2 source */
  label?: string;
  /** Nested child blocks for containers */
  children?: D2Block[];
}

/**
 * Extract top-level named blocks from D2 source code.
 * Uses tree-sitter AST for accurate parsing when parser is available.
 * Filters out D2 directives (grid-columns, direction, style, etc.).
 */
export function extractD2Blocks(source: string, parser?: Parser): D2Block[] {
  let blocks: D2Block[];
  if (parser) {
    try {
      blocks = extractWithTreeSitter(source, parser);
    } catch {
      blocks = extractWithRegex(source);
    }
  } else {
    blocks = extractWithRegex(source);
  }
  return blocks.filter(b => !isD2Keyword(b.name));
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

    const label = extractNodeLabel(child, source);
    const children = extractChildBlocks(child, source);

    const block: D2Block = { name, code, startLine, endLine };
    if (label) block.label = label;
    if (children && children.length > 0) block.children = children;

    blocks.push(block);
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

/** Extract a label from a tree-sitter AST node */
function extractNodeLabel(node: TSNode, source: string): string | undefined {
  // Look for a label node (inline label like `id: "Label"`)
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === 'label') {
      const text = source.substring(child.startIndex, child.endIndex).trim();
      return cleanLabel(text);
    }
  }

  // Look inside a block for a `label:` property declaration
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === 'block' || child.type === 'block_definition') {
      return extractLabelFromBlock(child, source);
    }
  }

  return undefined;
}

/** Search inside a block node for a `label:` declaration */
function extractLabelFromBlock(block: TSNode, source: string): string | undefined {
  for (let i = 0; i < block.childCount; i++) {
    const child = block.child(i);
    if (!child || !child.isNamed) continue;

    // Look for declarations where the identifier is "label"
    let foundLabel = false;
    for (let j = 0; j < child.childCount; j++) {
      const sub = child.child(j);
      if (!sub) continue;
      if ((sub.type === 'identifier' || sub.type === 'identifier_chain') &&
          source.substring(sub.startIndex, sub.endIndex) === 'label') {
        foundLabel = true;
      }
      if (foundLabel && sub.type === 'label') {
        const text = source.substring(sub.startIndex, sub.endIndex).trim();
        return cleanLabel(text);
      }
    }
  }
  return undefined;
}

/** Extract child blocks from a container node (tree-sitter) */
function extractChildBlocks(node: TSNode, source: string): D2Block[] | undefined {
  // Find the block/block_definition child
  let blockNode: TSNode | null = null;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && (child.type === 'block' || child.type === 'block_definition')) {
      blockNode = child;
      break;
    }
  }
  if (!blockNode) return undefined;

  const children: D2Block[] = [];
  for (let i = 0; i < blockNode.childCount; i++) {
    const child = blockNode.child(i);
    if (!child || !child.isNamed) continue;
    if (child.type === 'comment' || child.type === 'block_comment') continue;

    const name = extractNodeName(child, source);
    if (!name || isD2Keyword(name)) continue;

    const startLine = child.startPosition.row;
    const endLine = child.endPosition.row;
    const code = source.substring(child.startIndex, child.endIndex);
    const label = extractNodeLabel(child, source);
    const nested = extractChildBlocks(child, source);

    const block: D2Block = { name, code, startLine, endLine };
    if (label) block.label = label;
    if (nested && nested.length > 0) block.children = nested;

    children.push(block);
  }

  return children.length > 0 ? children : undefined;
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
          const code = blockLines.join('\n');
          const name = extractLeadingIdentifier(trimmed);
          const label = extractLabelRegex(code);
          const innerChildren = extractChildrenRegex(code);

          const block: D2Block = {
            name: name || `block-${blocks.length + 1}`,
            code,
            startLine,
            endLine: j,
          };
          if (label) block.label = label;
          if (innerChildren && innerChildren.length > 0) block.children = innerChildren;

          blocks.push(block);
          i = j + 1;
          break;
        }
      }
      if (depth > 0) {
        // Unclosed brace -- take rest of file
        const code = lines.slice(i).join('\n');
        const label = extractLabelRegex(code);
        blocks.push({
          name: extractLeadingIdentifier(trimmed) || `block-${blocks.length + 1}`,
          code,
          startLine: i,
          endLine: lines.length - 1,
          ...(label ? { label } : {}),
        });
        break;
      }
      continue;
    }

    // Standalone statement
    const name = extractStatementName(trimmed);
    const label = extractInlineLabel(trimmed);
    const block: D2Block = {
      name: name || `line-${i + 1}`,
      code: trimmed,
      startLine: i,
      endLine: i,
    };
    if (label) block.label = label;

    blocks.push(block);
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

// --- Label extraction (regex fallback) ---

/** Extract inline label from a single-line statement like `db_dwh: "DWH"` */
function extractInlineLabel(line: string): string | undefined {
  // Match: identifier: "label" or identifier: 'label' (optionally followed by {)
  const m = line.match(/^[a-zA-Z_][\w.-]*\s*:\s*(?:"([^"]*)"(?:\s*\{)?|'([^']*)'(?:\s*\{)?)$/);
  if (m) {
    const raw = m[1] ?? m[2];
    if (raw) return cleanLabel(raw);
  }
  return undefined;
}

/** Extract label from a braced block (regex) */
function extractLabelRegex(code: string): string | undefined {
  const lines = code.split('\n');

  // Check first line for inline label: `name: "Label" {`
  if (lines.length > 0) {
    const first = lines[0].trim();
    const m = first.match(/^[a-zA-Z_][\w.-]*\s*:\s*"([^"]*)"(?:\s*\{)?/);
    if (m && m[1]) return cleanLabel(m[1]);
  }

  // Search for `label:` property inside block
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*label\s*:\s*"?([^"\n}]+)"?/);
    if (m && m[1]) return cleanLabel(m[1].trim());
  }

  return undefined;
}

/** Extract children from a braced block (regex) */
function extractChildrenRegex(code: string): D2Block[] | undefined {
  // Find the inner content between the outer braces
  const firstBrace = code.indexOf('{');
  if (firstBrace === -1) return undefined;

  // Find matching closing brace
  let depth = 0;
  let lastBrace = -1;
  let inStr = false;
  let strChar = '';
  for (let i = firstBrace; i < code.length; i++) {
    const ch = code[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === strChar) inStr = false;
    } else {
      if (ch === '"' || ch === "'") { inStr = true; strChar = ch; }
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { lastBrace = i; break; } }
    }
  }

  if (lastBrace === -1) return undefined;

  const rawInner = code.substring(firstBrace + 1, lastBrace);
  // Count leading blank lines consumed by trim to get correct offset
  const leadingLines = rawInner.match(/^(\s*\n)*/)?.[0]?.split('\n').length ?? 1;
  const trimmedLeadingOffset = leadingLines - 1;

  const inner = rawInner.trim();
  if (!inner) return undefined;

  // Lines before and including `{`, plus blank lines trimmed from inner content
  const preLines = code.substring(0, firstBrace + 1).split('\n').length - 1 + trimmedLeadingOffset;

  // Recursively parse inner content
  const rawChildren = extractWithRegex(inner);
  // Adjust startLine/endLine relative to parent and filter directives
  const children = rawChildren
    .filter(b => !isD2Keyword(b.name))
    .map(b => ({
      ...b,
      startLine: b.startLine + preLines,
      endLine: b.endLine + preLines,
    }));

  return children.length > 0 ? children : undefined;
}

/** Clean a label string: strip quotes, replace \n with space, truncate */
function cleanLabel(raw: string): string {
  let label = raw;
  // Strip surrounding quotes if present
  if ((label.startsWith('"') && label.endsWith('"')) ||
      (label.startsWith("'") && label.endsWith("'"))) {
    label = label.slice(1, -1);
  }
  // Replace escaped newlines with space
  label = label.replace(/\\n/g, ' ');
  // Truncate to 60 chars
  if (label.length > 60) label = label.substring(0, 57) + '...';
  return label;
}
