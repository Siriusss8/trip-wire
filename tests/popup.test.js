// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fetchAndDecompress before importing popup.js
const mockFetchAndDecompress = vi.fn();
vi.mock('../glb-decompress.js', () => ({
  fetchAndDecompress: (...args) => mockFetchAndDecompress(...args),
}));

// Mock URL.createObjectURL/revokeObjectURL
globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake-url');
globalThis.URL.revokeObjectURL = vi.fn();

// Mock the browser namespace before importing popup.js
const mockBrowser = {
  runtime: {
    sendMessage: vi.fn(),
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([{ id: 1 }])),
  },
  downloads: {
    download: vi.fn(() => Promise.resolve(1)),
  },
};

// Set globalThis.browser so browser-api.js picks it up
globalThis.browser = mockBrowser;

// Import after mocking
const { renderModels, downloadModel, downloadAll } = await import('../popup.js');

/**
 * Set up the popup DOM structure required by popup.js.
 * Mirrors the elements in popup.html.
 */
function setupDOM() {
  document.body.innerHTML = `
    <section id="error-message" class="error-message" role="alert" hidden>
      Unable to communicate with extension. Please try reopening the popup.
    </section>
    <section id="empty-state" aria-live="polite" hidden>
      <p>No 3D models detected on this page.</p>
    </section>
    <section id="model-list" aria-label="Detected 3D models" role="list"></section>
    <div id="action-buttons" hidden>
      <button id="download-all-btn" type="button">Download All</button>
      <button id="clear-btn" type="button">Clear List</button>
    </div>
  `;
}

/**
 * Helper to create a mock ModelEntry.
 */
function makeModel(overrides = {}) {
  return {
    url: 'https://cdn.example.com/scene.glb?token=abc',
    filename: 'scene.glb',
    size: 4096,
    timestamp: 1700000000,
    ...overrides,
  };
}

// ============================================================================
// renderModels tests
// Validates: Requirements 3.1, 3.2, 3.3, 3.4
// ============================================================================

describe('renderModels', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('shows empty state and hides download-all button when models is empty', async () => {
      await renderModels([]);

      const emptyState = document.getElementById('empty-state');
      const actionButtons = document.getElementById('action-buttons');
      const modelList = document.getElementById('model-list');

      expect(emptyState.hidden).toBe(false);
      expect(actionButtons.hidden).toBe(true);
      expect(modelList.children.length).toBe(0);
    });

    it('shows empty state when models is null', async () => {
      await renderModels(null);

      const emptyState = document.getElementById('empty-state');
      expect(emptyState.hidden).toBe(false);
    });

    it('shows empty state when models is undefined', async () => {
      await renderModels(undefined);

      const emptyState = document.getElementById('empty-state');
      expect(emptyState.hidden).toBe(false);
    });
  });

  describe('model list rendering', () => {
    it('creates correct DOM elements with filename, size, and timestamp', async () => {
      const models = [
        makeModel({ filename: 'robot.glb', size: 2048, timestamp: 1700000100 }),
      ];

      await renderModels(models);

      const modelList = document.getElementById('model-list');
      const items = modelList.querySelectorAll('.model-item');
      expect(items.length).toBe(1);

      const item = items[0];
      const filename = item.querySelector('.model-filename');
      const size = item.querySelector('.model-size');
      const timestamp = item.querySelector('.model-timestamp');
      const downloadBtn = item.querySelector('.model-download-btn');

      expect(filename.textContent).toBe('robot.glb');
      expect(size.textContent).toBe('2 KB');
      expect(timestamp.textContent).toBeTruthy();
      expect(downloadBtn.textContent).toBe('Download');
    });

    it('hides empty state and shows download-all button when models exist', async () => {
      await renderModels([makeModel()]);

      const emptyState = document.getElementById('empty-state');
      const actionButtons = document.getElementById('action-buttons');

      expect(emptyState.hidden).toBe(true);
      expect(actionButtons.hidden).toBe(false);
    });

    it('renders multiple models', async () => {
      const models = [
        makeModel({ url: 'https://example.com/a.glb', filename: 'a.glb', timestamp: 1000 }),
        makeModel({ url: 'https://example.com/b.glb', filename: 'b.glb', timestamp: 2000 }),
        makeModel({ url: 'https://example.com/c.glb', filename: 'c.glb', timestamp: 3000 }),
      ];

      await renderModels(models);

      const items = document.querySelectorAll('.model-item');
      expect(items.length).toBe(3);
    });

    it('clears previous content before rendering', async () => {
      await renderModels([makeModel({ url: 'https://example.com/first.glb', filename: 'first.glb' })]);
      await renderModels([makeModel({ url: 'https://example.com/second.glb', filename: 'second.glb' })]);

      const items = document.querySelectorAll('.model-item');
      expect(items.length).toBe(1);
      expect(items[0].querySelector('.model-filename').textContent).toBe('second.glb');
    });
  });

  describe('sorting', () => {
    it('sorts models by timestamp descending (most recent first)', async () => {
      const models = [
        makeModel({ url: 'https://example.com/old.glb', filename: 'old.glb', timestamp: 1000 }),
        makeModel({ url: 'https://example.com/new.glb', filename: 'new.glb', timestamp: 3000 }),
        makeModel({ url: 'https://example.com/mid.glb', filename: 'mid.glb', timestamp: 2000 }),
      ];

      await renderModels(models);

      const filenames = [...document.querySelectorAll('.model-filename')].map(
        (el) => el.textContent
      );
      expect(filenames).toEqual(['new.glb', 'mid.glb', 'old.glb']);
    });
  });

  describe('unknown size display', () => {
    it('shows "Unknown size" for models with size 0', async () => {
      const models = [makeModel({ size: 0 })];

      await renderModels(models);

      const size = document.querySelector('.model-size');
      expect(size.textContent).toBe('Unknown size');
    });

    it('shows formatted size for models with non-zero size', async () => {
      const models = [makeModel({ size: 1048576 })];

      await renderModels(models);

      const size = document.querySelector('.model-size');
      expect(size.textContent).toBe('1 MB');
    });
  });
});

