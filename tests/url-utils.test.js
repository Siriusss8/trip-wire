import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isGlbUrl, isTripoModelUrl, sanitizeFilename, deriveFilename } from '../url-utils.js';

describe('isGlbUrl', () => {
  it('returns true for a simple .glb URL', () => {
    expect(isGlbUrl('https://example.com/model.glb')).toBe(true);
  });

  it('returns true for .GLB (case-insensitive)', () => {
    expect(isGlbUrl('https://example.com/model.GLB')).toBe(true);
  });

  it('returns true for .glb with query params', () => {
    expect(isGlbUrl('https://example.com/model.glb?token=abc')).toBe(true);
  });

  it('returns true for .glb with fragment', () => {
    expect(isGlbUrl('https://example.com/model.glb#section')).toBe(true);
  });

  it('returns true for .glb with both query and fragment', () => {
    expect(isGlbUrl('https://example.com/model.glb?token=abc#section')).toBe(true);
  });

  it('returns false for non-.glb URL', () => {
    expect(isGlbUrl('https://example.com/model.obj')).toBe(false);
  });

  it('returns false for URL containing .glb in query but not path', () => {
    expect(isGlbUrl('https://example.com/page?file=model.glb')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isGlbUrl('')).toBe(false);
  });

  it('returns false for non-string input', () => {
    expect(isGlbUrl(null)).toBe(false);
    expect(isGlbUrl(undefined)).toBe(false);
    expect(isGlbUrl(123)).toBe(false);
  });

  it('handles relative path ending in .glb', () => {
    expect(isGlbUrl('/models/scene.glb')).toBe(true);
  });
});

