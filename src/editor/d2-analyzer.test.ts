import { describe, it, expect } from 'vitest';
import { analyzeD2Block } from './d2-analyzer';

describe('analyzeD2Block (regex fallback)', () => {
  it('counts shapes in braced blocks', () => {
    const code = `server {
  shape: rectangle
}

client {
  shape: oval
}`;
    const meta = analyzeD2Block(code);
    expect(meta.shapeCount).toBe(2);
    expect(meta.topIdentifiers).toEqual(['server', 'client']);
  });

  it('counts connections', () => {
    const code = `a -> b
b -> c
c <-> d`;
    const meta = analyzeD2Block(code);
    expect(meta.connectionCount).toBe(3);
  });

  it('detects nesting depth', () => {
    const code = `outer {
  middle {
    inner {
      shape: circle
    }
  }
}`;
    const meta = analyzeD2Block(code);
    expect(meta.nestingDepth).toBe(3);
  });

  it('detects styles', () => {
    const code = `server {
  style.fill: "#ddd"
}`;
    const meta = analyzeD2Block(code);
    expect(meta.hasStyles).toBe(true);
  });

  it('detects classes', () => {
    const code = `classes {
  highlight {
    style.fill: red
  }
}`;
    const meta = analyzeD2Block(code);
    expect(meta.hasClasses).toBe(true);
  });

  it('categorizes as flow when connections dominate', () => {
    const code = `a -> b
b -> c
c -> d`;
    const meta = analyzeD2Block(code);
    expect(meta.category).toBe('flow');
  });

  it('categorizes as component for simple shapes', () => {
    const code = `server {
  shape: rectangle
}`;
    const meta = analyzeD2Block(code);
    expect(meta.category).toBe('component');
  });

  it('categorizes as sequence when sequence_diagram present', () => {
    const code = `diagram {
  shape: sequence_diagram
  alice -> bob: hello
}`;
    const meta = analyzeD2Block(code);
    expect(meta.category).toBe('sequence');
  });

  it('categorizes as grid when grid properties present', () => {
    const code = `layout {
  grid-columns: 3
  a
  b
  c
}`;
    const meta = analyzeD2Block(code);
    expect(meta.category).toBe('grid');
  });

  it('categorizes as mixed when both shapes and connections', () => {
    const code = `server {
  shape: rectangle
}
client {
  shape: oval
}
db {
  shape: cylinder
}
extra {
  shape: cloud
}
server -> client
client -> db`;
    const meta = analyzeD2Block(code);
    expect(meta.category).toBe('mixed');
  });

  it('returns simple for empty/comment-only input', () => {
    expect(analyzeD2Block('').category).toBe('simple');
    expect(analyzeD2Block('# just a comment').category).toBe('simple');
  });

  it('skips D2 keywords from shape count', () => {
    const code = `server {
  shape: rectangle
  label: "My Server"
  style.fill: blue
}`;
    const meta = analyzeD2Block(code);
    expect(meta.shapeCount).toBe(1);
    expect(meta.topIdentifiers).toEqual(['server']);
  });

  it('limits topIdentifiers to 5', () => {
    const code = `a {}\nb {}\nc {}\nd {}\ne {}\nf {}\ng {}`;
    const meta = analyzeD2Block(code);
    expect(meta.topIdentifiers).toHaveLength(5);
  });
});
