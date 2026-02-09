import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  logInfo,
  logWarn,
  logError,
  logTimed,
  getEntriesSync,
  clearLog,
  _resetForTesting,
} from './logger';

describe('logger', () => {
  beforeEach(() => {
    _resetForTesting();
    vi.restoreAllMocks();
  });

  it('logInfo pushes an info entry', () => {
    logInfo('detector', 'Found macros', { count: 3 });
    const entries = getEntriesSync();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('info');
    expect(entries[0].source).toBe('detector');
    expect(entries[0].message).toBe('Found macros');
    expect(entries[0].data).toEqual({ count: 3 });
    expect(entries[0].ts).toBeGreaterThan(0);
  });

  it('logWarn pushes a warn entry', () => {
    logWarn('api', 'Retrying request');
    const entries = getEntriesSync();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warn');
    expect(entries[0].source).toBe('api');
  });

  it('logError pushes an error entry', () => {
    logError('save', 'Save failed', { status: 409 });
    const entries = getEntriesSync();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
    expect(entries[0].data).toEqual({ status: 409 });
  });

  it('entries accumulate in order', () => {
    logInfo('detector', 'first');
    logWarn('editor', 'second');
    logError('save', 'third');
    const entries = getEntriesSync();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.message)).toEqual(['first', 'second', 'third']);
  });

  it('ring buffer caps at 500 entries', () => {
    // Suppress console output for this test
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let i = 0; i < 600; i++) {
      logInfo('system', `entry ${i}`);
    }
    const entries = getEntriesSync();
    expect(entries).toHaveLength(500);
    expect(entries[0].message).toBe('entry 100');
    expect(entries[499].message).toBe('entry 599');
  });

  it('clearLog empties entries', async () => {
    logInfo('detector', 'test');
    expect(getEntriesSync()).toHaveLength(1);
    await clearLog();
    expect(getEntriesSync()).toHaveLength(0);
  });

  it('logTimed records duration for sync function', async () => {
    const result = await logTimed('preview', 'Render SVG', () => 42);
    expect(result).toBe(42);
    const entries = getEntriesSync();
    expect(entries).toHaveLength(1);
    expect(entries[0].durationMs).toBeTypeOf('number');
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(entries[0].level).toBe('info');
  });

  it('logTimed records duration for async function', async () => {
    const result = await logTimed('api', 'Fetch page', async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'done';
    });
    expect(result).toBe('done');
    const entries = getEntriesSync();
    expect(entries).toHaveLength(1);
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(5);
  });

  it('logTimed logs error and rethrows on failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      logTimed('save', 'Save page', () => {
        throw new Error('conflict');
      })
    ).rejects.toThrow('conflict');
    const entries = getEntriesSync();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
    expect(entries[0].message).toContain('conflict');
    expect(entries[0].durationMs).toBeTypeOf('number');
  });

  it('logTimed passes optional data', async () => {
    await logTimed('api', 'API call', () => 'ok', { url: '/rest/api' });
    const entries = getEntriesSync();
    expect(entries[0].data).toEqual({ url: '/rest/api' });
  });

  it('console.log is called for info entries', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logInfo('system', 'hello');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('[d2ext:system]');
    expect(spy.mock.calls[0][0]).toContain('hello');
  });

  it('console.warn is called for warn entries', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn('editor', 'watch out');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('console.error is called for error entries', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('save', 'failed');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('data field is optional', () => {
    logInfo('detector', 'no data');
    const entries = getEntriesSync();
    expect(entries[0].data).toBeUndefined();
  });

  it('_resetForTesting clears all state', () => {
    logInfo('system', 'test');
    expect(getEntriesSync()).toHaveLength(1);
    _resetForTesting();
    expect(getEntriesSync()).toHaveLength(0);
  });
});
