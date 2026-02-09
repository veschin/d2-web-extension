import { describe, it, expect } from 'vitest';
import {
  D2_LANGUAGE_ID,
  D2_KEYWORDS,
  D2_SHAPES,
  NODE_CLASS,
  UNNAMED_CLASS,
  d2Extensions,
  fallbackLanguage,
} from './d2-language';

describe('D2_LANGUAGE_ID', () => {
  it('is "d2"', () => {
    expect(D2_LANGUAGE_ID).toBe('d2');
  });
});

describe('D2_KEYWORDS', () => {
  it('includes core D2 keywords', () => {
    expect(D2_KEYWORDS.has('direction')).toBe(true);
    expect(D2_KEYWORDS.has('shape')).toBe(true);
    expect(D2_KEYWORDS.has('style')).toBe(true);
    expect(D2_KEYWORDS.has('label')).toBe(true);
    expect(D2_KEYWORDS.has('icon')).toBe(true);
    expect(D2_KEYWORDS.has('class')).toBe(true);
    expect(D2_KEYWORDS.has('classes')).toBe(true);
    expect(D2_KEYWORDS.has('constraint')).toBe(true);
    expect(D2_KEYWORDS.has('grid-columns')).toBe(true);
    expect(D2_KEYWORDS.has('grid-rows')).toBe(true);
  });

  it('includes style keywords', () => {
    expect(D2_KEYWORDS.has('fill')).toBe(true);
    expect(D2_KEYWORDS.has('stroke')).toBe(true);
    expect(D2_KEYWORDS.has('stroke-width')).toBe(true);
    expect(D2_KEYWORDS.has('opacity')).toBe(true);
    expect(D2_KEYWORDS.has('animated')).toBe(true);
    expect(D2_KEYWORDS.has('3d')).toBe(true);
    expect(D2_KEYWORDS.has('bold')).toBe(true);
    expect(D2_KEYWORDS.has('italic')).toBe(true);
  });
});

describe('D2_SHAPES', () => {
  it('includes common D2 shapes', () => {
    expect(D2_SHAPES.has('rectangle')).toBe(true);
    expect(D2_SHAPES.has('cylinder')).toBe(true);
    expect(D2_SHAPES.has('queue')).toBe(true);
    expect(D2_SHAPES.has('diamond')).toBe(true);
    expect(D2_SHAPES.has('cloud')).toBe(true);
    expect(D2_SHAPES.has('sql_table')).toBe(true);
    expect(D2_SHAPES.has('sequence_diagram')).toBe(true);
    expect(D2_SHAPES.has('c4-person')).toBe(true);
  });
});

describe('NODE_CLASS (tree-sitter mapping)', () => {
  it('maps comment nodes to cmt', () => {
    expect(NODE_CLASS.comment).toBe('cmt');
    expect(NODE_CLASS.block_comment).toBe('cmt');
  });

  it('maps connection to kw (keyword)', () => {
    expect(NODE_CLASS.connection).toBe('kw');
  });

  it('maps identifier to var', () => {
    expect(NODE_CLASS.identifier).toBe('var');
    expect(NODE_CLASS.identifier_chain).toBe('var');
  });

  it('maps label to str (string)', () => {
    expect(NODE_CLASS.label).toBe('str');
  });

  it('maps numeric types to num', () => {
    expect(NODE_CLASS.integer).toBe('num');
    expect(NODE_CLASS.float).toBe('num');
  });

  it('maps boolean to bool', () => {
    expect(NODE_CLASS.boolean).toBe('bool');
  });

  it('maps glob types to op (operator)', () => {
    expect(NODE_CLASS.glob).toBe('op');
    expect(NODE_CLASS.global_glob).toBe('op');
    expect(NODE_CLASS.recursive_glob).toBe('op');
  });
});

describe('UNNAMED_CLASS', () => {
  it('maps braces to brk', () => {
    expect(UNNAMED_CLASS['{']).toBe('brk');
    expect(UNNAMED_CLASS['}']).toBe('brk');
    expect(UNNAMED_CLASS['[']).toBe('brk');
    expect(UNNAMED_CLASS[']']).toBe('brk');
  });

  it('maps punctuation', () => {
    expect(UNNAMED_CLASS[':']).toBe('punc');
    expect(UNNAMED_CLASS[';']).toBe('punc');
  });

  it('maps boolean literals', () => {
    expect(UNNAMED_CLASS['true']).toBe('bool');
    expect(UNNAMED_CLASS['false']).toBe('bool');
  });
});

describe('d2Extensions', () => {
  it('returns fallback (array with 1 element) when no parser', () => {
    const exts = d2Extensions();
    expect(exts).toHaveLength(1);
  });
});

describe('fallbackLanguage', () => {
  it('is defined', () => {
    expect(fallbackLanguage).toBeDefined();
  });
});
