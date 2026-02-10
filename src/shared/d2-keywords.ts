/**
 * D2 keyword set shared between parser and analyzer.
 * These are D2 directives/properties that should not be treated as user-defined shapes.
 */

export const D2_KEYWORD_SET = new Set([
  'direction', 'shape', 'style', 'label', 'icon', 'near', 'tooltip',
  'link', 'class', 'classes', 'constraint', 'width', 'height',
  'grid-columns', 'grid-rows', 'grid-gap', 'vertical-gap', 'horizontal-gap',
  'fill', 'stroke', 'stroke-width', 'stroke-dash', 'border-radius',
  'shadow', 'opacity', 'bold', 'italic', 'underline', 'text-transform',
  'double-border', 'multiple', '3d', 'animated', 'filled',
  'source-arrowhead', 'target-arrowhead', 'font-size', 'font-color',
  'top', 'left',
]);

export function isD2Keyword(word: string): boolean {
  if (D2_KEYWORD_SET.has(word)) return true;
  // Also match dotted keywords like `style.fill`, `style.stroke`, etc.
  const dot = word.indexOf('.');
  if (dot > 0) return D2_KEYWORD_SET.has(word.substring(0, dot));
  return false;
}
