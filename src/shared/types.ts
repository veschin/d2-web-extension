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

/** Messages between content script ↔ service worker ↔ popup */
export type ExtMessage =
  | { type: 'get-macros' }
  | { type: 'macros-detected'; macros: MacroInfo[]; pageMeta: PageMeta }
  | { type: 'open-editor'; macroIndex: number }
  | { type: 'save-macro'; macroIndex: number; newCode: string }
  | { type: 'save-result'; success: boolean; error?: string }
  | { type: 'confluence-api'; method: string; url: string; body?: string }
  | { type: 'confluence-api-result'; status: number; data: string };
