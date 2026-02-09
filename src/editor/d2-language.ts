/** D2 language definition for Monaco Editor (Monarch tokenizer) */

export const D2_LANGUAGE_ID = 'd2';

export const D2_MONARCH_TOKENIZER = {
  defaultToken: '',
  tokenPostfix: '.d2',

  keywords: [
    'direction', 'shape', 'style', 'label', 'icon', 'near', 'tooltip',
    'link', 'class', 'classes', 'constraint', 'width', 'height',
    'grid-columns', 'grid-rows', 'grid-gap', 'vertical-gap', 'horizontal-gap',
    'top', 'left', 'font-size', 'font-color', 'fill', 'stroke', 'stroke-width',
    'stroke-dash', 'border-radius', 'shadow', 'opacity', 'bold', 'italic',
    'underline', 'text-transform', 'double-border', 'multiple', '3d',
    'animated', 'filled', 'source-arrowhead', 'target-arrowhead',
  ],

  shapes: [
    'rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder',
    'queue', 'package', 'step', 'callout', 'stored_data', 'person', 'diamond',
    'oval', 'circle', 'hexagon', 'cloud', 'text', 'code', 'class', 'sql_table',
    'image', 'sequence_diagram', 'c4-person',
  ],

  directions: ['up', 'down', 'left', 'right'],

  tokenizer: {
    root: [
      // Comments
      [/#.*$/, 'comment'],

      // Strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'], // unterminated
      [/"/, 'string', '@string_double'],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/'/, 'string', '@string_single'],

      // Block strings (pipe)
      [/\|[^|]*\|/, 'string'],

      // Arrows and connections
      [/<->|-->|<--|->|<-|--/, 'keyword.operator'],

      // Semicolons
      [/;/, 'delimiter'],

      // Braces
      [/[{}]/, 'delimiter.bracket'],
      [/[[\]]/, 'delimiter.square'],

      // Colons
      [/:/, 'delimiter'],

      // Numbers
      [/\b\d+(\.\d+)?\b/, 'number'],

      // Booleans
      [/\b(true|false)\b/, 'keyword'],

      // Keywords and identifiers
      [
        /[a-zA-Z_][\w-]*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@shapes': 'type',
            '@directions': 'constant',
            '@default': 'identifier',
          },
        },
      ],

      // Wildcards
      [/\*\*|\*/, 'keyword.operator'],
    ],

    string_double: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],

    string_single: [
      [/[^\\']+/, 'string'],
      [/\\./, 'string.escape'],
      [/'/, 'string', '@pop'],
    ],
  },
};

export const D2_COMPLETION_ITEMS = [
  // Keywords
  { label: 'direction', kind: 14, insertText: 'direction: ', detail: 'Set diagram direction' },
  { label: 'shape', kind: 14, insertText: 'shape: ', detail: 'Set node shape' },
  { label: 'style', kind: 14, insertText: 'style: {\n  $0\n}', insertTextRules: 4, detail: 'Style block' },
  { label: 'label', kind: 14, insertText: 'label: ', detail: 'Set label text' },
  { label: 'icon', kind: 14, insertText: 'icon: ', detail: 'Set icon URL' },
  { label: 'near', kind: 14, insertText: 'near: ', detail: 'Position label near edge' },
  { label: 'tooltip', kind: 14, insertText: 'tooltip: ', detail: 'Set tooltip text' },
  { label: 'link', kind: 14, insertText: 'link: ', detail: 'Set hyperlink' },
  { label: 'class', kind: 14, insertText: 'class: ', detail: 'Apply class' },
  { label: 'classes', kind: 14, insertText: 'classes: {\n  $0\n}', insertTextRules: 4, detail: 'Define classes' },
  { label: 'constraint', kind: 14, insertText: 'constraint: ', detail: 'Set constraint' },
  { label: 'width', kind: 14, insertText: 'width: ', detail: 'Set width' },
  { label: 'height', kind: 14, insertText: 'height: ', detail: 'Set height' },
  { label: 'grid-columns', kind: 14, insertText: 'grid-columns: ', detail: 'Grid columns count' },
  { label: 'grid-rows', kind: 14, insertText: 'grid-rows: ', detail: 'Grid rows count' },

  // Shapes
  ...['rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder',
    'queue', 'package', 'step', 'callout', 'stored_data', 'person', 'diamond',
    'oval', 'circle', 'hexagon', 'cloud', 'text', 'code', 'sql_table',
    'image', 'sequence_diagram', 'c4-person',
  ].map((s) => ({
    label: s, kind: 12, insertText: s, detail: `Shape: ${s}`,
  })),

  // Directions
  ...['up', 'down', 'left', 'right'].map((d) => ({
    label: d, kind: 21, insertText: d, detail: `Direction: ${d}`,
  })),

  // Style properties
  ...['fill', 'stroke', 'stroke-width', 'stroke-dash', 'border-radius',
    'shadow', 'opacity', 'font-size', 'font-color', 'bold', 'italic',
    'underline', 'double-border', 'multiple', '3d', 'animated', 'filled',
  ].map((p) => ({
    label: p, kind: 10, insertText: `${p}: `, detail: `Style: ${p}`,
  })),
];
