/**
 * Background service worker for the 3D Model Extractor extension.
 * Handles request interception, per-tab state management, badge updates,
 * tab lifecycle events, and popup message communication.
 *
 * Models are persisted via chrome.storage.session so they survive service
 * worker restarts and page refreshes within the same browser session.
 *
 * Models are deduplicated by filename (not full URL) so that the same GLB
 * file served from different signed CloudFront URLs is recognized as one model.
 * When a duplicate filename is seen, the URL is updated to the freshest one
 * so downloads always use a valid signed URL.
 */

import browser from './browser-api.js';
import { isGlbUrl, deriveFilename } from './url-utils.js';

/**
 * @typedef {Object} ModelEntry
 * @property {string} url - The full GLB file URL (including query params)
 * @property {string} filename - Derived and sanitized filename (dedup key)
 * @property {number} size - Response content length in bytes (0 if unknown)
 * @property {number} timestamp - Detection time as Unix epoch in seconds
 * @property {boolean} [downloaded] - Whether the user has downloaded this model
 */

/**
 * Per-tab state: Map<tabId, Map<filename, ModelEntry>>
 * Keyed by filename for deduplication across different signed URLs.
 * @type {Map<number, Map<string, ModelEntry>>}
 */
const tabModels = new Map();

// ---------------------------------------------------------------------------
// Persistence — chrome.storage.session survives SW restarts
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'tabModels';

async function persistState() {
  try {
    const serializable = {};
    for (const [tabId, models] of tabModels) {
      serializable[tabId] = Object.fromEntries(models);
    }
    await browser.storage.session.set({ [STORAGE_KEY]: serializable });
  } catch (_err) { /* fail silently */ }
}

async function restoreState() {
  try {
    const result = await browser.storage.session.get(STORAGE_KEY);
    const data = result?.[STORAGE_KEY];
    if (data && typeof data === 'object') {
      for (const [tabId, models] of Object.entries(data)) {
        const map = new Map(Object.entries(models));
        tabModels.set(Number(tabId), map);
      }
    }
  } catch (_err) { /* start fresh */ }
}

restoreState().then(() => {
  for (const tabId of tabModels.keys()) {
    updateBadge(tabId);
  }
}).catch(() => {});

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

try {
  browser.action.setBadgeBackgroundColor({ color: '#4CAF50' });
} catch (_err) { /* ignore */ }

function updateBadge(tabId) {
  const models = tabModels.get(tabId);
  const count = models ? models.size : 0;
  browser.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

function getContentLength(headers) {
  if (!Array.isArray(headers)) return 0;
  for (const h of headers) {
    if (h.name.toLowerCase() === 'content-length') {
      const n = parseInt(h.value, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Request interception
// ---------------------------------------------------------------------------

function hasGlbInPath(url) {
  if (isGlbUrl(url)) return true;
  try {
    return new URL(url).pathname.toLowerCase().includes('.glb');
  } catch {
    return url.split('?')[0].split('#')[0].toLowerCase().includes('.glb');
  }
}

function onRequestCompleted(details) {
  const { url, tabId, statusCode, responseHeaders } = details;

  if (tabId < 0) return;
  if (statusCode < 200 || statusCode > 299) return;
  if (!hasGlbInPath(url)) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const filename = deriveFilename(url, timestamp);
  const size = getContentLength(responseHeaders);

  if (!tabModels.has(tabId)) {
    tabModels.set(tabId, new Map());
  }

  const models = tabModels.get(tabId);

  if (models.has(filename)) {
    // Same model, possibly new signed URL — update the URL so downloads work
    const existing = models.get(filename);
    existing.url = url;
    if (size > 0) existing.size = size;
    persistState();
    return;
  }

  /** @type {ModelEntry} */
  const entry = { url, filename, size, timestamp, downloaded: false };
  models.set(filename, entry);
  updateBadge(tabId);
  persistState();
}

browser.webRequest.onCompleted.addListener(
  onRequestCompleted,
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// ---------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------

function onTabRemoved(tabId) {
  tabModels.delete(tabId);
  persistState();
}

function onTabUpdated(tabId, changeInfo) {
  if (changeInfo.status === 'loading') {
    updateBadge(tabId);
  }
}

function onTabActivated(activeInfo) {
  updateBadge(activeInfo.tabId);
}

browser.tabs.onRemoved.addListener(onTabRemoved);
browser.tabs.onUpdated.addListener(onTabUpdated);
browser.tabs.onActivated.addListener(onTabActivated);

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function onMessage(message, _sender) {
  if (message.type === 'getModels') {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return { models: [] };

    const tabId = tabs[0].id;
    const modelsMap = tabModels.get(tabId);
    if (!modelsMap || modelsMap.size === 0) return { models: [] };

    const models = Array.from(modelsMap.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
    return { models };
  }

  if (message.type === 'download') {
    try {
      // Direct download from the original URL (no decompression in service worker)
      await browser.downloads.download({
        url: message.url,
        filename: message.filename,
      });
      markModelDownloaded(message.filename);
      return { success: true, decompressed: false };
    } catch (error) {
      return { success: false, error: error.message || String(error) };
    }
  }

  if (message.type === 'downloadAll') {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return { results: [] };

    const tabId = tabs[0].id;
    const modelsMap = tabModels.get(tabId);
    if (!modelsMap || modelsMap.size === 0) return { results: [] };

    const results = [];
    for (const entry of modelsMap.values()) {
      try {
        await browser.downloads.download({
          url: entry.url,
          filename: entry.filename,
        });
        entry.downloaded = true;
        results.push({
          url: entry.url,
          filename: entry.filename,
          success: true,
          decompressed: false,
        });
      } catch (error) {
        results.push({
          url: entry.url,
          filename: entry.filename,
          success: false,
          error: error.message || String(error),
        });
      }
    }
    persistState();
    return { results };
  }

  if (message.type === 'markDownloaded') {
    markModelDownloaded(message.filename);
    return { success: true };
  }

  if (message.type === 'clearModels') {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      tabModels.delete(tabs[0].id);
      updateBadge(tabs[0].id);
      persistState();
    }
    return { success: true };
  }
}

/**
 * Mark a model as downloaded across all tabs (by filename).
 * @param {string} filename
 */
function markModelDownloaded(filename) {
  for (const models of tabModels.values()) {
    const entry = models.get(filename);
    if (entry) {
      entry.downloaded = true;
    }
  }
  persistState();
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  onMessage(message, sender).then(sendResponse).catch((err) => {
    console.error('[3D Model Extractor] onMessage error:', err);
    sendResponse({ error: err.message || String(err) });
  });
  return true;
});

export { tabModels, onRequestCompleted, updateBadge, onTabRemoved, onTabUpdated, onTabActivated, onMessage };
