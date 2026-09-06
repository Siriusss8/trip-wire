/**
 * Popup UI controller for the 3D Model Extractor extension.
 * Manages the popup DOM, fetches model data from the service worker,
 * and triggers downloads.
 */

import browser from './browser-api.js';
import { formatFileSize, formatTimestamp } from './format-utils.js';
import { fetchAndDecompress } from './glb-decompress.js';

/** Cached page model name (queried once per popup open) */
let _cachedPageName = undefined;

/**
 * Derive a readable filename from a browser tab title.
 * Strips common site-name suffixes and trailing UUIDs, then sanitises.
 * @param {string} title - The raw tab title
 * @returns {string|null} filename base (no extension) or null
 */
function filenameFromTabTitle(title) {
  if (!title || title.length <= 2) return null;

  let cleaned = title
    // Strip trailing " - SiteName" / " | SiteName"
    .replace(/\s*[-|–—]\s*[^-|–—]+$/, '')
    .trim();

  // Strip trailing UUID-like segments (e.g. " ac78b194-c53d-458c-8443-6c0cb08a4b03")
  cleaned = cleaned.replace(/\s+[0-9a-f]{8}(?:-[0-9a-f]{4,}){1,4}$/i, '').trim();

  if (cleaned.length <= 2 || cleaned.length >= 120) return null;

  // Skip generic headings
  if (/^(?:generate|create|welcome|home|gallery|explore)\b/i.test(cleaned)) return null;

  // Convert to safe filename (mirrors nameToFilename in content-script.js)
  const filename = cleaned
    .toLowerCase()
    .replace(/[<>:"/\\|?*]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 80);

  return filename || null;
}

/**
 * Query the content script for a human-readable model name.
 * Falls back to deriving a name from the tab title if the content script
 * is unreachable (common on SPAs where the script may not respond).
 * Best-effort, silent on failure. Caches the result.
 * @returns {Promise<string|null>} filename base (no extension) or null
 */
async function getReadableFilename() {
  if (_cachedPageName !== undefined) return _cachedPageName;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) { _cachedPageName = null; return null; }

    // Try the content script first — it can inspect the DOM (dialogs, og:title, etc.)
    try {
      const response = await browser.tabs.sendMessage(tabs[0].id, { type: 'getModelName' });
      if (response?.filename) {
        _cachedPageName = response.filename;
        return _cachedPageName;
      }
    } catch (_contentScriptErr) {
      // Content script not available — fall through to tab-title fallback
    }

    // Fallback: derive a name from the tab title (always available, no content script needed)
    _cachedPageName = filenameFromTabTitle(tabs[0].title);
    return _cachedPageName;
  } catch (_err) {
    _cachedPageName = null;
    return null;
  }
}

/**
 * Build the final download filename for a model.
 * Uses the readable page name only when there is exactly one model on the page
 * (to avoid multiple models colliding on the same filename). Falls back to the
 * URL-derived filename otherwise.
 * Strips _meshopt from the base if decompression succeeded.
 * @param {string} originalFilename - URL-derived filename
 * @param {boolean} decompressed - whether decompression succeeded
 * @param {number} totalModels - total number of models detected on the page
 * @returns {Promise<string>}
 */
async function buildDownloadFilename(originalFilename, decompressed, totalModels = 1) {
  // Only substitute the readable page name when there is a single model;
  // with multiple models each must keep its own distinct filename.
  const readableName = totalModels === 1 ? await getReadableFilename() : null;

  let base;
  if (readableName) {
    base = readableName;
  } else {
    base = originalFilename.replace(/\.glb$/i, '');
  }

  // Strip _meshopt from the base if decompressed
  if (decompressed) {
    base = base.replace(/_meshopt/gi, '');
  }

  // Clean up trailing/leading underscores after stripping
  base = base.replace(/^_+|_+$/g, '');

  return base + '.glb';
}

/**
 * @typedef {Object} ModelEntry
 * @property {string} url - The full GLB file URL (including query params)
 * @property {string} filename - Derived and sanitized filename
 * @property {number} size - Response content length in bytes (0 if unknown)
 * @property {number} timestamp - Detection time as Unix epoch in seconds
 * @property {boolean} [downloaded] - Whether the user has downloaded this model
 */

/**
 * Render model entries into the popup DOM.
 * Each model displays its own URL-derived filename. The readable page name is
 * only substituted when there is exactly one model (to avoid filename collisions).
 * @param {ModelEntry[]} models
 */
