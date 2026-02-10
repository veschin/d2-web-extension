export interface MacroInfo {
  /** Index of this macro in DOM order (0-based) */
  domIndex: number;
  /** Persistent macro-id from Confluence storage format */
  macroId: string;
  /** D2 source code */
  code: string;
  /** Macro parameters */
  params: MacroParams;
  /** Which page mode the macro was detected in */
  mode: 'view' | 'edit';
  /** Cached SVG from page DOM (view mode only, for popup thumbnails) */
  cachedSvg?: string;
}

export interface MacroParams {
  theme: string;
  layout: string;
  scale: string;
  sketch: string;
  direction: string;
  preset: string;
  server: string;
  format: string;
}

export const DEFAULT_PARAMS: MacroParams = {
  theme: '1',
  layout: 'elk',
  scale: '0.8',
  sketch: 'false',
  direction: 'down',
  preset: '',
  server: '',
  format: 'svg',
};

export interface PageState {
  pageId: string;
  url: string;
  title: string;
  spaceKey: string;
  version: number;
  macros: MacroInfo[];
  detectedAt: number;
}

export interface PageMeta {
  pageId: string;
  spaceKey: string;
  pageTitle: string;
  pageVersion: string;
  baseUrl: string;
  atlToken: string;
  parentPageId: string;
}

/** Reference library: a configured source page per Confluence space */
export interface ReferenceSource {
  spaceKey: string;
  pageTitle: string;
  /** Optional: only use specific macro indices from the page */
  macroIndices?: number[];
}

/** A single reusable D2 block extracted from a reference page */
export interface ReferenceBlock {
  name: string;
  code: string;
  /** Source page info */
  sourcePageTitle: string;
  sourceSpaceKey: string;
  /** Index within the source macro */
  blockIndex: number;
  /** Macro index on the page */
  macroIndex: number;
}

/** Semantic metadata extracted from a D2 block via tree-sitter AST */
export interface BlockMetadata {
  shapeCount: number;
  connectionCount: number;
  nestingDepth: number;
  category: 'component' | 'flow' | 'sequence' | 'grid' | 'mixed' | 'simple';
  hasStyles: boolean;
  hasClasses: boolean;
  topIdentifiers: string[];
}

/** A ReferenceBlock enriched with metadata and optional SVG preview */
export interface EnrichedBlock extends ReferenceBlock {
  metadata?: BlockMetadata;
  svgThumbnail?: string;
}

/** A macro with its parsed blocks, used for hierarchical library navigation */
export interface ReferenceMacro {
  index: number;
  code: string;
  blocks: ReferenceBlock[];
}

/** Cached reference data for a space */
export interface ReferenceCache {
  spaceKey: string;
  blocks: ReferenceBlock[];
  fetchedAt: number;
  pageVersion: number;
}

/** Messages between content script ↔ service worker ↔ popup */
export type ExtMessage =
  | { type: 'get-macros' }
  | { type: 'macros-detected'; macros: MacroInfo[]; pageMeta: PageMeta }
  | { type: 'open-editor'; macroIndex: number }
  | { type: 'save-macro'; macroIndex: number; newCode: string }
  | { type: 'save-result'; success: boolean; error?: string }
  | { type: 'confluence-api'; method: string; url: string; body?: string }
  | { type: 'confluence-api-result'; status: number; data: string }
  | { type: 'get-references'; spaceKey: string }
  | { type: 'refresh-references'; spaceKey: string }
  | { type: 'get-reference-sources' }
  | { type: 'set-reference-sources'; sources: ReferenceSource[] }
  | { type: 'get-reference-macros'; spaceKey: string; forceRefresh?: boolean };
