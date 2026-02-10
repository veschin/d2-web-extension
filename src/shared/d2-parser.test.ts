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

  it('handles grid-columns and other directives as single-line blocks', () => {
    const source = `grid-columns: 3
a
b
c`;
    const blocks = extractD2Blocks(source);
    expect(blocks[0].name).toBe('grid-columns');
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
});