async function renderModels(models) {
  const modelList = document.getElementById('model-list');
  const emptyState = document.getElementById('empty-state');
  const actionButtons = document.getElementById('action-buttons');

  modelList.innerHTML = '';

  if (!models || models.length === 0) {
    emptyState.hidden = false;
    actionButtons.hidden = true;
    return;
  }

  emptyState.hidden = true;
  actionButtons.hidden = false;

  const sorted = [...models].sort((a, b) => b.timestamp - a.timestamp);
  const totalModels = sorted.length;

  // For a single model, pre-fetch the readable name so the list shows it immediately.
  // For multiple models each keeps its own filename to avoid collisions.
  const readableName = totalModels === 1 ? await getReadableFilename() : null;

  for (const model of sorted) {
    const item = document.createElement('div');
    item.classList.add('model-item');
    item.setAttribute('role', 'listitem');
    // Use the URL-derived filename as the stable key for DOM lookup
    item.dataset.filename = model.filename;

    const info = document.createElement('div');
    info.classList.add('model-info');

    // Single model: substitute readable name; multiple models: use each model's own name
    let displayName = model.filename;
    if (readableName) {
      const base = readableName.replace(/_meshopt/gi, '').replace(/^_+|_+$/g, '');
      displayName = base + '.glb';
    }

    const filenameEl = document.createElement('div');
    filenameEl.classList.add('model-filename');
    filenameEl.textContent = displayName;
    filenameEl.title = displayName;

    const details = document.createElement('div');
    details.classList.add('model-details');

    const size = document.createElement('span');
    size.classList.add('model-size');
    size.textContent = model.size === 0 ? 'Unknown size' : formatFileSize(model.size);

    const timestamp = document.createElement('span');
    timestamp.classList.add('model-timestamp');
    timestamp.textContent = formatTimestamp(model.timestamp);

    details.appendChild(size);
    details.appendChild(timestamp);
    info.appendChild(filenameEl);
    info.appendChild(details);

    const downloadBtn = document.createElement('button');
    downloadBtn.classList.add('model-download-btn');
    if (model.downloaded) {
      downloadBtn.classList.add('downloaded');
    }
    downloadBtn.type = 'button';
    downloadBtn.textContent = model.downloaded ? 'Downloaded' : 'Download';
    downloadBtn.addEventListener('click', () => downloadModel(model, downloadBtn, totalModels));

    item.appendChild(info);
    item.appendChild(downloadBtn);
    modelList.appendChild(item);
  }

  // Wire up action buttons — pass the full sorted list so downloadAll has the count
  document.getElementById('download-all-btn').onclick = () => downloadAll(sorted);
  document.getElementById('clear-btn').onclick = () => clearModels();
}

/**
 * Request download of a single model.
 * @param {ModelEntry} model
 * @param {HTMLButtonElement} [btn]
 * @param {number} [totalModels] - total models on page, used for filename logic
 */
async function downloadModel(model, btn, totalModels = 1) {
  if (btn) {
    btn.textContent = 'Processing...';
    btn.disabled = true;
  }
  try {
    const result = await fetchAndDecompress(model.url);
    const filename = await buildDownloadFilename(model.filename, result.decompressed, totalModels);

    const blobUrl = URL.createObjectURL(result.blob);
    await browser.downloads.download({ url: blobUrl, filename });
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

    await browser.runtime.sendMessage({
      type: 'markDownloaded',
      url: model.url,
      filename: model.filename,
    });

    if (btn) {
      btn.classList.add('downloaded');
      btn.textContent = 'Downloaded';
      btn.disabled = false;
    }
    if (result.warning) {
      showModelWarning(model.filename, result.warning);
    }
  } catch (_err) {
    showModelError(model.filename, 'Download failed — the link may have expired.');
    if (btn) {
      btn.textContent = 'Download';
      btn.disabled = false;
    }
  }
}

/**
 * Request download of all models.
 * @param {ModelEntry[]} models
 */
async function downloadAll(models) {
  const totalModels = models.length;
  for (const model of models) {
    const item = [...document.querySelectorAll('.model-item')]
      .find(el => el.dataset.filename === model.filename);
    const btn = item?.querySelector('.model-download-btn');
    if (btn) {
      btn.textContent = 'Processing...';
      btn.disabled = true;
    }
    try {
      const result = await fetchAndDecompress(model.url);
      const filename = await buildDownloadFilename(model.filename, result.decompressed, totalModels);
      const blobUrl = URL.createObjectURL(result.blob);
      await browser.downloads.download({ url: blobUrl, filename });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

      await browser.runtime.sendMessage({
        type: 'markDownloaded',
        url: model.url,
        filename: model.filename,
      });

      if (btn) {
        btn.classList.add('downloaded');
        btn.textContent = 'Downloaded';
        btn.disabled = false;
      }
      if (result.warning) {
        showModelWarning(model.filename, result.warning);
      }
    } catch (_err) {
      showModelError(model.filename, 'Download failed — the link may have expired.');
      if (btn) {
        btn.textContent = 'Download';
        btn.disabled = false;
      }
    }
  }
}

/**
 * Clear all detected models for the current tab.
 */
async function clearModels() {
  try {
    await browser.runtime.sendMessage({ type: 'clearModels' });
    renderModels([]);
  } catch (_err) {
    showCommunicationError();
  }
}

/**
 * Display an inline error message for a specific model item.
 * @param {string} filename
 * @param {string} message
 */
function showModelError(filename, message) {
  const items = document.querySelectorAll('.model-item');
  for (const item of items) {
    if (item.dataset.filename === filename) {
      const existingError = item.querySelector('.model-error');
      if (existingError) existingError.remove();

      const errorEl = document.createElement('div');
      errorEl.classList.add('model-error');
      errorEl.textContent = message;
      item.querySelector('.model-info').appendChild(errorEl);
      break;
    }
  }
}

/**
 * Display an inline warning message for a specific model item.
 * @param {string} filename
 * @param {string} message
 */
function showModelWarning(filename, message) {
  const items = document.querySelectorAll('.model-item');
  for (const item of items) {
    if (item.dataset.filename === filename) {
      const existingWarn = item.querySelector('.model-warning');
      if (existingWarn) existingWarn.remove();

      const warnEl = document.createElement('div');
      warnEl.classList.add('model-warning');
      warnEl.textContent = message;
      item.querySelector('.model-info').appendChild(warnEl);
      break;
    }
  }
}

/**
 * Display the communication error message.
 */
function showCommunicationError() {
  document.getElementById('error-message').hidden = false;
  document.getElementById('empty-state').hidden = true;
  document.getElementById('model-list').innerHTML = '';
  document.getElementById('action-buttons').hidden = true;
}

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getModels' });
    renderModels(response ? response.models : []);
  } catch (_err) {
    showCommunicationError();
  }
});

export { renderModels, downloadModel, downloadAll };
