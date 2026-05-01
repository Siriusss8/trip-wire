/**
 * GLB meshopt decompression module.
 *
 * Fetches a GLB file, checks for EXT_meshopt_compression, decompresses
 * all compressed buffer views, and returns a clean GLB without the extension.
 * Falls back to the original binary if decompression fails.
 *
 * Handles gltfpack's multi-buffer layout where:
 * - Buffer 0: contains uncompressed data (images, etc.) in the GLB BIN chunk
 * - Buffer 1+: contains compressed mesh data referenced by the extension
 *   (also stored in the same BIN chunk, but at different offsets tracked by
 *    the buffer's byteLength)
 */

import { MeshoptDecoder } from './meshopt_decoder.js';

/**
 * @typedef {Object} DecompressResult
 * @property {Blob} blob - The GLB file as a Blob (decompressed or original)
 * @property {boolean} decompressed - Whether decompression was performed
 * @property {string} [warning] - Warning message if decompression failed
 */

const GLB_MAGIC = 0x46546C67; // 'glTF'
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4E4F534A; // 'JSON'
const BIN_CHUNK_TYPE = 0x004E4942; // 'BIN\0'

/**
 * Fetch a GLB file and attempt meshopt decompression.
 *
 * @param {string} url - The GLB file URL
 * @returns {Promise<DecompressResult>}
 */
export async function fetchAndDecompress(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  try {
    return await decompressGlb(arrayBuffer);
  } catch (err) {
    return {
      blob: new Blob([arrayBuffer], { type: 'model/gltf-binary' }),
      decompressed: false,
      warning: `Decompression failed: ${err.message}. Saving compressed version.`,
    };
  }
}

/**
 * Decompress a GLB ArrayBuffer that uses EXT_meshopt_compression.
 *
 * @param {ArrayBuffer} buffer - The raw GLB file
 * @returns {Promise<DecompressResult>}
 */
