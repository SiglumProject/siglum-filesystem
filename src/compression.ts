/**
 * Compression utilities using native browser APIs
 *
 * Uses CompressionStream/DecompressionStream for zero bundle cost compression.
 * Also provides synchronous fflate functions for worker contexts where
 * streaming isn't needed (3-6x faster than async in tight loops).
 *
 * Usage:
 * - Main thread: use compress/decompress (async, non-blocking)
 * - Workers: use compressSync/decompressSync if fflate is available
 */

// ============================================================================
// Async compression using native CompressionStream (main thread friendly)
// ============================================================================

/**
 * Compress data using native gzip compression
 * Zero bundle cost - uses browser's built-in CompressionStream
 *
 * @param data - Data to compress
 * @returns Compressed data (gzip format)
 */
export async function compress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(data)
  writer.close()

  // Use Response.arrayBuffer() for efficient concatenation (browser-optimized)
  const response = new Response(cs.readable)
  const buffer = await response.arrayBuffer()
  return new Uint8Array(buffer)
}

/**
 * Decompress gzip data using native decompression
 *
 * @param data - Compressed data (gzip format)
 * @returns Decompressed data
 */
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(data)
  writer.close()

  // Use Response.arrayBuffer() for efficient concatenation (browser-optimized)
  const response = new Response(ds.readable)
  const buffer = await response.arrayBuffer()
  return new Uint8Array(buffer)
}

// ============================================================================
// Streaming compression for large files
// ============================================================================

/**
 * Get a compression transform stream
 * Use with .pipeThrough() for streaming compression
 */
export function compressStream(): CompressionStream {
  return new CompressionStream('gzip')
}

/**
 * Get a decompression transform stream
 * Use with .pipeThrough() for streaming decompression
 */
export function decompressStream(): DecompressionStream {
  return new DecompressionStream('gzip')
}

/**
 * Compress a ReadableStream
 *
 * @param stream - Input stream
 * @returns Compressed stream
 */
export function compressReadableStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return stream.pipeThrough(new CompressionStream('gzip'))
}

/**
 * Decompress a ReadableStream
 *
 * @param stream - Compressed input stream
 * @returns Decompressed stream
 */
export function decompressReadableStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return stream.pipeThrough(new DecompressionStream('gzip'))
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if native compression is available
 */
export function isCompressionAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

/**
 * Estimate compression ratio for a given data type
 * Text typically compresses 60-80%, binary varies widely
 */
export function estimateCompressionRatio(data: Uint8Array): number {
  // Simple heuristic: check entropy by sampling
  const sampleSize = Math.min(1000, data.length)
  const sample = data.slice(0, sampleSize)

  const byteFreq = new Uint32Array(256)
  for (let i = 0; i < sample.length; i++) {
    byteFreq[sample[i]]++
  }

  // Count unique bytes - more unique = higher entropy = less compressible
  let uniqueBytes = 0
  for (let i = 0; i < 256; i++) {
    if (byteFreq[i] > 0) uniqueBytes++
  }

  // Rough estimate: 256 unique = ~0% compression, <50 unique = ~70% compression
  if (uniqueBytes < 50) return 0.3  // 70% compression
  if (uniqueBytes < 100) return 0.5 // 50% compression
  if (uniqueBytes < 150) return 0.7 // 30% compression
  return 0.9 // 10% compression
}

/**
 * Determine if compression would be beneficial for this data
 * Returns true if compression is likely to reduce size significantly
 */
export function shouldCompress(data: Uint8Array, minSizeBytes: number = 1024): boolean {
  // Don't compress small files
  if (data.length < minSizeBytes) return false

  // Check if already compressed (gzip magic number)
  if (data[0] === 0x1f && data[1] === 0x8b) return false

  // Check if PNG (already compressed)
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return false

  // Check if JPEG (already compressed)
  if (data[0] === 0xff && data[1] === 0xd8) return false

  // Check if PDF (may contain compressed streams)
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return false

  // Check entropy
  const ratio = estimateCompressionRatio(data)
  return ratio < 0.8 // Only compress if we expect >20% reduction
}

/**
 * Auto-compress: only compress if beneficial
 * Returns the smaller of compressed or original data
 */
export async function autoCompress(data: Uint8Array): Promise<{ data: Uint8Array; compressed: boolean }> {
  if (!shouldCompress(data)) {
    return { data, compressed: false }
  }

  const compressed = await compress(data)

  // Only use compressed if it's actually smaller
  if (compressed.length < data.length * 0.95) {
    return { data: compressed, compressed: true }
  }

  return { data, compressed: false }
}

/**
 * Auto-decompress: detect gzip and decompress if needed
 */
export async function autoDecompress(data: Uint8Array): Promise<Uint8Array> {
  // Check gzip magic number
  if (data[0] === 0x1f && data[1] === 0x8b) {
    return decompress(data)
  }
  return data
}

// ============================================================================
// Synchronous compression using fflate (WASM SIMD, 3-6x faster in workers)
// These functions are only available when fflate is installed
// ============================================================================

// Dynamic import cache for fflate
type FflateModule = {
  gzipSync: (data: Uint8Array, opts?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }) => Uint8Array
  gunzipSync: (data: Uint8Array) => Uint8Array
}
let fflateModule: FflateModule | null = null
let fflateLoadPromise: Promise<FflateModule | null> | null = null

/**
 * Load fflate module (lazy, cached)
 */
async function loadFflate(): Promise<FflateModule | null> {
  if (fflateModule) return fflateModule
  if (fflateLoadPromise) return fflateLoadPromise

  fflateLoadPromise = (async () => {
    try {
      // Dynamic import - only loads if fflate is installed
      const module = await import('fflate')
      fflateModule = {
        gzipSync: module.gzipSync,
        gunzipSync: module.gunzipSync
      }
      return fflateModule
    } catch {
      // fflate not installed - that's OK
      return null
    }
  })()

  return fflateLoadPromise
}

/**
 * Check if fflate (WASM SIMD compression) is available
 */
export async function isFflateAvailable(): Promise<boolean> {
  const module = await loadFflate()
  return module !== null
}

/**
 * Synchronous gzip compression using fflate
 * 3-6x faster than async compression, ideal for workers
 *
 * @param data - Data to compress
 * @param level - Compression level 0-9 (default: 6)
 * @returns Compressed data, or throws if fflate not available
 */
export function compressSync(data: Uint8Array, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Uint8Array {
  if (!fflateModule) {
    throw new Error('fflate not loaded. Call await loadFflate() first or use async compress()')
  }
  return fflateModule.gzipSync(data, { level })
}

/**
 * Synchronous gzip decompression using fflate
 * Much faster than async decompression in tight loops
 *
 * @param data - Compressed data
 * @returns Decompressed data, or throws if fflate not available
 */
export function decompressSync(data: Uint8Array): Uint8Array {
  if (!fflateModule) {
    throw new Error('fflate not loaded. Call await loadFflate() first or use async decompress()')
  }
  return fflateModule.gunzipSync(data)
}

/**
 * Initialize fflate for sync compression
 * Call this at worker startup if you plan to use compressSync/decompressSync
 *
 * @returns true if fflate is available, false otherwise
 */
export async function initSyncCompression(): Promise<boolean> {
  const module = await loadFflate()
  return module !== null
}