// ============================================================================
// downloadModel tests
// Validates: Requirements 4.1, 4.4
// ============================================================================

describe('downloadModel', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    mockFetchAndDecompress.mockResolvedValue({
      blob: new Blob(['fake-glb'], { type: 'model/gltf-binary' }),
      decompressed: true,
    });
    mockBrowser.downloads.download.mockResolvedValue(1);
    mockBrowser.runtime.sendMessage.mockResolvedValue({ success: true });
  });

  it('calls fetchAndDecompress then sends download message to mark as downloaded', async () => {
    const model = makeModel({ url: 'https://cdn.example.com/robot.glb', filename: 'robot.glb' });
    await downloadModel(model);

    expect(mockFetchAndDecompress).toHaveBeenCalledWith('https://cdn.example.com/robot.glb');
    expect(mockBrowser.downloads.download).toHaveBeenCalledWith({
      url: 'blob:fake-url',
      filename: 'robot.glb',
    });
    expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'markDownloaded',
      url: 'https://cdn.example.com/robot.glb',
      filename: 'robot.glb',
    });
  });

  it('shows inline error when fetchAndDecompress rejects', async () => {
    mockFetchAndDecompress.mockRejectedValueOnce(new Error('URL expired'));

    const model = makeModel();
    // Render the model first so the DOM item exists
    await renderModels([model]);

    await downloadModel(model);

    const errorEl = document.querySelector('.model-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Download failed');
  });

  it('shows inline error when downloads.download rejects', async () => {
    mockBrowser.downloads.download.mockRejectedValueOnce(new Error('Disk full'));

    const model = makeModel();
    await renderModels([model]);

    await downloadModel(model);

    const errorEl = document.querySelector('.model-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Download failed');
  });
});

// ============================================================================
// downloadAll tests
// Validates: Requirements 4.1, 4.4
// ============================================================================

describe('downloadAll', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    mockFetchAndDecompress.mockResolvedValue({
      blob: new Blob(['fake-glb'], { type: 'model/gltf-binary' }),
      decompressed: true,
    });
    mockBrowser.downloads.download.mockResolvedValue(1);
    mockBrowser.runtime.sendMessage.mockResolvedValue({ success: true });
  });

  it('calls fetchAndDecompress for each model', async () => {
    const modelA = makeModel({ url: 'https://example.com/a.glb', filename: 'a.glb', timestamp: 2000 });
    const modelB = makeModel({ url: 'https://example.com/b.glb', filename: 'b.glb', timestamp: 1000 });

    await renderModels([modelA, modelB]);

    await downloadAll([modelA, modelB]);

    expect(mockFetchAndDecompress).toHaveBeenCalledTimes(2);
    expect(mockFetchAndDecompress).toHaveBeenCalledWith('https://example.com/a.glb');
    expect(mockFetchAndDecompress).toHaveBeenCalledWith('https://example.com/b.glb');
  });

  it('shows per-file errors for failed downloads', async () => {
    const modelA = makeModel({ url: 'https://example.com/a.glb', filename: 'a.glb', timestamp: 2000 });
    const modelB = makeModel({ url: 'https://example.com/b.glb', filename: 'b.glb', timestamp: 1000 });

    // Render models so DOM items exist
    await renderModels([modelA, modelB]);

    // First fetch fails, second succeeds
    mockFetchAndDecompress
      .mockRejectedValueOnce(new Error('Link expired'))
      .mockResolvedValueOnce({
        blob: new Blob(['data'], { type: 'model/gltf-binary' }),
        decompressed: true,
      });

    await downloadAll([modelA, modelB]);

    const errors = document.querySelectorAll('.model-error');
    expect(errors.length).toBe(1);
    expect(errors[0].textContent).toContain('Download failed');
  });
});

// ============================================================================
// Communication error handling
// Validates: Requirements 3.1, 4.4
// ============================================================================

describe('communication error handling', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    mockFetchAndDecompress.mockRejectedValue(new Error('Network error'));
  });

  it('shows error on individual model download failure and hides after re-render', async () => {
    const model = makeModel();
    await renderModels([model]);

    await downloadModel(model);

    const errorEl = document.querySelector('.model-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Download failed');
  });
});
