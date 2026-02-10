/**
 * D2 block semantic analyzer.
 * Extracts metadata from D2 code using tree-sitter AST when available,
 * or regex-based fallback for environments without WASM.
 */

import type { Parser, Node as TSNode } from 'web-tree-sitter';
import type { BlockMetadata } from '../shared/types';
import { isD2Keyword } from '../shared/d2-keywords';

/**
 * Analyze a D2 code block to extract semantic metadata.
 * Uses tree-sitter AST if parser is provided, otherwise falls back to regex analysis.
 */
export function analyzeD2Block(code: string, parser?: Parser): BlockMetadata {
  if (parser) {
    return analyzeWithTreeSitter(code, parser);
  }
  return analyzeWithRegex(code);
}

function analyzeWithTreeSitter(code: string, parser: Parser): BlockMetadata {
  const tree = parser.parse(code);
  if (!tree) return analyzeWithRegex(code);

  let shapeCount = 0;
  let connectionCount = 0;
  let maxDepth = 0;
  let hasStyles = false;
  let hasClasses = false;
  const topIdentifiers: string[] = [];
  const seenIdentifiers = new Set<string>();

  function visit(node: TSNode, depth: number) {
    maxDepth = Math.max(maxDepth, depth);

    if (node.type === 'connection') {
      connectionCount++;
    }

    if (node.type === 'identifier' || node.type === 'identifier_chain') {
      const text = code.substring(node.startIndex, node.endIndex);
      if (text === 'style' || text.startsWith('style.')) {
        hasStyles = true;
      } else if (text === 'classes' || text === 'class') {
        hasClasses = true;
      } else if (depth <= 1 && !seenIdentifiers.has(text)) {
        seenIdentifiers.add(text);
        shapeCount++;
        if (topIdentifiers.length < 5) {
          topIdentifiers.push(text);
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        // Increment depth when entering a block (child has braces)
        const isBlock = child.type === 'block' || child.type === 'block_definition';
        visit(child, isBlock ? depth + 1 : depth);
      }
    }
  }

  visit(tree.rootNode, 0);

  return {
    shapeCount,
    connectionCount,
    nestingDepth: maxDepth,
    category: categorizeBlock(shapeCount, connectionCount, code, maxDepth),
    hasStyles,
    hasClasses,
    topIdentifiers,
  };
}

/** Regex-based fallback analyzer (for tests / no WASM) */
function analyzeWithRegex(code: string): BlockMetadata {
  const lines = code.split('\n');
  let shapeCount = 0;
  let connectionCount = 0;
  let maxDepth = 0;
  let currentDepth = 0;
  let hasStyles = false;
  let hasClasses = false;
  const topIdentifiers: string[] = [];
  const seenIdentifiers = new Set<string>();

  const connectionRe = /<->|-->|<--|->|<-|--/;
  const identifierRe = /^([a-zA-Z_][\w.-]*)/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Track brace depth
    for (const ch of trimmed) {
      if (ch === '{') currentDepth++;
      else if (ch === '}') currentDepth = Math.max(0, currentDepth - 1);
    }
    maxDepth = Math.max(maxDepth, currentDepth);

    // Count connections
    if (connectionRe.test(trimmed)) {
      connectionCount++;
      continue;
    }

    // Detect styles/classes
    if (/\bstyle\b/.test(trimmed) || /\bstyle\./.test(trimmed)) hasStyles = true;
    if (/\bclasses?\b/.test(trimmed)) hasClasses = true;

    // Count top-level identifiers (shapes) — only at depth 0 (not inside braces)
    if (currentDepth === 0 || (currentDepth === 1 && trimmed.includes('{'))) {
      const m = trimmed.match(identifierRe);
      if (m && !seenIdentifiers.has(m[1])) {
        const name = m[1];
        if (!isD2Keyword(name)) {
          seenIdentifiers.add(name);
          shapeCount++;
          if (topIdentifiers.length < 5) {
            topIdentifiers.push(name);
          }
        }
      }
    }
  }

  return {
    shapeCount,
    connectionCount,
    nestingDepth: maxDepth,
    category: categorizeBlock(shapeCount, connectionCount, code, maxDepth),
    hasStyles,
    hasClasses,
    topIdentifiers,
  };
}

function categorizeBlock(
  shapes: number,
  connections: number,
  code: string,
  depth: number,
): BlockMetadata['category'] {
  if (code.includes('sequence_diagram')) return 'sequence';
  if (code.includes('grid-columns') || code.includes('grid-rows')) return 'grid';
  if (connections > 0 && connections >= shapes) return 'flow';
  if (shapes === 0 && connections === 0) return 'simple';
  if (shapes <= 3 && depth <= 1 && connections === 0) return 'component';
  if (shapes > 0 && connections > 0) return 'mixed';
  if (shapes > 0) return 'component';
  return 'simple';
}
