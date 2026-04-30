/**
 * Cross-browser API wrapper.
 *
 * In Firefox: the native `browser` namespace is available globally.
 * In Chrome: the webextension-polyfill script is loaded before this module:
 *   - Service worker: via importScripts() in background.js
 *   - Popup: via <script> tag in popup.html
 *   Both set `globalThis.browser`.
 * In Node/Vitest: the test files mock 'webextension-polyfill' and this module
 *   picks it up via the dynamic import fallback.
 *
 * Requirement 6.2: Use the `browser` namespace with a polyfill fallback
 * to the `chrome` namespace for cross-browser compatibility.
 */

/** @type {typeof globalThis.browser} */
let browserApi;

if (typeof globalThis.browser !== 'undefined' && globalThis.browser?.runtime) {
  // Firefox native or polyfill already loaded
  browserApi = globalThis.browser;
} else if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome?.runtime) {
  // Chrome — use chrome namespace directly (MV3 supports promises)
  browserApi = globalThis.chrome;
}

export default browserApi;
