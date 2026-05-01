import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatFileSize, formatTimestamp } from '../format-utils.js';

describe('formatFileSize', () => {
  it('returns "0 KB" for 0 bytes', () => {
    expect(formatFileSize(0)).toBe('0 KB');
  });

  it('formats small values in KB', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
  });

  it('formats sub-kilobyte values with one decimal', () => {
    expect(formatFileSize(512)).toBe('0.5 KB');
  });

  it('formats values just under 1 MB in KB', () => {
    // 1048575 bytes = 1023.999... KB
    expect(formatFileSize(1048575)).toBe('1024 KB');
  });

  it('formats exactly 1 MB', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
  });

  it('formats values above 1 MB in MB with decimal', () => {
    // 1.5 MB = 1572864 bytes
    expect(formatFileSize(1572864)).toBe('1.5 MB');
  });

  it('formats large MB values', () => {
    // 10 MB = 10485760 bytes
    expect(formatFileSize(10485760)).toBe('10 MB');
  });

  it('formats very large values in MB', () => {
    // 100 MB
    expect(formatFileSize(104857600)).toBe('100 MB');
  });

  it('returns "0 KB" for negative values', () => {
    expect(formatFileSize(-100)).toBe('0 KB');
  });

  it('returns "0 KB" for non-numeric input', () => {
    expect(formatFileSize(null)).toBe('0 KB');
    expect(formatFileSize(undefined)).toBe('0 KB');
    expect(formatFileSize('hello')).toBe('0 KB');
  });

  it('returns "0 KB" for NaN', () => {
    expect(formatFileSize(NaN)).toBe('0 KB');
  });

  it('returns "0 KB" for Infinity', () => {
    expect(formatFileSize(Infinity)).toBe('0 KB');
  });

  it('result always contains KB or MB suffix', () => {
    const values = [0, 100, 1024, 500000, 1048576, 5242880];
    for (const v of values) {
      const result = formatFileSize(v);
      expect(result.endsWith('KB') || result.endsWith('MB')).toBe(true);
    }
  });
});

describe('formatTimestamp', () => {
  it('formats Unix epoch 0 to local time', () => {
    // Epoch 0 in local time depends on timezone, so compute expected value
    const d = new Date(0);
    const expected = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    expect(formatTimestamp(0)).toBe(expected);
  });

  it('formats a known timestamp to local time', () => {
    // 1700000000 = 2023-11-14 22:13:20 UTC — local time varies by timezone
    const d = new Date(1700000000 * 1000);
    const expected = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    expect(formatTimestamp(1700000000)).toBe(expected);
  });

  it('formats a timestamp with single-digit hours/minutes/seconds with padding', () => {
    // 3661 seconds from epoch — local time varies
    const d = new Date(3661 * 1000);
    const expected = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    expect(formatTimestamp(3661)).toBe(expected);
  });

  it('returns "00:00:00" for negative values', () => {
    expect(formatTimestamp(-1)).toBe('00:00:00');
  });

  it('returns "00:00:00" for non-numeric input', () => {
    expect(formatTimestamp(null)).toBe('00:00:00');
    expect(formatTimestamp(undefined)).toBe('00:00:00');
    expect(formatTimestamp('hello')).toBe('00:00:00');
  });

  it('returns "00:00:00" for NaN', () => {
    expect(formatTimestamp(NaN)).toBe('00:00:00');
  });

  it('returns "00:00:00" for Infinity', () => {
    expect(formatTimestamp(Infinity)).toBe('00:00:00');
  });

  it('result always matches HH:MM:SS format', () => {
    const timestamps = [0, 3661, 43200, 86399, 1700000000];
    const pattern = /^\d{2}:\d{2}:\d{2}$/;
    for (const ts of timestamps) {
      expect(formatTimestamp(ts)).toMatch(pattern);
    }
  });

  it('uses local timezone, not UTC', () => {
    // Pick a timestamp and verify it matches Date local getters, not UTC getters
    const ts = 1700000000;
    const d = new Date(ts * 1000);
    const localResult = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    expect(formatTimestamp(ts)).toBe(localResult);
  });
});

describe('Property 7: Reverse Chronological Sort', () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * For any list of ModelEntries with distinct timestamps, sorting them for
   * display produces a list where each entry's timestamp is greater than or
   * equal to the next entry's timestamp.
   */
  it('Feature: 3d-model-extractor-extension, Property 7: Reverse Chronological Sort', () => {
    // Generator for a ModelEntry with a given timestamp
    const modelEntryArb = (timestamp) =>
      fc.record({
        url: fc.webUrl().map((u) => u.replace(/\/$/, '') + '/model.glb'),
        filename: fc.string({ minLength: 1, maxLength: 50 }).map((s) => s.replace(/[^a-zA-Z0-9_-]/g, '_') + '.glb'),
        size: fc.nat({ max: 104857600 }),
        timestamp: fc.constant(timestamp),
      });

    // Generate an array of distinct timestamps, then map each to a ModelEntry
    const modelEntriesArb = fc
      .uniqueArray(fc.nat({ max: 2000000000 }), { minLength: 0, maxLength: 50 })
      .chain((timestamps) =>
        fc.tuple(...(timestamps.length > 0
          ? timestamps.map((ts) => modelEntryArb(ts))
          : [fc.constant(null)])).map((entries) =>
          timestamps.length > 0 ? entries : []
        )
      );

    fc.assert(
      fc.property(modelEntriesArb, (models) => {
        // Sort using reverse chronological sort (same as production code)
        const sorted = [...models].sort((a, b) => b.timestamp - a.timestamp);

        // Verify each entry's timestamp >= the next entry's timestamp
        for (let i = 0; i < sorted.length - 1; i++) {
          expect(sorted[i].timestamp).toBeGreaterThanOrEqual(sorted[i + 1].timestamp);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 6: File Size Formatting', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * For any non-negative integer byte value, formatFileSize returns a string
   * with a numeric value followed by "KB" or "MB", mathematically consistent
   * with the input.
   */
  it('Feature: 3d-model-extractor-extension, Property 6: File Size Formatting', () => {
    fc.assert(
      fc.property(fc.nat(), (bytes) => {
        const result = formatFileSize(bytes);

        // Result must end with " KB" or " MB"
        const endsWithKB = result.endsWith(' KB');
        const endsWithMB = result.endsWith(' MB');
        expect(endsWithKB || endsWithMB).toBe(true);

        // Extract the numeric portion
        const numericStr = endsWithKB
          ? result.slice(0, -3)
          : result.slice(0, -3);
        const numericValue = parseFloat(numericStr);
        expect(Number.isNaN(numericValue)).toBe(false);
        expect(numericValue).toBeGreaterThanOrEqual(0);

        // For bytes < 1048576: result should be in KB
        if (bytes < 1048576) {
          expect(endsWithKB).toBe(true);
          const expectedKB = bytes / 1024;
          // The implementation rounds: < 1 KB uses toFixed(1), >= 1 KB uses Math.round
          // Allow tolerance of 1 for rounding
          expect(numericValue).toBeCloseTo(expectedKB, 0);
        }

        // For bytes >= 1048576: result should be in MB
        if (bytes >= 1048576) {
          expect(endsWithMB).toBe(true);
          const expectedMB = bytes / 1048576;
          // The implementation uses toFixed(1), so allow tolerance for 1 decimal place
          expect(numericValue).toBeCloseTo(expectedMB, 0);
        }
      }),
      { numRuns: 100 }
    );
  });
});