async function decompressGlb(buffer) {
  const view = new DataView(buffer);

  // Validate GLB header
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('Not a valid GLB file');
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    throw new Error('Unsupported GLB version');
  }

  // Parse chunks
  let offset = 12;
  let jsonChunk = null;
  let binChunk = null;

  while (offset < buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkData = buffer.slice(offset + 8, offset + 8 + chunkLength);

    if (chunkType === JSON_CHUNK_TYPE) {
      jsonChunk = chunkData;
    } else if (chunkType === BIN_CHUNK_TYPE) {
      binChunk = chunkData;
    }

    offset += 8 + chunkLength;
    // GLB chunks are already 4-byte aligned by spec (chunkLength includes padding)
  }

  if (!jsonChunk) {
    throw new Error('No JSON chunk found in GLB');
  }

  const jsonText = new TextDecoder().decode(jsonChunk);
  const gltf = JSON.parse(jsonText);

  // Check if the file uses EXT_meshopt_compression
  const extUsed = gltf.extensionsUsed || [];
  const extRequired = gltf.extensionsRequired || [];
  if (!extUsed.includes('EXT_meshopt_compression') &&
      !extRequired.includes('EXT_meshopt_compression')) {
    return {
      blob: new Blob([buffer], { type: 'model/gltf-binary' }),
      decompressed: false,
    };
  }

  // Initialize the meshopt decoder
  await MeshoptDecoder.ready;

  const binData = binChunk ? new Uint8Array(binChunk) : new Uint8Array(0);
  const bufferViews = gltf.bufferViews || [];
  const buffers = gltf.buffers || [];

  // gltfpack stores all buffer data sequentially in the single BIN chunk.
  // Each buffer's data starts at the cumulative offset of previous buffers.
  // Build a map of buffer index → byte offset within the BIN chunk.
  const bufferOffsets = [];
  let cumulativeOffset = 0;
  for (let i = 0; i < buffers.length; i++) {
    bufferOffsets.push(cumulativeOffset);
    // For GLB, buffer 0's byteLength tells us where buffer 1 starts, etc.
    cumulativeOffset += buffers[i].byteLength || 0;
  }

  /**
   * Get the raw bytes for a given buffer index + offset + length from the BIN chunk.
   */
  function getBufferData(bufferIndex, byteOffset, byteLength) {
    const base = bufferOffsets[bufferIndex] || 0;
    const start = base + byteOffset;
    return binData.slice(start, start + byteLength);
  }

  // Process all buffer views: decompress compressed ones, copy uncompressed ones
  const decodedChunks = [];
  let newBufferSize = 0;

  for (let i = 0; i < bufferViews.length; i++) {
    const bv = bufferViews[i];
    const ext = bv.extensions?.EXT_meshopt_compression;

    if (ext) {
      // This bufferView is meshopt-compressed
      const srcBuffer = ext.buffer !== undefined ? ext.buffer : (bv.buffer || 0);
      const srcOffset = ext.byteOffset || 0;
      const srcLength = ext.byteLength;
      const count = ext.count;
      const mode = ext.mode;
      const filter = ext.filter || 'NONE';
      const stride = ext.byteStride;

      if (!stride || !count || !mode) {
        throw new Error(`Missing required meshopt fields for bufferView ${i}`);
      }

      // Read compressed source data from the correct buffer
      const source = getBufferData(srcBuffer, srcOffset, srcLength);

      const outputSize = count * stride;
      const decoded = new Uint8Array(outputSize);

      // Decode with filter applied (filter is passed to decodeVertexBuffer)
      if (mode === 'ATTRIBUTES') {
        MeshoptDecoder.decodeVertexBuffer(decoded, count, stride, source, filter);
      } else if (mode === 'TRIANGLES') {
        MeshoptDecoder.decodeIndexBuffer(decoded, count, stride, source);
      } else if (mode === 'INDICES') {
        MeshoptDecoder.decodeIndexSequence(decoded, count, stride, source);
      } else {
        throw new Error(`Unknown meshopt mode: ${mode}`);
      }

      // Align to 4 bytes
      const alignedOffset = (newBufferSize + 3) & ~3;
      decodedChunks.push({ index: i, data: decoded, offset: alignedOffset });
      newBufferSize = alignedOffset + outputSize;

      // Update the bufferView in-place
      bv.buffer = 0;
      bv.byteOffset = alignedOffset;
      bv.byteLength = outputSize;
      // byteStride: keep the original bv.byteStride if it was set, otherwise
      // set it from the extension stride (but only for vertex buffers with stride > element size)
      if (!bv.byteStride && mode === 'ATTRIBUTES' && stride > 0) {
        bv.byteStride = stride;
      }
      // Remove the extension
      delete bv.extensions.EXT_meshopt_compression;
      if (Object.keys(bv.extensions).length === 0) {
        delete bv.extensions;
      }

    } else {
      // Uncompressed bufferView — copy from its source buffer
      const srcBuffer = bv.buffer || 0;
      const srcOffset = bv.byteOffset || 0;
      const srcLength = bv.byteLength;
      const data = getBufferData(srcBuffer, srcOffset, srcLength);

      const alignedOffset = (newBufferSize + 3) & ~3;
      decodedChunks.push({ index: i, data, offset: alignedOffset });
      newBufferSize = alignedOffset + srcLength;

      // Update bufferView to point to new single buffer
      bv.buffer = 0;
      bv.byteOffset = alignedOffset;
      // byteLength stays the same
    }
  }

  // Build the new single binary buffer
  const newBinBuffer = new Uint8Array(newBufferSize);
  for (const chunk of decodedChunks) {
    newBinBuffer.set(chunk.data, chunk.offset);
  }

  // Update glTF JSON: single buffer, remove extra buffers
  gltf.buffers = [{ byteLength: newBufferSize }];

  // Remove EXT_meshopt_compression from extensions lists
  gltf.extensionsUsed = extUsed.filter(e => e !== 'EXT_meshopt_compression');
  gltf.extensionsRequired = extRequired.filter(e => e !== 'EXT_meshopt_compression');
  if (gltf.extensionsUsed.length === 0) delete gltf.extensionsUsed;
  if (gltf.extensionsRequired && gltf.extensionsRequired.length === 0) delete gltf.extensionsRequired;

  // Also clean up any buffer-level extensions (gltfpack sometimes puts them there)
  // This is already handled by replacing gltf.buffers above.

  // Rebuild the GLB
  const newJsonText = JSON.stringify(gltf);
  const newJsonBuffer = new TextEncoder().encode(newJsonText);
  const jsonPadding = (4 - (newJsonBuffer.byteLength % 4)) % 4;
  const paddedJsonLength = newJsonBuffer.byteLength + jsonPadding;

  const binPadding = (4 - (newBinBuffer.byteLength % 4)) % 4;
  const paddedBinLength = newBinBuffer.byteLength + binPadding;

  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
  const output = new ArrayBuffer(totalLength);
  const outView = new DataView(output);
  const outBytes = new Uint8Array(output);

  // GLB header
  outView.setUint32(0, GLB_MAGIC, true);
  outView.setUint32(4, GLB_VERSION, true);
  outView.setUint32(8, totalLength, true);

  // JSON chunk
  let pos = 12;
  outView.setUint32(pos, paddedJsonLength, true);
  outView.setUint32(pos + 4, JSON_CHUNK_TYPE, true);
  outBytes.set(newJsonBuffer, pos + 8);
  for (let i = 0; i < jsonPadding; i++) {
    outBytes[pos + 8 + newJsonBuffer.byteLength + i] = 0x20;
  }
  pos += 8 + paddedJsonLength;

  // BIN chunk
  outView.setUint32(pos, paddedBinLength, true);
  outView.setUint32(pos + 4, BIN_CHUNK_TYPE, true);
  outBytes.set(newBinBuffer, pos + 8);

  return {
    blob: new Blob([output], { type: 'model/gltf-binary' }),
    decompressed: true,
  };
}
