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

  it('treats "name: {" with colon as a single braced block', () => {
    const source = `g_ex: {
  label: external systems
  ex_ord: "ORD"
  ex_fns: "FNS"
  ex_smev: "SMEV3"
}`;
    const blocks = extractD2Blocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('g_ex');
    expect(blocks[0].code).toBe(source);
  });

  it('does not split nested properties into separate blocks', () => {
    const source = 'db_dwh: "DWH\\n[Clickhouse]"\n\ng_ex: {\n  label: external\n  ex_ord: "ORD"\n  ex_fns: "FNS"\n}\n\ndb_dwh -> g_ex.ex_ord';
    const blocks = extractD2Blocks(source);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].name).toBe('db_dwh');
    expect(blocks[1].name).toBe('g_ex');
    expect(blocks[2].name).toBe('db_dwh -> g_ex.ex_ord');
  });

  it('parses complex real-world D2 with deep nesting and styled connections', () => {
    const source = `bank: {
  style.fill: white
  Corporate: {
    style.fill: white
    app14506: Data Source\\ntco: 100,000\\nowner: Lakshmi {
      style: {
        fill: '#fce7c6'
      }
    }
  }
  Equities: {
    app14491: Risk Global\\ntco: 600,000\\nowner: Wendy {
      style: {
        fill: '#f6c889'
      }
    }
    app14492: Credit guard\\ntco: 100,000\\nowner: Lakshmi {
      style: {
        fill: '#fce7c6'
      }
    }
  }
  Finance: {
    style.fill: white
    app14502: Ark Crypto\\ntco: 1,500,000\\nowner: Wendy {
      style: {
        fill: '#ed800c'
      }
    }
  }
}
bank.Equities.app14491 -> bank.Finance.app14502: greeks {
  style: {
    stroke-dash: 5
    animated: true
    stroke: red
  }
}
bank.Equities.app14492 -> bank.Corporate.app14506: trades`;
    const blocks = extractD2Blocks(source);
    // Should produce: bank (braced), connection1 (braced), connection2 (standalone)
    expect(blocks).toHaveLength(3);
    expect(blocks[0].name).toBe('bank');
    // Connection with style block
    expect(blocks[1].name).toContain('bank.Equities.app14491');
    expect(blocks[1].code).toContain('stroke-dash');
    // Simple connection
    expect(blocks[2].name).toContain('bank.Equities.app14492');
  });

  // --- Directive filtering ---

  describe('directive filtering', () => {
    it('filters out grid-columns directive', () => {
      const source = `grid-columns: 3
a
b
c`;
      const blocks = extractD2Blocks(source);
      expect(blocks.every(b => b.name !== 'grid-columns')).toBe(true);
      expect(blocks.map(b => b.name)).toEqual(['a', 'b', 'c']);
    });

    it('filters out direction directive', () => {
      const source = `direction: right
server {
  shape: rectangle
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].name).toBe('server');
    });

    it('filters out style directive at top level', () => {
      const source = `style: {
  fill: white
}
server {
  shape: rectangle
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].name).toBe('server');
    });

    it('filters out classes directive at top level', () => {
      const source = `classes: {
  myclass: {
    style.fill: red
  }
}
server {
  shape: rectangle
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].name).toBe('server');
    });

    it('filters directives from children too', () => {
      const source = `g_ex: {
  direction: right
  label: "External Systems"
  ex_ord: "ORD"
  ex_fns: "FNS"
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      const children = blocks[0].children;
      expect(children).toBeDefined();
      // direction and label are directives; ex_ord and ex_fns are shapes
      const childNames = children!.map(c => c.name);
      expect(childNames).not.toContain('direction');
      expect(childNames).not.toContain('label');
      expect(childNames).toContain('ex_ord');
      expect(childNames).toContain('ex_fns');
    });
  });

  // --- Children extraction ---

  describe('children extraction', () => {
    it('extracts children from a container block', () => {
      const source = `g_ex: {
  ex_ord: "ORD"
  ex_fns: "FNS"
  ex_smev: "SMEV3"
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].name).toBe('g_ex');
      expect(blocks[0].children).toBeDefined();
      expect(blocks[0].children).toHaveLength(3);
      expect(blocks[0].children!.map(c => c.name)).toEqual(['ex_ord', 'ex_fns', 'ex_smev']);
    });

    it('extracts nested children recursively', () => {
      const source = `outer: {
  middle: {
    inner: "deep"
  }
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].children).toBeDefined();
      expect(blocks[0].children).toHaveLength(1);
      expect(blocks[0].children![0].name).toBe('middle');
      expect(blocks[0].children![0].children).toBeDefined();
      expect(blocks[0].children![0].children).toHaveLength(1);
      expect(blocks[0].children![0].children![0].name).toBe('inner');
    });

    it('does not add children for blocks without sub-blocks', () => {
      const source = `simple: "just a label"`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].children).toBeUndefined();
    });

    it('does not add children when container only has directives', () => {
      const source = `g: {
  style.fill: red
  direction: right
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].children).toBeUndefined();
    });
  });

  // --- Label extraction ---

  describe('label extraction', () => {
    it('extracts inline label from standalone statement', () => {
      const source = `db_dwh: "DWH"`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].label).toBe('DWH');
    });

    it('extracts label property from inside a block', () => {
      const source = `g_ex: {
  label: "External Systems"
  ex_ord: "ORD"
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].label).toBe('External Systems');
    });

    it('extracts unquoted label property from inside a block', () => {
      const source = `g_ex: {
  label: external systems
  ex_ord: "ORD"
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].label).toBe('external systems');
    });

    it('replaces \\n with space in labels', () => {
      const source = `db_dwh: "DWH\\n[Clickhouse]"`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].label).toBe('DWH [Clickhouse]');
    });

    it('truncates long labels to 60 characters', () => {
      const longLabel = 'A'.repeat(80);
      const source = `node: "${longLabel}"`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].label!.length).toBeLessThanOrEqual(60);
      expect(blocks[0].label).toContain('...');
    });

    it('returns undefined label for blocks without one', () => {
      const source = `server {
  shape: rectangle
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].label).toBeUndefined();
    });

    it('extracts labels from children blocks', () => {
      const source = `g_ex: {
  ex_ord: "ORD"
  ex_fns: "FNS"
}`;
      const blocks = extractD2Blocks(source);
      expect(blocks[0].children).toBeDefined();
      expect(blocks[0].children![0].label).toBe('ORD');
      expect(blocks[0].children![1].label).toBe('FNS');
    });
  });
});
