/**
 * GLB meshopt decompression module.
 *
 * Fetches a GLB file, checks for EXT_meshopt_compression, decompresses
 * all compressed buffer views, and returns a clean GLB without the extension.
 * Falls back to the original binary if decompression fails.
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
  // Fetch the raw GLB binary
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  // Try to decompress
  try {
    const result = await decompressGlb(arrayBuffer);
    return result;
  } catch (err) {
    // Decompression failed — return original with warning
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
  let offset = 12; // After header (magic + version + length)
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

    // Chunks are padded to 4-byte alignment
    offset += 8 + chunkLength;
    if (offset % 4 !== 0) offset += 4 - (offset % 4);
  }

  if (!jsonChunk) {
    throw new Error('No JSON chunk found in GLB');
  }

  const jsonText = new TextDecoder().decode(jsonChunk);
  const gltf = JSON.parse(jsonText);

  // Check if the file uses EXT_meshopt_compression
  const extUsed = gltf.extensionsUsed || [];
  const extRequired = gltf.extensionsRequired || [];
  if (!extUsed.includes('EXT_meshopt_compression') && !extRequired.includes('EXT_meshopt_compression')) {
    // No meshopt compression — return as-is
    return {
      blob: new Blob([buffer], { type: 'model/gltf-binary' }),
      decompressed: false,
    };
  }

  // Initialize the meshopt decoder
  await MeshoptDecoder.ready;

  // Decompress all buffer views that have the extension
  const bufferViews = gltf.bufferViews || [];
  const binData = binChunk ? new Uint8Array(binChunk) : new Uint8Array(0);

  // Build new buffer data
  const decodedBufferViews = [];
  let newBufferSize = 0;

  for (let i = 0; i < bufferViews.length; i++) {
    const bv = bufferViews[i];
    const ext = bv.extensions?.EXT_meshopt_compression;

    if (ext) {
      // Decompress this buffer view
      const { byteOffset = 0, byteLength, byteStride = 0, count, mode, filter = 'NONE' } = ext;
      const source = binData.slice(byteOffset, byteOffset + byteLength);

      const stride = byteStride || (ext.byteLength ? Math.ceil(ext.byteLength / count) : 0);
      if (stride === 0) {
        throw new Error(`Cannot determine stride for bufferView ${i}`);
      }

      const outputSize = count * stride;
      const decoded = new Uint8Array(outputSize);

      // Map mode string to decoder function
      const modeMap = {
        ATTRIBUTES: MeshoptDecoder.decodeVertexBuffer,
        TRIANGLES: MeshoptDecoder.decodeIndexBuffer,
        INDICES: MeshoptDecoder.decodeIndexSequence,
      };

      const decodeFn = modeMap[mode];
      if (!decodeFn) {
        throw new Error(`Unknown meshopt mode: ${mode}`);
      }

      decodeFn(decoded, count, stride, source, mode === 'TRIANGLES' ? 'triangles' : mode === 'INDICES' ? 'indices' : undefined);

      // Apply filter if specified
      if (filter !== 'NONE') {
        const filterMap = {
          OCTAHEDRAL: MeshoptDecoder.decodeFilterOct,
          QUATERNION: MeshoptDecoder.decodeFilterQuat,
          EXPONENTIAL: MeshoptDecoder.decodeFilterExp,
        };
        const filterFn = filterMap[filter];
        if (filterFn) {
          filterFn(decoded, count, stride);
        }
      }

      // Store decoded data with alignment
      const alignedOffset = (newBufferSize + 3) & ~3;
      decodedBufferViews.push({
        index: i,
        data: decoded,
        offset: alignedOffset,
        byteLength: outputSize,
        byteStride: bv.byteStride || (stride > 4 ? stride : undefined),
      });
      newBufferSize = alignedOffset + outputSize;
    } else {
      // Uncompressed buffer view — copy as-is
      const byteOffset = bv.byteOffset || 0;
      const byteLength = bv.byteLength;
      const data = binData.slice(byteOffset, byteOffset + byteLength);

      const alignedOffset = (newBufferSize + 3) & ~3;
      decodedBufferViews.push({
        index: i,
        data,
        offset: alignedOffset,
        byteLength,
        byteStride: bv.byteStride,
      });
      newBufferSize = alignedOffset + byteLength;
    }
  }

  // Build new binary buffer
  const newBinBuffer = new Uint8Array(newBufferSize);
  for (const dbv of decodedBufferViews) {
    newBinBuffer.set(dbv.data, dbv.offset);
  }

  // Update the glTF JSON
  for (const dbv of decodedBufferViews) {
    const bv = bufferViews[dbv.index];
    bv.byteOffset = dbv.offset;
    bv.byteLength = dbv.byteLength;
    if (dbv.byteStride) {
      bv.byteStride = dbv.byteStride;
    } else {
      delete bv.byteStride;
    }
    // Remove the meshopt extension from this buffer view
    if (bv.extensions) {
      delete bv.extensions.EXT_meshopt_compression;
      if (Object.keys(bv.extensions).length === 0) {
        delete bv.extensions;
      }
    }
  }

  // Update buffer size
  if (gltf.buffers && gltf.buffers.length > 0) {
    gltf.buffers[0].byteLength = newBufferSize;
  }

  // Remove the extension from extensionsUsed/extensionsRequired
  gltf.extensionsUsed = extUsed.filter(e => e !== 'EXT_meshopt_compression');
  gltf.extensionsRequired = extRequired.filter(e => e !== 'EXT_meshopt_compression');
  if (gltf.extensionsUsed.length === 0) delete gltf.extensionsUsed;
  if (gltf.extensionsRequired && gltf.extensionsRequired.length === 0) delete gltf.extensionsRequired;

  // Rebuild the GLB
  const newJsonText = JSON.stringify(gltf);
  const newJsonBuffer = new TextEncoder().encode(newJsonText);
  // Pad JSON to 4-byte alignment with spaces
  const jsonPadding = (4 - (newJsonBuffer.byteLength % 4)) % 4;
  const paddedJsonLength = newJsonBuffer.byteLength + jsonPadding;

  // Pad binary to 4-byte alignment with zeros
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
  // Pad with spaces (0x20)
  for (let i = 0; i < jsonPadding; i++) {
    outBytes[pos + 8 + newJsonBuffer.byteLength + i] = 0x20;
  }
  pos += 8 + paddedJsonLength;

  // BIN chunk
  outView.setUint32(pos, paddedBinLength, true);
  outView.setUint32(pos + 4, BIN_CHUNK_TYPE, true);
  outBytes.set(newBinBuffer, pos + 8);
  // Pad with zeros (already 0)

  return {
    blob: new Blob([output], { type: 'model/gltf-binary' }),
    decompressed: true,
  };
}
