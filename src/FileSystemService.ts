/**
 * FileSystemService - Unified filesystem abstraction
 *
 * This service provides a single interface for all file operations,
 * abstracting over different backends:
 * - OPFS (primary storage for documents, compiler, output)
 * - IndexedDB (fallback for browsers without OPFS)
 *
 * The service manages multiple mount points, allowing different parts
 * of the filesystem to be backed by different storage mechanisms.
 *
 * Example:
 *   /documents/  -> OPFSBackend (local documents)
 *   /compiler/   -> OPFSBackend (LaTeX binaries)
 *   /output/     -> OPFSBackend (compiled PDFs)
 */

import { BACKEND_STORAGE_KEY, IDB_FILES_STORE, IDB_NAME } from './constants.js'

import type {
  FileSystemBackend,
  FileStats,
  FileEntry,
  FileSystemEvent,
  FileSystemEventHandler,
  WriteOptions,
  WriteBinaryBatchEntry,
  WriteBinaryBatchOptions,
} from './types.js'
import {
  compress,
  autoCompress,
  autoDecompress
} from './compression.js'

interface MountPoint {
  path: string
  backend: FileSystemBackend
}

export type BackendPreference = 'opfs' | 'indexeddb' | 'auto'

export interface MountOptions {
  /** Which backend to use: 'opfs', 'indexeddb', or 'auto' (default: 'auto') */
  backend?: BackendPreference
  /** OPFS namespace — creates an isolated storage root (default: 'siglum-files') */
  namespace?: string
}

/**
 * Check if OPFS is available in the current browser
 */
export function isOPFSAvailable(): boolean {
  return typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    'getDirectory' in navigator.storage
}

/**
 * Test if OPFS write support works (Safari doesn't support createWritable)
 */
async function testOPFSWriteSupport(): Promise<boolean> {
  // Use unique filename to avoid race conditions
  const testFileName = `.opfs-write-test-${Date.now()}-${Math.random().toString(36).slice(2)}`

  try {
    const root = await navigator.storage.getDirectory()
    const testFile = await root.getFileHandle(testFileName, { create: true })

    // Safari doesn't support createWritable - this is what fails
    if (typeof (testFile as any).createWritable !== 'function') {
      // Clean up even on failure path
      try { await root.removeEntry(testFileName) } catch {}
      return false
    }

    const writable = await (testFile as any).createWritable()
    await writable.write('test')
    await writable.close()

    // Clean up test file
    try { await root.removeEntry(testFileName) } catch {}
    return true
  } catch (e) {
    // Log the actual error for debugging
    console.warn('[FileSystem] OPFS write test failed:', e)
    return false
  }
}

// Keep the same storage location across reloads. A transient OPFS failure must
// not make an existing project appear empty by silently opening IndexedDB instead.
let cachedBestBackend: FileSystemBackend | null = null
let bestBackendPromise: Promise<FileSystemBackend> | null = null

function savedBackend(): 'opfs' | 'indexeddb' | null {
  try {
    const value = localStorage.getItem(BACKEND_STORAGE_KEY)
    return value === 'opfs' || value === 'indexeddb' ? value : null
  } catch { return null }
}

function rememberBackend(backend: FileSystemBackend, persist = true): FileSystemBackend {
  try { if (persist) localStorage.setItem(BACKEND_STORAGE_KEY, backend.name) } catch { /* Storage may be restricted. */ }
  cachedBestBackend = backend
  return backend
}

function isLegacyDocument(path: string): boolean {
  return /^\/[^/]+\.tex$/i.test(path)
}

