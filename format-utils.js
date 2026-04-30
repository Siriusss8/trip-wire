/**
 * Display formatting utilities for the 3D Model Extractor extension.
 * Pure functions with no browser API dependencies.
 */

/**
 * Number of bytes in one kilobyte.
 * @type {number}
 */
const BYTES_PER_KB = 1024;

/**
 * Number of bytes in one megabyte.
 * @type {number}
 */
const BYTES_PER_MB = 1048576;

/**
 * Format bytes into a human-readable string (KB or MB).
 *
 * - For values < 1 MB (1048576 bytes): displays in KB (bytes / 1024)
 * - For values >= 1 MB: displays in MB (bytes / 1048576)
 * - Returns "0 KB" for zero, negative, or non-numeric input
 *
 * @param {number} bytes
 * @returns {string} e.g. "1.5 MB" or "340 KB"
 */
export function formatFileSize(bytes) {
  if (typeof bytes !== 'number' || !isFinite(bytes) || bytes < 0) {
    return '0 KB';
  }

  if (bytes < BYTES_PER_MB) {
    const kb = bytes / BYTES_PER_KB;
    // Use up to 1 decimal place for sub-KB values, round for >= 1 KB
    // Special-case 0 to avoid "0.0"
    if (kb === 0) {
      return '0 KB';
    }
    const formatted = kb < 1 ? kb.toFixed(1) : Math.round(kb).toString();
    return `${formatted} KB`;
  }

  const mb = bytes / BYTES_PER_MB;
  // Use up to 1 decimal place for MB
  const formatted = mb.toFixed(1).replace(/\.0$/, '');
  return `${formatted} MB`;
}

/**
 * Format a Unix timestamp (seconds) into a short display string.
 *
 * Returns a string in "HH:MM:SS" format using UTC time.
 * Returns "00:00:00" for non-numeric or negative input.
 *
 * @param {number} timestamp - Unix epoch in seconds
 * @returns {string} e.g. "14:32:05"
 */
export function formatTimestamp(timestamp) {
  if (typeof timestamp !== 'number' || !isFinite(timestamp) || timestamp < 0) {
    return '00:00:00';
  }

  const date = new Date(timestamp * 1000);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}
