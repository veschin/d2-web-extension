import { describe, it, expect } from 'vitest';
import { D2_LANGUAGE_ID, D2_MONARCH_TOKENIZER, D2_COMPLETION_ITEMS } from './d2-language';

describe('D2_LANGUAGE_ID', () => {
  it('is "d2"', () => {
    expect(D2_LANGUAGE_ID).toBe('d2');
  });
});

describe('D2_MONARCH_TOKENIZER', () => {
  it('has expected top-level properties', () => {
    expect(D2_MONARCH_TOKENIZER.defaultToken).toBe('');
    expect(D2_MONARCH_TOKENIZER.tokenPostfix).toBe('.d2');
  });

  it('includes core D2 keywords', () => {
    const kw = D2_MONARCH_TOKENIZER.keywords;
    expect(kw).toContain('direction');
    expect(kw).toContain('shape');
    expect(kw).toContain('style');
    expect(kw).toContain('label');
    expect(kw).toContain('icon');
    expect(kw).toContain('class');
    expect(kw).toContain('classes');
    expect(kw).toContain('constraint');
    expect(kw).toContain('grid-columns');
    expect(kw).toContain('grid-rows');
  });

  it('includes style keywords', () => {
    const kw = D2_MONARCH_TOKENIZER.keywords;
    expect(kw).toContain('fill');
    expect(kw).toContain('stroke');
    expect(kw).toContain('stroke-width');
    expect(kw).toContain('opacity');
    expect(kw).toContain('animated');
    expect(kw).toContain('3d');
    expect(kw).toContain('bold');
    expect(kw).toContain('italic');
  });

  it('includes common D2 shapes', () => {
    const shapes = D2_MONARCH_TOKENIZER.shapes;
    expect(shapes).toContain('rectangle');
    expect(shapes).toContain('cylinder');
    expect(shapes).toContain('queue');
    expect(shapes).toContain('diamond');
    expect(shapes).toContain('cloud');
    expect(shapes).toContain('sql_table');
    expect(shapes).toContain('sequence_diagram');
    expect(shapes).toContain('c4-person');
  });

  it('includes all 4 directions', () => {
    expect(D2_MONARCH_TOKENIZER.directions).toEqual(['up', 'down', 'left', 'right']);
  });

  it('has root tokenizer rules', () => {
    const root = D2_MONARCH_TOKENIZER.tokenizer.root;
    expect(Array.isArray(root)).toBe(true);
    expect(root.length).toBeGreaterThan(0);
  });

  it('has string_double and string_single states', () => {
    expect(D2_MONARCH_TOKENIZER.tokenizer.string_double).toBeDefined();
    expect(D2_MONARCH_TOKENIZER.tokenizer.string_single).toBeDefined();
  });

  it('comment rule matches # prefix', () => {
    const commentRule = D2_MONARCH_TOKENIZER.tokenizer.root[0] as [RegExp, string];
    expect(commentRule[0]).toBeInstanceOf(RegExp);
    expect(commentRule[1]).toBe('comment');
    expect(commentRule[0].test('# this is a comment')).toBe(true);
  });

  it('arrow rule matches D2 arrow operators', () => {
    // Find the arrow rule
    const arrowRule = (D2_MONARCH_TOKENIZER.tokenizer.root as any[]).find(
      (r) => r[1] === 'keyword.operator' && r[0] instanceof RegExp && r[0].source.includes('->')
    );
    expect(arrowRule).toBeDefined();
    const regex = arrowRule![0] as RegExp;
    expect(regex.test('->')).toBe(true);
    expect(regex.test('<-')).toBe(true);
    expect(regex.test('<->')).toBe(true);
    expect(regex.test('--')).toBe(true);
    expect(regex.test('-->')).toBe(true);
    expect(regex.test('<--')).toBe(true);
  });
});

describe('D2_COMPLETION_ITEMS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(D2_COMPLETION_ITEMS)).toBe(true);
    expect(D2_COMPLETION_ITEMS.length).toBeGreaterThan(0);
  });

  it('every item has required fields', () => {
    for (const item of D2_COMPLETION_ITEMS) {
      expect(item).toHaveProperty('label');
      expect(item).toHaveProperty('kind');
      expect(item).toHaveProperty('insertText');
      expect(item).toHaveProperty('detail');
      expect(typeof item.label).toBe('string');
      expect(typeof item.kind).toBe('number');
    }
  });

  it('includes keyword completions', () => {
    const labels = D2_COMPLETION_ITEMS.map((i) => i.label);
    expect(labels).toContain('direction');
    expect(labels).toContain('shape');
    expect(labels).toContain('style');
    expect(labels).toContain('label');
  });

  it('includes shape completions', () => {
    const labels = D2_COMPLETION_ITEMS.map((i) => i.label);
    expect(labels).toContain('rectangle');
    expect(labels).toContain('cylinder');
    expect(labels).toContain('queue');
    expect(labels).toContain('c4-person');
  });

  it('includes direction completions', () => {
    const labels = D2_COMPLETION_ITEMS.map((i) => i.label);
    expect(labels).toContain('up');
    expect(labels).toContain('down');
    expect(labels).toContain('left');
    expect(labels).toContain('right');
  });

  it('includes style property completions', () => {
    const labels = D2_COMPLETION_ITEMS.map((i) => i.label);
    expect(labels).toContain('fill');
    expect(labels).toContain('stroke');
    expect(labels).toContain('opacity');
    expect(labels).toContain('animated');
  });

  it('keyword items use kind 14 (Keyword)', () => {
    const direction = D2_COMPLETION_ITEMS.find((i) => i.label === 'direction');
    expect(direction?.kind).toBe(14);
  });

  it('shape items use kind 12 (Value)', () => {
    const rect = D2_COMPLETION_ITEMS.find((i) => i.label === 'rectangle');
    expect(rect?.kind).toBe(12);
  });

  it('style items append colon-space in insertText', () => {
    const fill = D2_COMPLETION_ITEMS.find((i) => i.label === 'fill');
    expect(fill?.insertText).toBe('fill: ');
  });
});