async function hasIndexedDBProjectFiles(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false

  const database = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME)
    let missing = false
    request.onupgradeneeded = () => {
      // Opening a nonexistent database starts creation. Cancel this probe.
      missing = true
      request.transaction!.abort()
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => missing ? resolve(null) : reject(request.error)
  })
  if (!database) return false

  try {
    if (!database.objectStoreNames.contains(IDB_FILES_STORE)) return false
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = database.transaction(IDB_FILES_STORE, 'readonly')
      const request = transaction.objectStore(IDB_FILES_STORE).openKeyCursor()
      transaction.onabort = () => reject(transaction.error)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(false)
        } else if (typeof cursor.key === 'string' &&
          (cursor.key.startsWith('/src/') || isLegacyDocument(cursor.key))) {
          resolve(true)
        } else {
          cursor.continue()
        }
      }
    })
  } finally {
    database.close()
  }
}

function directoryEntries(directory: FileSystemDirectoryHandle): AsyncIterable<FileSystemHandle> {
  return (directory as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }).values()
}

async function containsFiles(directory: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const entry of directoryEntries(directory)) {
    if (entry.kind === 'file' || await containsFiles(entry as FileSystemDirectoryHandle)) return true
  }
  return false
}

async function openDirectory(root: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(name)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

async function detectDocumentBackend(): Promise<'opfs' | 'indexeddb'> {
  try {
    const root = await navigator.storage.getDirectory()
    const files = await openDirectory(root, 'siglum-files')
    if (files) {
      for await (const entry of directoryEntries(files)) {
        if (entry.kind === 'file' && isLegacyDocument(`/${entry.name}`)) return 'opfs'
        if (entry.kind === 'directory' && entry.name === 'src' &&
          await containsFiles(entry as FileSystemDirectoryHandle)) return 'opfs'
      }
    }
    const git = await openDirectory(root, 'siglum-git')
    if (git && await containsFiles(git)) return 'opfs'
    return await hasIndexedDBProjectFiles() ? 'indexeddb' : 'opfs'
  } catch {
    // A partial inspection cannot establish which store contains the documents.
    throw new Error('Your document storage is temporarily unavailable. Reload to try again.')
  }
}

async function hasExistingOPFSFiles(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory()
    for (const name of ['siglum-files', 'siglum-git']) {
      try {
        const directory = await root.getDirectoryHandle(name)
        for await (const _entry of directoryEntries(directory)) return true
      } catch { /* This namespace has not been used. */ }
    }
  } catch { /* Storage is unavailable; the saved preference is checked separately. */ }
  return false
}

export async function getBestBackend(): Promise<FileSystemBackend> {
  if (cachedBestBackend) return cachedBestBackend
  if (bestBackendPromise) return bestBackendPromise

  bestBackendPromise = (async () => {
    const previous = savedBackend()
    if (previous !== 'indexeddb' && isOPFSAvailable()) {
      if (await testOPFSWriteSupport()) {
        // Older versions saved OPFS before confirming it contained the project.
        const detected = await detectDocumentBackend()
        if (detected === 'indexeddb') {
          const { indexedDBBackend } = await import('./IndexedDBBackend.js')
          console.log('[FileSystem] Using IndexedDB backend for existing documents')
          return rememberBackend(indexedDBBackend)
        }
        const { opfsBackend } = await import('./OPFSBackend.js')
        console.log('[FileSystem] Using OPFS backend')
        return rememberBackend(opfsBackend)
      }
      // Also protect existing installations which predate the saved preference.
      if (previous === 'opfs' || await hasExistingOPFSFiles()) {
        throw new Error('Your document storage is temporarily unavailable. Reload to try again. Siglum has not switched storage or replaced your documents.')
      }
    } else if (previous === 'opfs') {
      throw new Error('Your document storage is unavailable in this browser context. Reopen Siglum in the browser where you saved your documents.')
    }

    const { indexedDBBackend } = await import('./IndexedDBBackend.js')
    console.log('[FileSystem] Using IndexedDB backend')
    // A first-time fallback is tentative until a document is opened. This avoids
    // pinning an empty fallback when an older installation temporarily loses OPFS.
    return rememberBackend(indexedDBBackend, previous === 'indexeddb')
  })().catch(error => {
    bestBackendPromise = null
    throw error
  })

  return bestBackendPromise
}

