/**
 * Content script for TripWire.
 * Injected into pages to extract a human-readable model name from the DOM.
 * Responds to 'getModelName' messages from the popup.
 *
 * This is best-effort — failures are silent and non-blocking.
 */

/**
 * Generic page-title patterns that indicate the title is not a real model name.
 * These are common hero headings or site slogans found on 3D model hosting sites.
 * @type {RegExp[]}
 */
const GENERIC_TITLE_PATTERNS = [
  /^generate\b/i,
  /^create\b/i,
  /^welcome\b/i,
  /^home$/i,
  /^gallery$/i,
  /^explore\b/i,
];

/**
 * Check whether a candidate title looks like a generic page heading
 * rather than a specific model name.
 * @param {string} text
 * @returns {boolean}
 */
function isGenericHeading(text) {
  return GENERIC_TITLE_PATTERNS.some((re) => re.test(text));
}

/**
 * Try to extract a meaningful model name from the current page.
 * Checks multiple sources in priority order.
 *
 * For SPA-based sites (e.g. Tripo3D) that show models in dialog overlays,
 * the first <h1> on the page may belong to the background page rather than
 * the model being viewed.  We therefore prefer <h1> elements inside visible
 * dialogs/modals, and fall back to document.title (which SPAs typically
 * update to reflect the current view) before using a generic page <h1>.
 *
 * @returns {string|null}
 */
function extractModelName() {
  // 1. Open Graph title (often the cleanest)
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
  if (ogTitle && ogTitle.length > 2 && ogTitle.length < 120 && !isGenericHeading(ogTitle)) {
    return ogTitle;
  }

  // 2. <h1> inside an open dialog / modal overlay (SPA model viewers)
  //    These selectors cover common dialog implementations:
  //    - native <dialog[open]>
  //    - [role="dialog"]
  //    - [data-state="open"] (Radix / Reka UI)
  const dialogSelectors = [
    'dialog[open]',
    '[role="dialog"]',
    '[data-state="open"][class*="fixed"]',
  ];
  for (const sel of dialogSelectors) {
    const dialogs = document.querySelectorAll(sel);
    for (const dialog of dialogs) {
      const h1 = dialog.querySelector('h1');
      if (h1) {
        const text = h1.textContent?.trim();
        if (text && text.length > 2 && text.length < 120 && !isGenericHeading(text)) {
          return text;
        }
      }
    }
  }

  // 3. Document title — SPAs update this to reflect the current view.
  //    Strip trailing " - SiteName" or " | SiteName" patterns, and also
  //    strip trailing UUIDs that some sites append (e.g. Tripo).
  const title = document.title;
  if (title && title.length > 2) {
    let cleaned = title.replace(/\s*[-|–—]\s*[^-|–—]+$/, '').trim();
    // Strip trailing UUID-like segments (e.g. " ac78b194-c53d-458c-8443-6c0cb08a4b03")
    cleaned = cleaned.replace(/\s+[0-9a-f]{8}(?:-[0-9a-f]{4,}){1,4}$/i, '').trim();
    if (cleaned.length > 2 && cleaned.length < 120 && !isGenericHeading(cleaned)) {
      return cleaned;
    }
  }

  // 4. First <h1> on the page (least reliable on SPAs)
  const h1 = document.querySelector('h1');
  if (h1) {
    const text = h1.textContent?.trim();
    if (text && text.length > 2 && text.length < 120 && !isGenericHeading(text)) {
      return text;
    }
  }

  return null;
}

/**
 * Convert a human-readable name to a safe filename.
 * @param {string} name
 * @returns {string}
 */
function nameToFilename(name) {
  return name
    .toLowerCase()
    .replace(/[<>:"/\\|?*]/g, '')             // remove invalid chars
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')             // remove control characters
    .replace(/\s+/g, '_')                    // spaces to underscores
    .replace(/[_]+/g, '_')                   // collapse multiple underscores
    .replace(/^_|_$/g, '')                   // trim leading/trailing underscores
    .substring(0, 80);                       // cap length
}

// Listen for messages from the popup
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'getModelName') {
      try {
        const name = extractModelName();
        const filename = name ? nameToFilename(name) : null;
        sendResponse({ name, filename });
      } catch (_err) {
        sendResponse({ name: null, filename: null });
      }
    }
    return false; // synchronous response
  });
} else if (typeof browser !== 'undefined' && browser.runtime) {
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'getModelName') {
      try {
        const name = extractModelName();
        const filename = name ? nameToFilename(name) : null;
        return Promise.resolve({ name, filename });
      } catch (_err) {
        return Promise.resolve({ name: null, filename: null });
      }
    }
  });
}
