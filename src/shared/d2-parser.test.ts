import { describe, it, expect } from 'vitest';
import { extractD2Blocks } from './d2-parser';

describe('extractD2Blocks', () => {
  it('extracts a single braced block', () => {
    const source = `server {
  shape: rectangle
  label: "My Server"
}`;
    const blocks = extractD2Blocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('server');
    expect(blocks[0].code).toBe(source);
    expect(blocks[0].startLine).toBe(0);
    expect(blocks[0].endLine).toBe(3);
  });

  it('extracts multiple braced blocks', () => {
    const source = `server {
  shape: rectangle
}

client {
  shape: oval
}`;
    const blocks = extractD2Blocks(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].name).toBe('server');
    expect(blocks[1].name).toBe('client');
  });

  it('extracts standalone connections as individual blocks', () => {
    const source = `a -> b
b -> c`;
    const blocks = extractD2Blocks(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].name).toBe('a -> b');
    expect(blocks[0].code).toBe('a -> b');
    expect(blocks[1].name).toBe('b -> c');
  });

  it('handles nested braces correctly', () => {
    const source = `outer {
  inner {
    shape: circle
  }
}`;
    const blocks = extractD2Blocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('outer');
    expect(blocks[0].endLine).toBe(4);
  });

  it('skips comments and empty lines', () => {
    const source = `# This is a comment

server {
  shape: rectangle
}

# Another comment`;
    const blocks = extractD2Blocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('server');
  });

  it('handles mixed blocks and connections', () => {
    const source = `server {
  shape: rectangle
}

server -> client

client {
  shape: oval
}`;
    const blocks = extractD2Blocks(source);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].name).toBe('server');
    expect(blocks[1].name).toBe('server -> client');
    expect(blocks[2].name).toBe('client');
  });

  it('returns empty array for empty input', () => {
    expect(extractD2Blocks('')).toHaveLength(0);
    expect(extractD2Blocks('  \n  \n  ')).toHaveLength(0);
  });

  it('handles dotted identifiers', () => {
    const source = `network.server {
  shape: rectangle
}`;
    const blocks = extractD2Blocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('network.server');
  });
});