/**
 * Get a specific backend by name
 */
export async function getBackend(preference: BackendPreference): Promise<FileSystemBackend> {
  switch (preference) {
    case 'opfs': {
      if (!isOPFSAvailable()) {
        throw new Error('OPFS is not available in this browser')
      }
      const { opfsBackend } = await import('./OPFSBackend.js')
      return opfsBackend
    }
    case 'indexeddb': {
      const { indexedDBBackend } = await import('./IndexedDBBackend.js')
      return indexedDBBackend
    }
    case 'auto':
    default:
      return getBestBackend()
  }
}

export class FileSystemService {
  private mounts: MountPoint[] = []
  private eventHandlers: Set<FileSystemEventHandler> = new Set()

  /**
   * Mount a backend at a specific path
   * More specific paths take precedence
   */
  mount(path: string, backend: FileSystemBackend): void {
    // Normalize path
    const normalizedPath = this.normalizeMountPath(path)

    // Remove existing mount at same path
    this.mounts = this.mounts.filter(m => m.path !== normalizedPath)

    // Add new mount
    this.mounts.push({ path: normalizedPath, backend })

    // Sort by path length descending (most specific first)
    this.mounts.sort((a, b) => b.path.length - a.path.length)
  }

  /**
   * Mount with automatic backend selection
   *
   * @param path - Path to mount
   * @param options - Mount options (backend preference)
   * @returns The backend that was mounted
   *
   * @example
   * // Auto-select best backend (OPFS if available, else IndexedDB)
   * const backend = await fileSystem.mountAuto('/documents')
   *
   * // Force OPFS (throws if not available)
   * await fileSystem.mountAuto('/documents', { backend: 'opfs' })
   *
   * // Force IndexedDB
   * await fileSystem.mountAuto('/documents', { backend: 'indexeddb' })
   */
  async mountAuto(path: string, options: MountOptions = {}): Promise<FileSystemBackend> {
    const preference = options.backend ?? 'auto'
    let backend = await getBackend(preference)

    // Namespaces isolate storage; they must not bypass backend selection or fallback.
    if (options.namespace) {
      if (backend.name === 'opfs') {
        const { OPFSBackend } = await import('./OPFSBackend.js')
        backend = new OPFSBackend(options.namespace)
      } else {
        const { IndexedDBBackend } = await import('./IndexedDBBackend.js')
        const { IDB_NAME } = await import('./constants.js')
        backend = new IndexedDBBackend(`${IDB_NAME}-${options.namespace}`)
      }
    }

    this.mount(path, backend)
    return backend
  }

  /**
   * Unmount a backend at a specific path
   */
  unmount(path: string): void {
    const normalizedPath = this.normalizeMountPath(path)
    this.mounts = this.mounts.filter(m => m.path !== normalizedPath)
  }

  /**
   * Get the backend for a given path
   */
  private getBackendForPath(path: string): { backend: FileSystemBackend; relativePath: string } {
    const normalizedPath = this.normalizePath(path)

    for (const mount of this.mounts) {
      if (normalizedPath.startsWith(mount.path) || normalizedPath === mount.path.slice(0, -1)) {
        // Remove mount prefix to get relative path
        let relativePath = normalizedPath.slice(mount.path.length)
        if (!relativePath.startsWith('/')) {
          relativePath = '/' + relativePath
        }
        return { backend: mount.backend, relativePath }
      }
    }

    throw new Error(`No filesystem mounted for path: ${path}`)
  }

  private normalizePath(path: string): string {
    if (!path.startsWith('/')) {
      path = '/' + path
    }
    return path.replace(/\/+/g, '/')
  }

  private normalizeMountPath(path: string): string {
    let normalized = this.normalizePath(path)
    if (!normalized.endsWith('/')) {
      normalized += '/'
    }
    return normalized
  }

