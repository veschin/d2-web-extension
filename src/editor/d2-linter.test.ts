import { describe, it, expect } from 'vitest';
import { parseD2Errors } from './d2-linter';

/**
 * Minimal doc mock that mimics CodeMirror's Text interface.
 * Each line is a separate string; line numbers are 1-based.
 */
function makeDoc(...lineTexts: string[]) {
  // Build cumulative offsets
  let offset = 0;
  const lineData = lineTexts.map((text) => {
    const from = offset;
    const to = offset + text.length;
    offset = to + 1; // +1 for the newline separator
    return { from, to };
  });
  return {
    lines: lineTexts.length,
    line(n: number) {
      return lineData[n - 1];
    },
  };
}

describe('parseD2Errors', () => {
  it('parses <stdin>:LINE:COL: message format', () => {
    const doc = makeDoc('a -> b', 'bad line', 'c -> d');
    const diags = parseD2Errors('<stdin>:2:1: syntax error', doc);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('syntax error');
    // Line 2, col 1 → from = offset of line 2 + 0
    expect(diags[0].from).toBe(doc.line(2).from);
    expect(diags[0].to).toBe(doc.line(2).to);
  });

  it('handles column offset within a line', () => {
    const doc = makeDoc('a -> b');
    const diags = parseD2Errors('<stdin>:1:4: unexpected token', doc);
    expect(diags).toHaveLength(1);
    expect(diags[0].from).toBe(3); // col 4 → 0-indexed 3
    expect(diags[0].to).toBe(doc.line(1).to);
  });

  it('clamps column to line end', () => {
    const doc = makeDoc('ab'); // length 2
    const diags = parseD2Errors('<stdin>:1:99: overflow', doc);
    expect(diags).toHaveLength(1);
    expect(diags[0].from).toBe(doc.line(1).to); // clamped
  });

  it('parses "line LINE:COL" format', () => {
    const doc = makeDoc('a -> b', 'c -> d', 'e -> f');
    const diags = parseD2Errors('error at line 3:1', doc);
    expect(diags).toHaveLength(1);
    expect(diags[0].from).toBe(doc.line(3).from);
    expect(diags[0].to).toBe(doc.line(3).to);
    expect(diags[0].message).toBe('error at line 3:1');
  });

  it('falls back to first line for unrecognized format', () => {
    const doc = makeDoc('a -> b', 'c -> d');
    const diags = parseD2Errors('unknown error happened', doc);
    expect(diags).toHaveLength(1);
    expect(diags[0].from).toBe(doc.line(1).from);
    expect(diags[0].to).toBe(doc.line(1).to);
    expect(diags[0].message).toBe('unknown error happened');
  });

  it('handles multiple errors on separate lines', () => {
    const doc = makeDoc('a -> b', 'c -> d', 'e -> f');
    const diags = parseD2Errors(
      '<stdin>:1:1: first error\n<stdin>:3:1: second error',
      doc
    );
    expect(diags).toHaveLength(2);
    expect(diags[0].message).toBe('first error');
    expect(diags[1].message).toBe('second error');
  });

  it('skips empty lines in error text', () => {
    const doc = makeDoc('a -> b');
    const diags = parseD2Errors('\n\n<stdin>:1:1: err\n\n', doc);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('err');
  });

  it('returns empty array for empty error text', () => {
    const doc = makeDoc('a -> b');
    const diags = parseD2Errors('', doc);
    expect(diags).toHaveLength(0);
  });

  it('ignores line numbers out of range for <stdin> format', () => {
    const doc = makeDoc('a -> b'); // only 1 line
    const diags = parseD2Errors('<stdin>:99:1: out of range', doc);
    // Should not match the structured format, falls back to first line
    expect(diags).toHaveLength(1);
    expect(diags[0].from).toBe(doc.line(1).from);
  });

  it('does not duplicate fallback diagnostics for multi-line unrecognized errors', () => {
    const doc = makeDoc('a -> b');
    // First unrecognized line creates a fallback. Subsequent ones should not
    // because diagnostics.length > 0 skips the fallback branch.
    const diags = parseD2Errors('error one\nerror two', doc);
    // First line → fallback, second line → no match + diagnostics.length > 0 → skipped
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('error one');
  });
});
