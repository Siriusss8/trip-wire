# TripWire

Browser extension that detects GLB 3D model files loaded by web pages and lets you download them. Works on any page that loads `.glb` files — model galleries, AI generation tools, asset stores, whatever.

It also decompresses meshopt-compressed models on the fly, so you get clean GLBs ready to import into Blender, Unity, or whatever you use.

## Install

### From a release (recommended)

1. Download the latest zip from [Releases](../../releases)
2. Unzip it

**Chrome:** go to `chrome://extensions`, enable Developer Mode, click "Load unpacked", select the unzipped folder.

**Firefox:** go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", select `manifest.json` from the unzipped folder. Firefox temporary add-ons don't persist across restarts.

### From source

```
git clone https://github.com/Siriusss8/trip-wire.git
cd trip-wire
npm install
npm run build
```

Then load the `dist/` folder as an unpacked extension (same steps as above).

## Usage

1. Navigate to a page with 3D models
2. The badge on the extension icon shows how many GLB files were detected
3. Click the icon to see the list
4. Hit Download

The extension tries to name files after the model (pulled from the page title or DOM), but it's only best-effort. If meshopt compression is detected, it decompresses automatically and strips the `_meshopt` suffix.

## How it works

- A `webRequest.onCompleted` listener in the background service worker watches for HTTP responses with `.glb` in the path
- Detected models are stored per-tab in `chrome.storage.session`
- On download, the popup fetches the GLB, checks for `EXT_meshopt_compression`, decompresses if needed, and triggers a download via the `downloads` API
- A content script extracts a human-readable name from the page (og:title, dialog headings, document title) with a tab-title fallback if the content script can't communicate

## Development

```
npm install
npm test          # vitest, includes property-based tests
npm run lint      # eslint
npm run build     # copies extension files to dist/
```

The extension is plain JS with ES modules, no build/bundle step. The `dist/` folder is just a clean copy without dev files.

### Project structure

```
background.js        Service worker — request interception, per-tab state, badge
content-script.js    Injected into pages — extracts model names from the DOM
popup.js             Popup UI — renders model list, handles downloads
popup.html/css       Popup markup and styles
url-utils.js         URL parsing, GLB detection, filename derivation
format-utils.js      Display formatting (file sizes, timestamps)
glb-decompress.js    Meshopt decompression of GLB files
browser-api.js       Cross-browser API wrapper (Chrome/Firefox)
browser-polyfill.js  webextension-polyfill (vendored)
meshopt_decoder.js   meshoptimizer WASM decoder (vendored)
scripts/build.js     Copies extension files to dist/
```

### Releasing

Push a version tag:

```
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions runs lint + tests, builds a zip, and attaches it to a release.

## License

MIT

---

Only download 3D models you have the rights or permission to download. This tool doesn't bypass any access controls — if a file is served to your browser, it lets you save it. What you do with it is on you.