  /**
   * Subscribe to filesystem events
   */
  subscribe(handler: FileSystemEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  private emit(event: FileSystemEvent): void {
    this.eventHandlers.forEach(handler => handler(event))
  }

  // File Operations

  async readFile(path: string): Promise<string> {
    const { backend, relativePath } = this.getBackendForPath(path)
    return backend.readFile(relativePath)
  }

  async readBinary(path: string, options?: { autoDecompress?: boolean }): Promise<Uint8Array> {
    const { backend, relativePath } = this.getBackendForPath(path)
    const data = await backend.readBinary(relativePath)

    // Auto-decompress if enabled (default: true) and data looks like gzip
    if (options?.autoDecompress !== false) {
      return autoDecompress(data)
    }

    return data
  }

  async writeFile(path: string, content: string, options?: WriteOptions): Promise<void> {
    const { backend, relativePath } = this.getBackendForPath(path)

    if (options?.createParents) {
      const parentPath = this.getParentPath(relativePath)
      if (parentPath !== '/') {
        await backend.mkdir(parentPath)
      }
    }

    // Only check exists if we need to emit events
    const shouldEmit = !options?.silent && this.eventHandlers.size > 0
    const existed = shouldEmit ? await backend.exists(relativePath) : false
    await backend.writeFile(relativePath, content)

    if (shouldEmit) {
      this.emit({
        type: existed ? 'file:modified' : 'file:created',
        path: this.normalizePath(path)
      })
    }
  }

  async writeBinary(path: string, content: Uint8Array, options?: WriteOptions): Promise<void> {
    const { backend, relativePath } = this.getBackendForPath(path)

    if (options?.createParents) {
      const parentPath = this.getParentPath(relativePath)
      if (parentPath !== '/') {
        await backend.mkdir(parentPath)
      }
    }

    // Handle compression
    let finalContent = content
    if (options?.compress === true) {
      finalContent = await compress(content)
    } else if (options?.compress === 'auto') {
      const result = await autoCompress(content)
      finalContent = result.data
    }

    // Only check exists if we need to emit events
    const shouldEmit = !options?.silent && this.eventHandlers.size > 0
    const existed = shouldEmit ? await backend.exists(relativePath) : false
    await backend.writeBinary(relativePath, finalContent)

    if (shouldEmit) {
      this.emit({
        type: existed ? 'file:modified' : 'file:created',
        path: this.normalizePath(path)
      })
    }
  }

  async deleteFile(path: string, options?: { silent?: boolean }): Promise<void> {
    const { backend, relativePath } = this.getBackendForPath(path)
    await backend.deleteFile(relativePath)

    if (!options?.silent) {
      this.emit({ type: 'file:deleted', path: this.normalizePath(path) })
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { backend, relativePath } = this.getBackendForPath(path)
      return backend.exists(relativePath)
    } catch {
      return false
    }
  }

  async stat(path: string): Promise<FileStats> {
    const { backend, relativePath } = this.getBackendForPath(path)
    return backend.stat(relativePath)
  }

  // Directory Operations

  async mkdir(path: string, options?: { silent?: boolean }): Promise<void> {
    const { backend, relativePath } = this.getBackendForPath(path)
    await backend.mkdir(relativePath)

    if (!options?.silent) {
      this.emit({ type: 'directory:created', path: this.normalizePath(path) })
    }
  }

  async rmdir(path: string, options?: { recursive?: boolean; silent?: boolean }): Promise<void> {
    const { backend, relativePath } = this.getBackendForPath(path)
    await backend.rmdir(relativePath, options)

    if (!options?.silent) {
      this.emit({ type: 'directory:deleted', path: this.normalizePath(path) })
    }
  }

  async readdir(path: string): Promise<FileEntry[]> {
    const { backend, relativePath } = this.getBackendForPath(path)
    const entries = await backend.readdir(relativePath)

    // Translate paths back to absolute paths
    const normalizedMountPath = this.normalizePath(path)
    return entries.map(entry => ({
      ...entry,
      path: (normalizedMountPath === '/' ? '' : normalizedMountPath) + '/' + entry.name
    }))
  }

  // Utility Operations

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldBackend = this.getBackendForPath(oldPath)
    const newBackend = this.getBackendForPath(newPath)
    const source = this.normalizePath(oldPath)
    const destination = this.normalizePath(newPath)
    if (source === destination) return

    const stats = await oldBackend.backend.stat(oldBackend.relativePath)
    if (stats.isDirectory) {
      if (oldBackend.relativePath === '/' || destination.startsWith(source + '/')) {
        throw new Error('EINVAL: cannot move a mounted root or a directory into itself')
      }
      if (await this.exists(destination)) throw new Error(`EEXIST: destination already exists: ${destination}`)
      const copyDirectory = async (from: string, to: string): Promise<void> => {
        await this.mkdir(to, { silent: true })
        for (const entry of await this.readdir(from)) {
          const target = to + '/' + entry.name
          if (entry.isDirectory) await copyDirectory(entry.path, target)
          else await this.copyFile(entry.path, target)
        }
      }
      // Keep the complete source until every destination write has succeeded.
      await copyDirectory(source, destination)
      await this.rmdir(source, { recursive: true, silent: true })
      this.emit({ type: 'directory:deleted', path: source })
      this.emit({ type: 'directory:created', path: destination })
      return
    }

    if (oldBackend.backend !== newBackend.backend) {
      // Cross-backend move: copy + delete
      const content = await oldBackend.backend.readBinary(oldBackend.relativePath)
      await newBackend.backend.writeBinary(newBackend.relativePath, content)
      await oldBackend.backend.deleteFile(oldBackend.relativePath)
    } else {
      await oldBackend.backend.rename(oldBackend.relativePath, newBackend.relativePath)
    }

    this.emit({ type: 'file:deleted', path: this.normalizePath(oldPath) })
    this.emit({ type: 'file:created', path: this.normalizePath(newPath) })
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const srcBackend = this.getBackendForPath(src)
    const destBackend = this.getBackendForPath(dest)

    if (srcBackend.backend !== destBackend.backend) {
      // Cross-backend copy
      const content = await srcBackend.backend.readBinary(srcBackend.relativePath)
      await destBackend.backend.writeBinary(destBackend.relativePath, content)
    } else {
      await srcBackend.backend.copyFile(srcBackend.relativePath, destBackend.relativePath)
    }

    this.emit({ type: 'file:created', path: this.normalizePath(dest) })
  }

