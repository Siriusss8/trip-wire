/**
 * Popup UI controller for the 3D Model Extractor extension.
 * Manages the popup DOM, fetches model data from the service worker,
 * and triggers downloads.
 */

import browser from './browser-api.js';
import { formatFileSize, formatTimestamp } from './format-utils.js';

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
 * @param {ModelEntry[]} models
 */
function renderModels(models) {
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

  for (const model of sorted) {
    const item = document.createElement('div');
    item.classList.add('model-item');
    item.setAttribute('role', 'listitem');
    item.dataset.filename = model.filename;

    const info = document.createElement('div');
    info.classList.add('model-info');

    const filename = document.createElement('div');
    filename.classList.add('model-filename');
    filename.textContent = model.filename;
    filename.title = model.filename;

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
    info.appendChild(filename);
    info.appendChild(details);

    const downloadBtn = document.createElement('button');
    downloadBtn.classList.add('model-download-btn');
    // Apply downloaded state from persisted data
    if (model.downloaded) {
      downloadBtn.classList.add('downloaded');
    }
    downloadBtn.type = 'button';
    downloadBtn.textContent = model.downloaded ? 'Downloaded' : 'Download';
    downloadBtn.addEventListener('click', () => downloadModel(model, downloadBtn));

    item.appendChild(info);
    item.appendChild(downloadBtn);
    modelList.appendChild(item);
  }

  // Wire up action buttons
  document.getElementById('download-all-btn').onclick = () => downloadAll(sorted);
  document.getElementById('clear-btn').onclick = () => clearModels();
}

/**
 * Request download of a single model.
 * @param {ModelEntry} model
 * @param {HTMLButtonElement} [btn]
 */
async function downloadModel(model, btn) {
  if (btn) {
    btn.textContent = 'Processing...';
    btn.disabled = true;
  }
  try {
    const response = await browser.runtime.sendMessage({
      type: 'download',
      url: model.url,
      filename: model.filename,
    });

    if (response && !response.success) {
      showModelError(model.filename, response.error || 'Download failed — the link may have expired.');
      if (btn) {
        btn.textContent = 'Download';
        btn.disabled = false;
      }
    } else if (btn) {
      btn.classList.add('downloaded');
      btn.textContent = 'Downloaded';
      btn.disabled = false;
      // Show warning if decompression failed but file was saved
      if (response && response.warning) {
        showModelWarning(model.filename, response.warning);
      }
    }
  } catch (_err) {
    showModelError(model.filename, 'Download failed — the link may have expired.');
  }
}

/**
 * Request download of all models.
 * @param {ModelEntry[]} _models
 */
async function downloadAll(_models) {
  try {
    const response = await browser.runtime.sendMessage({ type: 'downloadAll' });

    if (response && response.results) {
      for (const result of response.results) {
        if (!result.success) {
          showModelError(result.filename, result.error || 'Download failed — the link may have expired.');
        } else {
          // Mark the button as downloaded
          const items = document.querySelectorAll('.model-item');
          for (const item of items) {
            if (item.dataset.filename === result.filename) {
              const btn = item.querySelector('.model-download-btn');
              if (btn) {
                btn.classList.add('downloaded');
                btn.textContent = 'Downloaded';
              }
              break;
            }
          }
        }
      }
    }
  } catch (_err) {
    showCommunicationError();
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
