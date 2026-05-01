import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock the browser namespace before importing background.js
const mockBrowser = {
  action: {
    setBadgeText: vi.fn(() => Promise.resolve()),
    setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
  },
  webRequest: {
    onCompleted: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([{ id: 1 }])),
    onRemoved: {
      addListener: vi.fn(),
    },
    onUpdated: {
      addListener: vi.fn(),
    },
    onActivated: {
      addListener: vi.fn(),
    },
  },
  downloads: {
    download: vi.fn(() => Promise.resolve(1)),
  },
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
  },
  storage: {
    session: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    },
  },
};

// Set globalThis.browser so browser-api.js picks it up
globalThis.browser = mockBrowser;

const {
  tabModels,
  onRequestCompleted,
  updateBadge,
  onTabRemoved,
  onTabUpdated,
  onTabActivated,
  onMessage,
} = await import('../background.js');

// Capture listener registration state right after import (before beforeEach clears mocks)
const registeredOnRemoved = mockBrowser.tabs.onRemoved.addListener.mock.calls.some(
  ([fn]) => fn === onTabRemoved
);
const registeredOnUpdated = mockBrowser.tabs.onUpdated.addListener.mock.calls.some(
  ([fn]) => fn === onTabUpdated
);
const registeredOnActivated = mockBrowser.tabs.onActivated.addListener.mock.calls.some(
  ([fn]) => fn === onTabActivated
);
const registeredOnMessage = mockBrowser.runtime.onMessage.addListener.mock.calls.length > 0;