  private getParentPath(path: string): string {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) return '/'
    return normalized.slice(0, lastSlash)
  }

  /**
   * Get information about mounted filesystems
   */
  getMounts(): Array<{ path: string; backend: string }> {
    return this.mounts.map(m => ({
      path: m.path,
      backend: m.backend.name
    }))
  }

  /**
   * Check if a path has a mounted backend
   */
  isMounted(path: string): boolean {
    try {
      this.getBackendForPath(path)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the backend type for a given path
   * Returns 'opfs', 'indexeddb', or null if not mounted
   */
  getBackendType(path: string): 'opfs' | 'indexeddb' | null {
    try {
      const { backend } = this.getBackendForPath(path)
      return backend.name as 'opfs' | 'indexeddb'
    } catch {
      return null
    }
  }

  /**
   * Read multiple files in a single batch operation
   * More efficient than individual reads for many small files
   *
   * @param paths - Array of file paths to read
   * @returns Map of path -> Uint8Array (missing files are omitted)
   */
  async readBinaryBatch(paths: string[]): Promise<Map<string, Uint8Array>> {
    const results = new Map<string, Uint8Array>()

    // Group paths by backend for more efficient batch reads
    const pathsByBackend = new Map<FileSystemBackend, Array<{ path: string; relativePath: string }>>()

    for (const path of paths) {
      try {
        const { backend, relativePath } = this.getBackendForPath(path)
        if (!pathsByBackend.has(backend)) {
          pathsByBackend.set(backend, [])
        }
        pathsByBackend.get(backend)!.push({ path, relativePath })
      } catch {
        // Skip paths without mounted backends
      }
    }

    // Read from each backend
    for (const [backend, backendPaths] of pathsByBackend) {
      // Check if backend supports batch reads
      if ('readBinaryBatch' in backend && typeof backend.readBinaryBatch === 'function') {
        const relativePaths = backendPaths.map(p => p.relativePath)
        const batchResults = await (backend as any).readBinaryBatch(relativePaths)
        for (const { path, relativePath } of backendPaths) {
          const data = batchResults.get(relativePath)
          if (data) {
            results.set(path, data)
          }
        }
      } else {
        // Fall back to individual reads in parallel
        const readPromises = backendPaths.map(async ({ path, relativePath }) => {
          try {
            const data = await backend.readBinary(relativePath)
            results.set(path, data)
          } catch {
            // File doesn't exist, skip
          }
        })
        await Promise.all(readPromises)
      }
    }

    return results
  }

  /**
   * Write multiple files in a single batch operation
   * Efficient for writing many files with progress reporting
   *
   * @param entries - Array of {path, content} entries to write
   * @param options - Batch write options including progress callback
   */
  async writeBinaryBatch(
    entries: WriteBinaryBatchEntry[],
    options: WriteBinaryBatchOptions = {}
  ): Promise<void> {
    const total = entries.length
    if (total === 0) {
      options.onProgress?.(0, 0)
      return
    }

    // Group entries by backend
    const entriesByBackend = new Map<FileSystemBackend, WriteBinaryBatchEntry[]>()
    const mountPathByBackend = new Map<FileSystemBackend, string>()

    for (const entry of entries) {
      try {
        const { backend, relativePath } = this.getBackendForPath(entry.path)
        if (!entriesByBackend.has(backend)) {
          entriesByBackend.set(backend, [])
          // Store the mount's relative path conversion for this backend
          const mount = this.mounts.find(m => m.backend === backend)
          mountPathByBackend.set(backend, mount?.path || '/')
        }
        // Convert to relative path for the backend
        entriesByBackend.get(backend)!.push({ path: relativePath, content: entry.content })
      } catch {
        // Skip entries without mounted backends
      }
    }

    let completed = 0

    // Write to each backend
    for (const [backend, backendEntries] of entriesByBackend) {
      const startCompleted = completed

      // Check if backend supports batch writes
      if (backend.writeBinaryBatch) {
        await backend.writeBinaryBatch(backendEntries, {
          ...options,
          onProgress: (c, _t) => {
            completed = startCompleted + c
            options.onProgress?.(completed, total)
          }
        })
        completed = startCompleted + backendEntries.length
      } else {
        // Fall back to sequential writes with createParents
        const { createParents = true, concurrency = 20 } = options

        for (let i = 0; i < backendEntries.length; i += concurrency) {
          const batch = backendEntries.slice(i, i + concurrency)
          await Promise.all(batch.map(async ({ path, content }) => {
            if (createParents) {
              const parentPath = this.getParentPath(path)
              if (parentPath !== '/') {
                await backend.mkdir(parentPath)
              }
            }
            await backend.writeBinary(path, content)
            completed++
          }))
          options.onProgress?.(completed, total)
        }
      }
    }

    // Emit events if not silent
    if (!options.silent && this.eventHandlers.size > 0) {
      for (const entry of entries) {
        this.emit({ type: 'file:created', path: this.normalizePath(entry.path) })
      }
    }
  }
}

// Export singleton instance
export const fileSystem = new FileSystemService()