describe('isTripoModelUrl', () => {
  it('matches tripo_pbr_model pattern', () => {
    expect(isTripoModelUrl('https://cdn.example.com/tripo_pbr_model_abc123-def456_meshopt.glb')).toBe(true);
  });

  it('matches tripo_model pattern', () => {
    expect(isTripoModelUrl('https://cdn.example.com/tripo_model_abc123_meshopt.glb')).toBe(true);
  });

  it('matches tripo_rigging pattern', () => {
    expect(isTripoModelUrl('https://cdn.example.com/tripo_rigging_abc123_meshopt.glb')).toBe(true);
  });

  it('returns false for non-Tripo URL', () => {
    expect(isTripoModelUrl('https://example.com/model.glb')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isTripoModelUrl('')).toBe(false);
  });

  it('returns false for non-string input', () => {
    expect(isTripoModelUrl(null)).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  it('returns the filename unchanged if no invalid chars', () => {
    expect(sanitizeFilename('model.glb')).toBe('model.glb');
  });

  it('removes < > : " / \\ | ? *', () => {
    expect(sanitizeFilename('mo<d>e:l"/\\|?*.glb')).toBe('model.glb');
  });

  it('removes control characters', () => {
    expect(sanitizeFilename('model\x00\x1f.glb')).toBe('model.glb');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeFilename(null)).toBe('');
    expect(sanitizeFilename(undefined)).toBe('');
  });

  it('is idempotent', () => {
    const input = 'mo<del>.glb';
    const once = sanitizeFilename(input);
    const twice = sanitizeFilename(once);
    expect(once).toBe(twice);
  });
});

describe('deriveFilename', () => {
  it('extracts the last .glb path segment', () => {
    expect(deriveFilename('https://example.com/path/to/model.glb')).toBe('model.glb');
  });

  it('ignores query params when extracting filename', () => {
    expect(deriveFilename('https://cdn.example.com/model.glb?token=abc&expires=123')).toBe('model.glb');
  });

  it('falls back to model_{timestamp}.glb when no .glb segment', () => {
    expect(deriveFilename('https://example.com/page', 1700000000)).toBe('model_1700000000.glb');
  });

  it('falls back to model_0.glb when no timestamp provided', () => {
    expect(deriveFilename('https://example.com/page')).toBe('model_0.glb');
  });

  it('sanitizes the derived filename', () => {
    expect(deriveFilename('https://example.com/mo:del.glb')).toBe('model.glb');
  });

  it('handles empty URL with timestamp', () => {
    expect(deriveFilename('', 1700000000)).toBe('model_1700000000.glb');
  });

  it('handles non-string URL', () => {
    expect(deriveFilename(null, 42)).toBe('model_42.glb');
  });

  it('handles URL-encoded filenames', () => {
    expect(deriveFilename('https://example.com/my%20model.glb')).toBe('my model.glb');
  });
});


/**
 * Property-Based Tests for url-utils.js
 *
 * Feature: 3d-model-extractor-extension, Property 2: Tripo URL Detection Implies GLB Detection
 * Validates: Requirements 1.2, 1.1
 */
describe('Property Tests: Tripo URL Detection Implies GLB Detection', () => {
  /**
   * Arbitrary for a hex string segment of a given length range.
   */
  const arbHex = (min, max) => fc.string({
    unit: fc.constantFrom(...'0123456789abcdef'.split('')),
    minLength: min,
    maxLength: max
  });

  /**
   * Arbitrary for a UUID-like hex string with dashes (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890").
   * Generates realistic UUIDs with varying formats.
   */
  const arbUuid = fc.oneof(
    // Standard UUID format: 8-4-4-4-12
    fc.tuple(
      arbHex(8, 8),
      arbHex(4, 4),
      arbHex(4, 4),
      arbHex(4, 4),
      arbHex(12, 12)
    ).map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`),
    // Short hex string without dashes
    arbHex(8, 32),
    // Hex string with a single dash
    fc.tuple(
      arbHex(4, 16),
      arbHex(4, 16)
    ).map(([a, b]) => `${a}-${b}`)
  );

  /**
   * Arbitrary for Tripo model filename prefixes.
   */
  const arbTripoPrefix = fc.constantFrom('tripo_pbr_model', 'tripo_model', 'tripo_rigging');

  /**
   * Arbitrary for URL scheme.
   */
  const arbScheme = fc.constantFrom('http', 'https');

  /**
   * Arbitrary for a domain name.
   */
  const arbDomain = fc.string({
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    minLength: 1,
    maxLength: 12
  }).map(s => s + '.com');

  /**
   * Arbitrary for optional path prefix segments (0-3 segments before the filename).
   */
  const arbPathPrefix = fc.array(
    fc.string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
      minLength: 1,
      maxLength: 10
    }),
    { minLength: 0, maxLength: 3 }
  ).map(segments => segments.length > 0 ? '/' + segments.join('/') : '');

  /**
   * Arbitrary for optional query string.
   */
  const arbQuery = fc.oneof(
    fc.constant(''),
    fc.tuple(
      fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), minLength: 1, maxLength: 8 }),
      fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), minLength: 1, maxLength: 12 })
    ).map(([k, v]) => `?${k}=${v}`),
    fc.tuple(
      fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), minLength: 1, maxLength: 6 }),
      fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), minLength: 1, maxLength: 8 }),
      fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), minLength: 1, maxLength: 6 }),
      fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), minLength: 1, maxLength: 8 })
    ).map(([k1, v1, k2, v2]) => `?${k1}=${v1}&${k2}=${v2}`)
  );

  /**
   * Arbitrary for optional fragment.
   */
  const arbFragment = fc.oneof(
    fc.constant(''),
    fc.string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
      minLength: 1,
      maxLength: 8
    }).map(s => `#${s}`)
  );

  /**
   * Arbitrary for a full Tripo model URL.
   * Generates URLs like: https://cdn.example.com/path/tripo_pbr_model_abc123-def456_meshopt.glb?token=xyz
   */
  const arbTripoUrl = fc.tuple(
    arbScheme,
    arbDomain,
    arbPathPrefix,
    arbTripoPrefix,
    arbUuid,
    arbQuery,
    arbFragment
  ).map(([scheme, domain, pathPrefix, prefix, uuid, query, fragment]) =>
    `${scheme}://${domain}${pathPrefix}/${prefix}_${uuid}_meshopt.glb${query}${fragment}`
  );

  it('for any Tripo model URL, isTripoModelUrl implies isGlbUrl', () => {
    fc.assert(
      fc.property(arbTripoUrl, (url) => {
        // First verify this is indeed detected as a Tripo URL
        const isTripo = isTripoModelUrl(url);
        expect(isTripo).toBe(true);

        // Property: if isTripoModelUrl returns true, then isGlbUrl must also return true
        if (isTripo) {
          expect(isGlbUrl(url)).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('Tripo URLs are always detected as GLB URLs regardless of scheme, domain, or query params', () => {
    fc.assert(
      fc.property(
        arbScheme,
        arbDomain,
        arbPathPrefix,
        arbTripoPrefix,
        arbUuid,
        arbQuery,
        arbFragment,
        (scheme, domain, pathPrefix, prefix, uuid, query, fragment) => {
          const url = `${scheme}://${domain}${pathPrefix}/${prefix}_${uuid}_meshopt.glb${query}${fragment}`;

          // The Tripo pattern should be detected
          expect(isTripoModelUrl(url)).toBe(true);
          // And it should also be detected as a GLB URL
          expect(isGlbUrl(url)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-Based Tests for url-utils.js
 *
 * Feature: 3d-model-extractor-extension, Property 1: GLB URL Detection
 * Validates: Requirements 1.1
 */
describe('Property Tests: GLB URL Detection', () => {
  // Helpers for generating URL components
  const schemes = ['http', 'https'];
  const glbExtensions = ['.glb', '.GLB', '.Glb', '.gLb', '.glB', '.GLb', '.gLB', '.GlB'];

  /**
   * Arbitrary for a valid domain name segment.
   */
  const arbDomain = fc.string({
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    minLength: 1,
    maxLength: 12
  }).map(s => s + '.com');

  /**
   * Arbitrary for a path segment (no slashes, no query/fragment chars).
   */
  const arbPathSegment = fc.string({
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
    minLength: 1,
    maxLength: 15
  });

  /**
   * Arbitrary for a non-empty path with 1-4 segments.
   */
  const arbPath = fc.array(arbPathSegment, { minLength: 1, maxLength: 4 })
    .map(segments => '/' + segments.join('/'));

  /**
   * Arbitrary for optional query string.
   */
  const arbQuery = fc.oneof(
    fc.constant(''),
    fc.tuple(arbPathSegment, arbPathSegment).map(([k, v]) => `?${k}=${v}`),
    fc.tuple(arbPathSegment, arbPathSegment, arbPathSegment, arbPathSegment)
      .map(([k1, v1, k2, v2]) => `?${k1}=${v1}&${k2}=${v2}`)
  );

  /**
   * Arbitrary for optional fragment.
   */
  const arbFragment = fc.oneof(
    fc.constant(''),
    arbPathSegment.map(s => `#${s}`)
  );

  /**
   * Arbitrary for a URL whose path ends in .glb (various cases).
   * Should always cause isGlbUrl to return true.
   */
  const arbGlbUrl = fc.tuple(
    fc.constantFrom(...schemes),
    arbDomain,
    arbPath,
    fc.constantFrom(...glbExtensions),
    arbQuery,
    arbFragment
  ).map(([scheme, domain, path, ext, query, fragment]) =>
    `${scheme}://${domain}${path}${ext}${query}${fragment}`
  );

  /**
   * Non-.glb extensions that should NOT trigger isGlbUrl.
   */
  const nonGlbExtensions = ['.obj', '.fbx', '.stl', '.gltf', '.png', '.jpg', '.html', '.js', '.json', '.txt', ''];

  /**
   * Arbitrary for a URL whose path does NOT end in .glb.
   * Should always cause isGlbUrl to return false.
   */
  const arbNonGlbUrl = fc.tuple(
    fc.constantFrom(...schemes),
    arbDomain,
    arbPath,
    fc.constantFrom(...nonGlbExtensions),
    arbQuery,
    arbFragment
  ).map(([scheme, domain, path, ext, query, fragment]) =>
    `${scheme}://${domain}${path}${ext}${query}${fragment}`
  );

  it('returns true for any URL with a path ending in .glb (case-insensitive)', () => {
    fc.assert(
      fc.property(arbGlbUrl, (url) => {
        expect(isGlbUrl(url)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('returns false for any URL with a path NOT ending in .glb', () => {
    fc.assert(
      fc.property(arbNonGlbUrl, (url) => {
        expect(isGlbUrl(url)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('query params and fragments do not affect the result for .glb URLs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...schemes),
        arbDomain,
        arbPath,
        fc.constantFrom(...glbExtensions),
        arbQuery,
        arbFragment,
        (scheme, domain, path, ext, query, fragment) => {
          const baseUrl = `${scheme}://${domain}${path}${ext}`;
          const urlWithQuery = `${baseUrl}${query}`;
          const urlWithFragment = `${baseUrl}${fragment}`;
          const urlWithBoth = `${baseUrl}${query}${fragment}`;

          // All variants should return the same result as the base URL
          const expected = isGlbUrl(baseUrl);
          expect(isGlbUrl(urlWithQuery)).toBe(expected);
          expect(isGlbUrl(urlWithFragment)).toBe(expected);
          expect(isGlbUrl(urlWithBoth)).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('query params and fragments do not affect the result for non-.glb URLs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...schemes),
        arbDomain,
        arbPath,
        fc.constantFrom(...nonGlbExtensions),
        arbQuery,
        arbFragment,
        (scheme, domain, path, ext, query, fragment) => {
          const baseUrl = `${scheme}://${domain}${path}${ext}`;
          const urlWithQuery = `${baseUrl}${query}`;
          const urlWithFragment = `${baseUrl}${fragment}`;
          const urlWithBoth = `${baseUrl}${query}${fragment}`;

          const expected = isGlbUrl(baseUrl);
          expect(isGlbUrl(urlWithQuery)).toBe(expected);
          expect(isGlbUrl(urlWithFragment)).toBe(expected);
          expect(isGlbUrl(urlWithBoth)).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });
});

/**
 * Property-Based Tests for url-utils.js
 *
 * Feature: 3d-model-extractor-extension, Property 8: Filename Derivation Always Produces Valid Filename
 * Validates: Requirements 7.1, 7.2, 7.3
 */
describe('Property Tests: Filename Derivation Always Produces Valid Filename', () => {
  /**
   * Regex for characters invalid in filenames on Windows, macOS, and Linux.
   * Includes: < > : " / \ | ? * and control characters (ASCII 0-31).
   */
  // eslint-disable-next-line no-control-regex
  const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/;

  /**
   * Arbitrary for non-negative integer timestamps.
   */
  const arbTimestamp = fc.nat();

  /**
   * Arbitrary for fully arbitrary URL strings, including edge cases like
   * empty strings, malformed URLs, URLs with special characters, etc.
   */
  const arbUrlString = fc.oneof(
    // Completely arbitrary strings (may be empty, malformed, contain special chars)
    fc.string(),
    // Empty string
    fc.constant(''),
    // Well-formed URLs with .glb paths
    fc.tuple(
      fc.constantFrom('http', 'https'),
      fc.webUrl()
    ).map(([_scheme, url]) => url + '/model.glb'),
    // URLs with special/invalid filesystem characters in the path
    fc.tuple(
      fc.constantFrom('https://example.com/', 'http://cdn.test.org/path/'),
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.constantFrom('.glb', '.GLB', '.obj', '.txt', '')
    ).map(([base, name, ext]) => `${base}${name}${ext}`),
    // URLs with query params and fragments
    fc.tuple(
      fc.constantFrom('https://example.com/model.glb', 'https://cdn.test.org/scene.glb'),
      fc.string({ minLength: 0, maxLength: 30 })
    ).map(([base, suffix]) => `${base}?${suffix}`),
    // Strings with lots of invalid filesystem characters
    fc.string({
      unit: fc.constantFrom(...'<>:"/\\|?*\x00\x01\x1fabcdef.glb'.split('')),
      minLength: 0,
      maxLength: 40
    }),
    // Relative paths
    fc.tuple(
      fc.array(
        fc.string({
          unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
          minLength: 1,
          maxLength: 10
        }),
        { minLength: 1, maxLength: 4 }
      ),
      fc.constantFrom('.glb', '.GLB', '')
    ).map(([segments, ext]) => '/' + segments.join('/') + ext)
  );

  it('always returns a non-empty string ending in .glb with no invalid filesystem characters', () => {
    fc.assert(
      fc.property(arbUrlString, arbTimestamp, (url, timestamp) => {
        const result = deriveFilename(url, timestamp);

        // Must be a non-empty string
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);

        // Must end in .glb
        expect(result.toLowerCase().endsWith('.glb')).toBe(true);

        // Must contain no invalid filesystem characters
        expect(INVALID_CHARS.test(result)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });
});


/**
 * Property-Based Tests for url-utils.js
 *
 * Feature: 3d-model-extractor-extension, Property 9: Filename Sanitization Invariant
 * Validates: Requirements 7.3
 */
describe('Property Tests: Filename Sanitization Invariant', () => {
  /**
   * Regex for characters invalid in filenames on Windows, macOS, and Linux.
   * Includes: < > : " / \ | ? * and control characters (ASCII 0-31).
   */
  // eslint-disable-next-line no-control-regex
  const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/;

  /**
   * Arbitrary for strings that include a mix of normal characters,
   * special filesystem-invalid characters, and control characters.
   */
  const arbFilenameInput = fc.oneof(
    // Completely arbitrary strings (may include any unicode)
    fc.string(),
    // Empty string
    fc.constant(''),
    // Strings with lots of invalid filesystem characters
    fc.string({
      unit: fc.constantFrom(...'<>:"/\\|?*\x00\x01\x0a\x1fabcdefghijklmnop._ -'.split('')),
      minLength: 0,
      maxLength: 50
    }),
    // Strings composed entirely of invalid characters
    fc.string({
      unit: fc.constantFrom(...'<>:"/\\|?*'.split('')),
      minLength: 1,
      maxLength: 20
    }),
    // Strings with control characters only
    fc.string({
      unit: fc.integer({ min: 0, max: 31 }).map(c => String.fromCharCode(c)),
      minLength: 1,
      maxLength: 20
    }),
    // Realistic filenames with some invalid chars mixed in
    fc.tuple(
      fc.string({
        unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
        minLength: 1,
        maxLength: 15
      }),
      fc.constantFrom('.glb', '.txt', '.obj', '')
    ).map(([name, ext]) => name + ext),
    // Filenames with embedded invalid characters
    fc.tuple(
      fc.string({
        unit: fc.constantFrom(...'abcdef'.split('')),
        minLength: 1,
        maxLength: 5
      }),
      fc.constantFrom('<', '>', ':', '"', '/', '\\', '|', '?', '*', '\x00', '\x1f'),
      fc.string({
        unit: fc.constantFrom(...'ghijkl'.split('')),
        minLength: 1,
        maxLength: 5
      })
    ).map(([a, invalid, b]) => a + invalid + b)
  );

  it('sanitized output contains no invalid filesystem characters', () => {
    fc.assert(
      fc.property(arbFilenameInput, (input) => {
        const result = sanitizeFilename(input);

        // Result must be a string
        expect(typeof result).toBe('string');

        // Result must contain no invalid characters
        expect(INVALID_CHARS.test(result)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('sanitizeFilename is idempotent: applying it twice yields the same result as once', () => {
    fc.assert(
      fc.property(arbFilenameInput, (input) => {
        const once = sanitizeFilename(input);
        const twice = sanitizeFilename(once);

        expect(twice).toBe(once);
      }),
      { numRuns: 200 }
    );
  });
});