describe('Tab lifecycle event handlers', () => {
  beforeEach(() => {
    // Clear all tab state before each test
    tabModels.clear();
    vi.clearAllMocks();
  });

  describe('onTabRemoved', () => {
    it('removes all ModelEntries for the closed tab', () => {
      // Set up a tab with some models
      const tabId = 1;
      const models = new Map();
      models.set('https://example.com/a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      models.set('https://example.com/b.glb', {
        url: 'https://example.com/b.glb',
        filename: 'b.glb',
        size: 2048,
        timestamp: 1001,
      });
      tabModels.set(tabId, models);

      onTabRemoved(tabId);

      expect(tabModels.has(tabId)).toBe(false);
    });

    it('does not affect other tabs when a tab is removed', () => {
      const tab1Models = new Map();
      tab1Models.set('https://example.com/a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      const tab2Models = new Map();
      tab2Models.set('https://example.com/b.glb', {
        url: 'https://example.com/b.glb',
        filename: 'b.glb',
        size: 2048,
        timestamp: 1001,
      });
      tabModels.set(1, tab1Models);
      tabModels.set(2, tab2Models);

      onTabRemoved(1);

      expect(tabModels.has(1)).toBe(false);
      expect(tabModels.has(2)).toBe(true);
      expect(tabModels.get(2).size).toBe(1);
    });

    it('is a no-op for a tab with no models', () => {
      onTabRemoved(999);
      expect(tabModels.has(999)).toBe(false);
    });
  });

  describe('onTabUpdated', () => {
    it('preserves ModelEntries when changeInfo.status is "loading" (persistence)', () => {
      const tabId = 1;
      const models = new Map();
      models.set('https://example.com/a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      tabModels.set(tabId, models);

      onTabUpdated(tabId, { status: 'loading' });

      // Models should be preserved across navigation
      expect(tabModels.has(tabId)).toBe(true);
      expect(tabModels.get(tabId).size).toBe(1);
    });

    it('updates badge when navigation starts', () => {
      const tabId = 1;
      const models = new Map();
      models.set('https://example.com/a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      tabModels.set(tabId, models);

      onTabUpdated(tabId, { status: 'loading' });

      // Badge should reflect the preserved model count
      expect(mockBrowser.action.setBadgeText).toHaveBeenCalledWith({
        text: '1',
        tabId,
      });
    });

    it('does not clear models for non-loading status changes', () => {
      const tabId = 1;
      const models = new Map();
      models.set('https://example.com/a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      tabModels.set(tabId, models);

      onTabUpdated(tabId, { status: 'complete' });

      expect(tabModels.has(tabId)).toBe(true);
      expect(tabModels.get(tabId).size).toBe(1);
    });

    it('does not clear models when changeInfo has no status', () => {
      const tabId = 1;
      const models = new Map();
      models.set('https://example.com/a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      tabModels.set(tabId, models);

      onTabUpdated(tabId, { url: 'https://example.com/new-page' });

      expect(tabModels.has(tabId)).toBe(true);
      expect(tabModels.get(tabId).size).toBe(1);
    });

    it('does not affect other tabs during navigation', () => {
      const tab1Models = new Map();
      tab1Models.set('https://example.com/a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      const tab2Models = new Map();
      tab2Models.set('https://example.com/b.glb', {
        url: 'https://example.com/b.glb',
        filename: 'b.glb',
        size: 2048,
        timestamp: 1001,
      });
      tabModels.set(1, tab1Models);
      tabModels.set(2, tab2Models);

      onTabUpdated(1, { status: 'loading' });

      // Both tabs should still have their models (persistence)
      expect(tabModels.has(1)).toBe(true);
      expect(tabModels.has(2)).toBe(true);
      expect(tabModels.get(2).size).toBe(1);
    });
  });

  describe('onTabActivated', () => {
    it('updates badge for the newly active tab with models', () => {
      const tabId = 1;
      const models = new Map();
      models.set('https://example.com/a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      models.set('https://example.com/b.glb', {
        url: 'https://example.com/b.glb',
        filename: 'b.glb',
        size: 2048,
        timestamp: 1001,
      });
      tabModels.set(tabId, models);

      onTabActivated({ tabId });

      expect(mockBrowser.action.setBadgeText).toHaveBeenCalledWith({
        text: '2',
        tabId,
      });
    });

    it('updates badge to empty string for a tab with no models', () => {
      onTabActivated({ tabId: 42 });

      expect(mockBrowser.action.setBadgeText).toHaveBeenCalledWith({
        text: '',
        tabId: 42,
      });
    });
  });

  describe('Listener registration', () => {
    it('registers onTabRemoved listener', () => {
      expect(registeredOnRemoved).toBe(true);
    });

    it('registers onTabUpdated listener', () => {
      expect(registeredOnUpdated).toBe(true);
    });

    it('registers onTabActivated listener', () => {
      expect(registeredOnActivated).toBe(true);
    });
  });
});

describe('onMessage handler', () => {
  beforeEach(() => {
    tabModels.clear();
    vi.clearAllMocks();
    // Default: tabs.query returns tab with id 1
    mockBrowser.tabs.query.mockResolvedValue([{ id: 1 }]);
    mockBrowser.downloads.download.mockResolvedValue(1);
  });

  describe('getModels', () => {
    it('returns empty models array when no models exist for the active tab', async () => {
      const result = await onMessage({ type: 'getModels' }, {});
      expect(result).toEqual({ models: [] });
    });

    it('returns models sorted by timestamp descending (reverse chronological)', async () => {
      const models = new Map();
      models.set('https://example.com/old.glb', {
        url: 'https://example.com/old.glb',
        filename: 'old.glb',
        size: 1024,
        timestamp: 1000,
      });
      models.set('https://example.com/mid.glb', {
        url: 'https://example.com/mid.glb',
        filename: 'mid.glb',
        size: 2048,
        timestamp: 2000,
      });
      models.set('https://example.com/new.glb', {
        url: 'https://example.com/new.glb',
        filename: 'new.glb',
        size: 512,
        timestamp: 3000,
      });
      tabModels.set(1, models);

      const result = await onMessage({ type: 'getModels' }, {});

      expect(result.models).toHaveLength(3);
      expect(result.models[0].timestamp).toBe(3000);
      expect(result.models[1].timestamp).toBe(2000);
      expect(result.models[2].timestamp).toBe(1000);
    });

    it('queries the active tab in the current window', async () => {
      await onMessage({ type: 'getModels' }, {});
      expect(mockBrowser.tabs.query).toHaveBeenCalledWith({
        active: true,
        currentWindow: true,
      });
    });

    it('returns empty models array when tabs.query returns empty', async () => {
      mockBrowser.tabs.query.mockResolvedValue([]);
      const result = await onMessage({ type: 'getModels' }, {});
      expect(result).toEqual({ models: [] });
    });
  });

  describe('download', () => {
    it('downloads directly from the original URL', async () => {
      const result = await onMessage(
        { type: 'download', url: 'https://example.com/model.glb', filename: 'model.glb' },
        {}
      );

      expect(mockBrowser.downloads.download).toHaveBeenCalledWith({
        url: 'https://example.com/model.glb',
        filename: 'model.glb',
      });
      expect(result).toEqual({ success: true, decompressed: false });
    });

    it('returns error when download fails', async () => {
      mockBrowser.downloads.download.mockRejectedValueOnce(new Error('Network error'));

      const result = await onMessage(
        { type: 'download', url: 'https://example.com/model.glb', filename: 'model.glb' },
        {}
      );

      expect(result).toEqual({ success: false, error: 'Network error' });
    });
  });

  describe('downloadAll', () => {
    it('downloads all models for the active tab and returns results', async () => {
      const models = new Map();
      models.set('a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      models.set('b.glb', {
        url: 'https://example.com/b.glb',
        filename: 'b.glb',
        size: 2048,
        timestamp: 2000,
      });
      tabModels.set(1, models);

      const result = await onMessage({ type: 'downloadAll' }, {});

      expect(mockBrowser.downloads.download).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(2);
      expect(result.results.every((r) => r.success === true)).toBe(true);
    });

    it('collects individual download errors without stopping other downloads', async () => {
      const models = new Map();
      models.set('a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      models.set('b.glb', {
        url: 'https://example.com/b.glb',
        filename: 'b.glb',
        size: 2048,
        timestamp: 2000,
      });
      tabModels.set(1, models);

      // First download fails, second succeeds
      mockBrowser.downloads.download
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(1);

      const result = await onMessage({ type: 'downloadAll' }, {});

      expect(result.results).toHaveLength(2);
      const failed = result.results.find((r) => !r.success);
      const succeeded = result.results.find((r) => r.success);
      expect(failed).toBeDefined();
      expect(failed.error).toBe('Network error');
      expect(succeeded).toBeDefined();
    });

    it('returns empty results when no models exist for the active tab', async () => {
      const result = await onMessage({ type: 'downloadAll' }, {});
      expect(result).toEqual({ results: [] });
    });

    it('returns empty results when tabs.query returns empty', async () => {
      mockBrowser.tabs.query.mockResolvedValue([]);
      const result = await onMessage({ type: 'downloadAll' }, {});
      expect(result).toEqual({ results: [] });
    });

    it('passes correct url and filename for each download', async () => {
      const models = new Map();
      models.set('a.glb', {
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
        size: 1024,
        timestamp: 1000,
      });
      tabModels.set(1, models);

      await onMessage({ type: 'downloadAll' }, {});

      expect(mockBrowser.downloads.download).toHaveBeenCalledWith({
        url: 'https://example.com/a.glb',
        filename: 'a.glb',
      });
    });
  });

  describe('Listener registration', () => {
    it('registers onMessage listener', () => {
      expect(registeredOnMessage).toBe(true);
    });
  });
});


// ============================================================================
// Unit tests for onRequestCompleted
// Validates: Requirements 1.1, 1.3, 1.4, 1.5, 2.1, 2.2
// ============================================================================

describe('onRequestCompleted', () => {
  beforeEach(() => {
    tabModels.clear();
    vi.clearAllMocks();
  });

  /**
   * Helper to create a mock webRequest details object.
   */
  function makeDetails(overrides = {}) {
    return {
      url: 'https://example.com/scene.glb',
      tabId: 1,
      statusCode: 200,
      responseHeaders: [{ name: 'Content-Length', value: '4096' }],
      ...overrides,
    };
  }

  describe('2xx status codes accepted', () => {
    it('accepts status 200', () => {
      onRequestCompleted(makeDetails({ statusCode: 200 }));
      expect(tabModels.get(1).size).toBe(1);
    });

    it('accepts status 201', () => {
      onRequestCompleted(makeDetails({ statusCode: 201 }));
      expect(tabModels.get(1).size).toBe(1);
    });

    it('accepts status 299', () => {
      onRequestCompleted(makeDetails({ statusCode: 299 }));
      expect(tabModels.get(1).size).toBe(1);
    });
  });

  describe('non-2xx status codes ignored', () => {
    it('ignores status 199', () => {
      onRequestCompleted(makeDetails({ statusCode: 199 }));
      expect(tabModels.has(1)).toBe(false);
    });

    it('ignores status 300', () => {
      onRequestCompleted(makeDetails({ statusCode: 300 }));
      expect(tabModels.has(1)).toBe(false);
    });

    it('ignores status 404', () => {
      onRequestCompleted(makeDetails({ statusCode: 404 }));
      expect(tabModels.has(1)).toBe(false);
    });

    it('ignores status 500', () => {
      onRequestCompleted(makeDetails({ statusCode: 500 }));
      expect(tabModels.has(1)).toBe(false);
    });
  });

  describe('URL filtering', () => {
    it('ignores non-GLB URLs', () => {
      onRequestCompleted(makeDetails({ url: 'https://example.com/image.png' }));
      expect(tabModels.has(1)).toBe(false);
    });

    it('ignores non-GLB URLs with .glb in query params', () => {
      onRequestCompleted(makeDetails({ url: 'https://example.com/page?file=model.glb' }));
      expect(tabModels.has(1)).toBe(false);
    });

    it('accepts GLB URLs (lowercase)', () => {
      onRequestCompleted(makeDetails({ url: 'https://example.com/model.glb' }));
      expect(tabModels.get(1).size).toBe(1);
    });

    it('accepts GLB URLs (uppercase)', () => {
      onRequestCompleted(makeDetails({ url: 'https://example.com/model.GLB' }));
      expect(tabModels.get(1).size).toBe(1);
    });

    it('accepts GLB URLs with query params', () => {
      onRequestCompleted(makeDetails({ url: 'https://cdn.example.com/model.glb?token=abc123' }));
      expect(tabModels.get(1).size).toBe(1);
    });
  });

  describe('tabId filtering', () => {
    it('ignores tabId -1 (not associated with a tab)', () => {
      onRequestCompleted(makeDetails({ tabId: -1 }));
      expect(tabModels.has(-1)).toBe(false);
    });
  });

  describe('Content-Length extraction', () => {
    it('extracts Content-Length from response headers', () => {
      onRequestCompleted(makeDetails({
        responseHeaders: [{ name: 'Content-Length', value: '8192' }],
      }));
      const entry = tabModels.get(1).values().next().value;
      expect(entry.size).toBe(8192);
    });

    it('defaults to 0 when Content-Length header is missing', () => {
      onRequestCompleted(makeDetails({
        responseHeaders: [{ name: 'Content-Type', value: 'model/gltf-binary' }],
      }));
      const entry = tabModels.get(1).values().next().value;
      expect(entry.size).toBe(0);
    });

    it('defaults to 0 when responseHeaders is undefined', () => {
      onRequestCompleted(makeDetails({ responseHeaders: undefined }));
      const entry = tabModels.get(1).values().next().value;
      expect(entry.size).toBe(0);
    });
  });

  describe('deduplication by filename', () => {
    it('keeps one entry when the same filename appears with different URLs', () => {
      // Same filename, different signed URLs
      onRequestCompleted(makeDetails({ url: 'https://example.com/model.glb?token=aaa' }));
      onRequestCompleted(makeDetails({ url: 'https://example.com/model.glb?token=bbb' }));

      // Should have exactly one entry keyed by filename
      expect(tabModels.get(1).size).toBe(1);
      // URL should be updated to the latest
      const entry = tabModels.get(1).get('model.glb');
      expect(entry).toBeDefined();
      expect(entry.url).toBe('https://example.com/model.glb?token=bbb');
    });
  });

  describe('badge update', () => {
    it('updates badge text after adding a model', () => {
      onRequestCompleted(makeDetails());
      expect(mockBrowser.action.setBadgeText).toHaveBeenCalledWith({
        text: '1',
        tabId: 1,
      });
    });

    it('updates badge count as models are added', () => {
      onRequestCompleted(makeDetails({ url: 'https://example.com/a.glb' }));
      onRequestCompleted(makeDetails({ url: 'https://example.com/b.glb' }));
      expect(mockBrowser.action.setBadgeText).toHaveBeenLastCalledWith({
        text: '2',
        tabId: 1,
      });
    });

    it('does not update badge when a duplicate filename is added', () => {
      onRequestCompleted(makeDetails());
      vi.clearAllMocks();
      // Same filename (derived from same path), different query params
      onRequestCompleted(makeDetails({ url: 'https://example.com/scene.glb?token=new' }));
      expect(mockBrowser.action.setBadgeText).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Property 3: Per-Tab Storage With Deduplication
// For any sequence of ModelEntry additions to a given tab, the stored collection
// SHALL contain exactly one entry per unique filename. When a duplicate filename
// is seen, the URL is updated to the latest one.
// Validates: Requirements 1.3, 1.4
// ============================================================================

describe('Property 3: Per-Tab Storage With Deduplication', () => {
  beforeEach(() => {
    tabModels.clear();
    vi.clearAllMocks();
  });

  /**
   * Arbitrary for generating a sequence of GLB request details with some duplicate filenames.
   * Uses a small pool of model indices so filenames repeat.
   */
  const glbRequestSequenceArb = fc
    .array(
      fc.record({
        modelIndex: fc.integer({ min: 0, max: 9 }),
        tokenIndex: fc.integer({ min: 0, max: 999 }),
        contentLength: fc.integer({ min: 0, max: 100000 }),
      }),
      { minLength: 1, maxLength: 50 }
    )
    .map((entries) =>
      entries.map((e) => ({
        // Different tokens = different URLs, same filename
        url: `https://example.com/model_${e.modelIndex}.glb?token=${e.tokenIndex}`,
        filename: `model_${e.modelIndex}.glb`,
        contentLength: e.contentLength,
      }))
    );

  it('stores exactly one entry per unique filename', () => {
    fc.assert(
      fc.property(glbRequestSequenceArb, (requests) => {
        tabModels.clear();
        vi.clearAllMocks();

        const tabId = 42;
        for (const req of requests) {
          onRequestCompleted({
            url: req.url,
            tabId,
            statusCode: 200,
            responseHeaders: [{ name: 'Content-Length', value: String(req.contentLength) }],
          });
        }

        const uniqueFilenames = new Set(requests.map((r) => r.filename));
        const storedModels = tabModels.get(tabId);

        expect(storedModels).toBeDefined();
        expect(storedModels.size).toBe(uniqueFilenames.size);

        for (const filename of uniqueFilenames) {
          expect(storedModels.has(filename)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('updates URL to the latest for duplicate filenames', () => {
    fc.assert(
      fc.property(glbRequestSequenceArb, (requests) => {
        tabModels.clear();
        vi.clearAllMocks();

        const tabId = 42;

        // Track the last URL for each filename
        const lastUrl = new Map();
        for (const req of requests) {
          lastUrl.set(req.filename, req.url);
        }

        for (const req of requests) {
          onRequestCompleted({
            url: req.url,
            tabId,
            statusCode: 200,
            responseHeaders: [{ name: 'Content-Length', value: String(req.contentLength) }],
          });
        }

        const storedModels = tabModels.get(tabId);

        // The stored URL should be the last one seen for each filename
        for (const [filename, expectedUrl] of lastUrl) {
          const entry = storedModels.get(filename);
          expect(entry.url).toBe(expectedUrl);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 4: Non-Success Status Codes Are Ignored
// For any request details where the HTTP status code is outside the 200–299
// range, the request interceptor SHALL not create a ModelEntry, leaving the
// tab's collection unchanged.
// Validates: Requirements 1.5
// ============================================================================

describe('Property 4: Non-Success Status Codes Are Ignored', () => {
  beforeEach(() => {
    tabModels.clear();
    vi.clearAllMocks();
  });

  /**
   * Arbitrary for generating HTTP status codes outside the 200-299 range.
   */
  const nonSuccessStatusArb = fc.oneof(
    fc.integer({ min: 100, max: 199 }),
    fc.integer({ min: 300, max: 599 })
  );

  it('does not create a ModelEntry for non-2xx status codes', () => {
    fc.assert(
      fc.property(nonSuccessStatusArb, (statusCode) => {
        tabModels.clear();
        vi.clearAllMocks();

        const tabId = 1;

        onRequestCompleted({
          url: 'https://example.com/model.glb',
          tabId,
          statusCode,
          responseHeaders: [{ name: 'Content-Length', value: '1024' }],
        });

        // Tab should have no models stored
        expect(tabModels.has(tabId)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('leaves existing entries unchanged when a non-2xx request arrives', () => {
    fc.assert(
      fc.property(nonSuccessStatusArb, (statusCode) => {
        tabModels.clear();
        vi.clearAllMocks();

        const tabId = 1;

        // Pre-populate with one entry
        onRequestCompleted({
          url: 'https://example.com/existing.glb',
          tabId,
          statusCode: 200,
          responseHeaders: [{ name: 'Content-Length', value: '2048' }],
        });

        const countBefore = tabModels.get(tabId).size;

        // Now send a non-success request for a different URL
        onRequestCompleted({
          url: 'https://example.com/failed.glb',
          tabId,
          statusCode,
          responseHeaders: [{ name: 'Content-Length', value: '1024' }],
        });

        // Count should remain unchanged
        expect(tabModels.get(tabId).size).toBe(countBefore);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 5: Badge Count Invariant
// For any tab with a collection of ModelEntries, the badge text SHALL equal
// the string representation of the collection size, or be empty string when
// the collection size is zero.
// Validates: Requirements 2.1, 2.2
// ============================================================================

describe('Property 5: Badge Count Invariant', () => {
  beforeEach(() => {
    tabModels.clear();
    vi.clearAllMocks();
  });

  /**
   * Arbitrary for generating a count of unique model URLs to add (0 to 20).
   */
  const modelCountArb = fc.integer({ min: 0, max: 20 });

  it('badge text matches collection size or is empty for zero', () => {
    fc.assert(
      fc.property(modelCountArb, (count) => {
        tabModels.clear();
        vi.clearAllMocks();

        const tabId = 7;

        // Add `count` unique models
        for (let i = 0; i < count; i++) {
          onRequestCompleted({
            url: `https://example.com/model_${i}.glb`,
            tabId,
            statusCode: 200,
            responseHeaders: [{ name: 'Content-Length', value: '1024' }],
          });
        }

        // Now call updateBadge and check the result
        vi.clearAllMocks();
        updateBadge(tabId);

        const expectedText = count > 0 ? String(count) : '';
        expect(mockBrowser.action.setBadgeText).toHaveBeenCalledWith({
          text: expectedText,
          tabId,
        });
      }),
      { numRuns: 100 }
    );
  });
});
