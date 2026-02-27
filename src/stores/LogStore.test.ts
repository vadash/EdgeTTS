// LoggerStore Tests
// Test the LoggerStore functionality

import { beforeEach, describe, expect, it } from 'vitest';
import { LoggerStore } from '@/services/Logger';

describe('LoggerStore', () => {
  let store: LoggerStore;

  beforeEach(() => {
    store = new LoggerStore();
  });

  describe('add', () => {
    it('should add log entries', () => {
      store.add('info', 'Test message');
      expect(store.entries.value).toHaveLength(1);
      expect(store.entries.value[0].message).toBe('Test message');
      expect(store.entries.value[0].level).toBe('info');
    });

    it('should include timestamp and elapsed time', () => {
      store.startTimer();
      store.add('info', 'Test');
      const entry = store.entries.value[0];
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.elapsed).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should trim entries to maxEntries', () => {
      store.setMaxEntries(3);
      store.add('info', 'Message 1');
      store.add('info', 'Message 2');
      store.add('info', 'Message 3');
      store.add('info', 'Message 4');

      expect(store.entries.value).toHaveLength(3);
      expect(store.entries.value[0].message).toBe('Message 2');
      expect(store.entries.value[2].message).toBe('Message 4');
    });
  });

  describe('convenience methods', () => {
    it('info() should add info level entry', () => {
      store.info('Info message');
      expect(store.entries.value[0].level).toBe('info');
    });

    it('warn() should add warn level entry', () => {
      store.warn('Warning message');
      expect(store.entries.value[0].level).toBe('warn');
    });

    it('error() should add error level entry', () => {
      store.error('Error message');
      expect(store.entries.value[0].level).toBe('error');
    });

    it('debug() should only log to console (not stored)', () => {
      store.debug('Debug message');
      // debug() only logs to console, doesn't store entries
      expect(store.entries.value).toHaveLength(0);
    });
  });

  describe('computed properties', () => {
    beforeEach(() => {
      store.add('info', 'Info 1');
      store.add('warn', 'Warning 1');
      store.add('error', 'Error 1');
      store.add('info', 'Info 2');
      store.add('warn', 'Warning 2');
    });

    it('count should return total entries', () => {
      expect(store.count.value).toBe(5);
    });

    it('hasEntries should return true when entries exist', () => {
      expect(store.hasEntries.value).toBe(true);
    });

    it('hasEntries should return false when empty', () => {
      store.clear();
      expect(store.hasEntries.value).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      store.add('info', 'Test 1');
      store.add('info', 'Test 2');
      store.clear();
      expect(store.entries.value).toHaveLength(0);
    });
  });

  describe('export', () => {
    beforeEach(() => {
      store.startTimer();
      store.add('info', 'Test message', { key: 'value' });
    });

    it('toText should return formatted text', () => {
      const text = store.toText();
      expect(text).toContain('[INFO]');
      expect(text).toContain('Test message');
      expect(text).toContain('"key":"value"');
    });

    it('toJSON should return valid JSON', () => {
      const json = store.toJSON();
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].message).toBe('Test message');
    });

    it('toDisplayLines should return array of formatted strings', () => {
      const lines = store.toDisplayLines();
      expect(Array.isArray(lines)).toBe(true);
      expect(lines[0]).toContain('Test message');
    });
  });
});
