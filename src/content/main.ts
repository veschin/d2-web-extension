/**
 * Single entry point for all content scripts.
 * Bundled as IIFE to avoid ESM export/import.meta issues in content script context.
 */

import './detector';
import './overlay-buttons';
import './editor-modal';
