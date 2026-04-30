// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the browser namespace before importing popup.js
const mockBrowser = {
  runtime: {
    sendMessage: vi.fn(),
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([{ id: 1 }])),
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
    it('shows empty state and hides download-all button when models is empty', () => {
      renderModels([]);

      const emptyState = document.getElementById('empty-state');
      const actionButtons = document.getElementById('action-buttons');
      const modelList = document.getElementById('model-list');

      expect(emptyState.hidden).toBe(false);
      expect(actionButtons.hidden).toBe(true);
      expect(modelList.children.length).toBe(0);
    });

    it('shows empty state when models is null', () => {
      renderModels(null);

      const emptyState = document.getElementById('empty-state');
      expect(emptyState.hidden).toBe(false);
    });

    it('shows empty state when models is undefined', () => {
      renderModels(undefined);

      const emptyState = document.getElementById('empty-state');
      expect(emptyState.hidden).toBe(false);
    });
  });

  describe('model list rendering', () => {
    it('creates correct DOM elements with filename, size, and timestamp', () => {
      const models = [
        makeModel({ filename: 'robot.glb', size: 2048, timestamp: 1700000100 }),
      ];

      renderModels(models);

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

    it('hides empty state and shows download-all button when models exist', () => {
      renderModels([makeModel()]);

      const emptyState = document.getElementById('empty-state');
      const actionButtons = document.getElementById('action-buttons');

      expect(emptyState.hidden).toBe(true);
      expect(actionButtons.hidden).toBe(false);
    });

    it('renders multiple models', () => {
      const models = [
        makeModel({ url: 'https://example.com/a.glb', filename: 'a.glb', timestamp: 1000 }),
        makeModel({ url: 'https://example.com/b.glb', filename: 'b.glb', timestamp: 2000 }),
        makeModel({ url: 'https://example.com/c.glb', filename: 'c.glb', timestamp: 3000 }),
      ];

      renderModels(models);

      const items = document.querySelectorAll('.model-item');
      expect(items.length).toBe(3);
    });

    it('clears previous content before rendering', () => {
      renderModels([makeModel({ url: 'https://example.com/first.glb', filename: 'first.glb' })]);
      renderModels([makeModel({ url: 'https://example.com/second.glb', filename: 'second.glb' })]);

      const items = document.querySelectorAll('.model-item');
      expect(items.length).toBe(1);
      expect(items[0].querySelector('.model-filename').textContent).toBe('second.glb');
    });
  });

  describe('sorting', () => {
    it('sorts models by timestamp descending (most recent first)', () => {
      const models = [
        makeModel({ url: 'https://example.com/old.glb', filename: 'old.glb', timestamp: 1000 }),
        makeModel({ url: 'https://example.com/new.glb', filename: 'new.glb', timestamp: 3000 }),
        makeModel({ url: 'https://example.com/mid.glb', filename: 'mid.glb', timestamp: 2000 }),
      ];

      renderModels(models);

      const filenames = [...document.querySelectorAll('.model-filename')].map(
        (el) => el.textContent
      );
      expect(filenames).toEqual(['new.glb', 'mid.glb', 'old.glb']);
    });
  });

  describe('unknown size display', () => {
    it('shows "Unknown size" for models with size 0', () => {
      const models = [makeModel({ size: 0 })];

      renderModels(models);

      const size = document.querySelector('.model-size');
      expect(size.textContent).toBe('Unknown size');
    });

    it('shows formatted size for models with non-zero size', () => {
      const models = [makeModel({ size: 1048576 })];

      renderModels(models);

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
  });

  it('sends correct download message to service worker', async () => {
    mockBrowser.runtime.sendMessage.mockResolvedValue({ success: true });

    const model = makeModel({ url: 'https://cdn.example.com/robot.glb', filename: 'robot.glb' });
    await downloadModel(model);

    expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'download',
      url: 'https://cdn.example.com/robot.glb',
      filename: 'robot.glb',
    });
  });

  it('shows inline error when download response indicates failure', async () => {
    mockBrowser.runtime.sendMessage.mockResolvedValue({
      success: false,
      error: 'URL expired',
    });

    const model = makeModel();
    // Render the model first so the DOM item exists
    renderModels([model]);

    await downloadModel(model);

    const errorEl = document.querySelector('.model-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toBe('URL expired');
  });

  it('shows default error message when response has no error string', async () => {
    mockBrowser.runtime.sendMessage.mockResolvedValue({ success: false });

    const model = makeModel();
    renderModels([model]);

    await downloadModel(model);

    const errorEl = document.querySelector('.model-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.textContent).toContain('Download failed');
  });

  it('shows inline error when sendMessage throws (communication error)', async () => {
    mockBrowser.runtime.sendMessage.mockRejectedValue(new Error('Service worker not ready'));

    const model = makeModel();
    renderModels([model]);

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
  });

  it('sends downloadAll message to service worker', async () => {
    mockBrowser.runtime.sendMessage.mockResolvedValue({ results: [] });

    await downloadAll([makeModel()]);

    expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'downloadAll' });
  });

  it('shows per-file errors for failed downloads', async () => {
    const modelA = makeModel({ url: 'https://example.com/a.glb', filename: 'a.glb', timestamp: 2000 });
    const modelB = makeModel({ url: 'https://example.com/b.glb', filename: 'b.glb', timestamp: 1000 });

    // Render models so DOM items exist
    renderModels([modelA, modelB]);

    mockBrowser.runtime.sendMessage.mockResolvedValue({
      results: [
        { url: 'https://example.com/a.glb', filename: 'a.glb', success: false, error: 'Link expired' },
        { url: 'https://example.com/b.glb', filename: 'b.glb', success: true },
      ],
    });

    await downloadAll([modelA, modelB]);

    const errors = document.querySelectorAll('.model-error');
    expect(errors.length).toBe(1);
    expect(errors[0].textContent).toBe('Link expired');
  });

  it('shows communication error when sendMessage throws', async () => {
    mockBrowser.runtime.sendMessage.mockRejectedValue(new Error('Extension disconnected'));

    await downloadAll([makeModel()]);

    const errorMessage = document.getElementById('error-message');
    expect(errorMessage.hidden).toBe(false);
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
  });

  it('shows error message section and hides other content on communication error', async () => {
    mockBrowser.runtime.sendMessage.mockRejectedValue(new Error('Extension disconnected'));

    // Simulate downloadAll triggering communication error
    await downloadAll([makeModel()]);

    const errorMessage = document.getElementById('error-message');
    const emptyState = document.getElementById('empty-state');
    const modelList = document.getElementById('model-list');
    const actionButtons = document.getElementById('action-buttons');

    expect(errorMessage.hidden).toBe(false);
    expect(emptyState.hidden).toBe(true);
    expect(modelList.innerHTML).toBe('');
    expect(actionButtons.hidden).toBe(true);
  });
});
