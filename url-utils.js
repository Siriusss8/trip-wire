/**
 * URL matching and filename derivation utilities for the 3D Model Extractor extension.
 * Pure functions with no browser API dependencies.
 */

/**
 * Characters invalid in filenames on Windows, macOS, and Linux.
 * Includes: < > : " / \ | ? * and control characters (ASCII 0-31).
 * @type {RegExp}
 */
// eslint-disable-next-line no-control-regex
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/**
 * Regex matching known Tripo model URL filename patterns.
 * Matches: tripo_pbr_model_{uuid}_meshopt.glb,
 *          tripo_model_{uuid}_meshopt.glb,
 *          tripo_rigging_{uuid}_meshopt.glb
 * @type {RegExp}
 */
const TRIPO_MODEL_PATTERN = /tripo_(?:pbr_model|model|rigging)_[0-9a-fA-F-]+_meshopt\.glb/i;

/**
 * Check if a URL points to a GLB file.
 * Returns true if the URL's path component ends with `.glb` (case-insensitive),
 * ignoring query parameters and fragments.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isGlbUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }

  try {
    // Try parsing as a full URL first
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    // Check if path ends with .glb OR contains a .glb segment
    // (CloudFront signed URLs may have .glb in the path but not at the very end)
    return pathname.endsWith('.glb') || /\/[^/]+\.glb(\/|$)/i.test(parsed.pathname);
  } catch {
    // If URL parsing fails, try to extract the path manually.
    // Strip fragment first, then query params, then check the path.
    let path = url.split('#')[0];
    path = path.split('?')[0];
    return path.toLowerCase().endsWith('.glb') || /\/[^/]+\.glb(\/|$)/i.test(path);
  }
}

/**
 * Check if a URL matches known Tripo model patterns.
 * Patterns: tripo_pbr_model_{uuid}_meshopt.glb,
 *           tripo_model_{uuid}_meshopt.glb,
 *           tripo_rigging_{uuid}_meshopt.glb
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isTripoModelUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }

  return TRIPO_MODEL_PATTERN.test(url);
}

/**
 * Sanitize a filename by removing characters invalid on Windows, macOS, and Linux.
 * Removes: < > : " / \ | ? * and control characters (ASCII 0-31).
 *
 * @param {string} filename
 * @returns {string}
 */
export function sanitizeFilename(filename) {
  if (typeof filename !== 'string') {
    return '';
  }

  return filename.replace(INVALID_FILENAME_CHARS, '');
}

/**
 * Derive a safe filename from a GLB URL.
 * Extracts the last path segment ending in `.glb` before query params,
 * falls back to `model_{timestamp}.glb`, and sanitizes the result.
 *
 * @param {string} url
 * @param {number} [timestamp] - Unix epoch seconds for fallback name
 * @returns {string}
 */
export function deriveFilename(url, timestamp) {
  const fallback = `model_${timestamp ?? 0}.glb`;

  if (typeof url !== 'string' || url.length === 0) {
    return sanitizeFilename(fallback);
  }

  try {
    let pathname;

    try {
      const parsed = new URL(url);
      pathname = parsed.pathname;
    } catch {
      // If URL parsing fails, strip query/fragment manually
      pathname = url.split('?')[0].split('#')[0];
    }

    // Extract the last path segment
    const segments = pathname.split('/');
    const lastSegment = segments[segments.length - 1];

    // Check if the last segment ends in .glb (case-insensitive)
    if (lastSegment && lastSegment.toLowerCase().endsWith('.glb')) {
      const sanitized = sanitizeFilename(decodeURIComponent(lastSegment));
      if (sanitized.length > 0 && sanitized.toLowerCase().endsWith('.glb')) {
        return sanitized;
      }
    }

    // Search all segments for one containing .glb (for CloudFront-style URLs)
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (seg && seg.toLowerCase().includes('.glb')) {
        // Extract the .glb filename from the segment
        const match = seg.match(/([^/]*\.glb)/i);
        if (match) {
          const sanitized = sanitizeFilename(decodeURIComponent(match[1]));
          if (sanitized.length > 0 && sanitized.toLowerCase().endsWith('.glb')) {
            return sanitized;
          }
        }
      }
    }

    // Fallback: no valid .glb segment found
    return sanitizeFilename(fallback);
  } catch {
    return sanitizeFilename(fallback);
  }
}
