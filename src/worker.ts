/**
 * Worker-compatible filesystem access
 *
 * This module provides standalone functions for accessing OPFS and IndexedDB
 * from Web Workers that can't use ES modules (classic workers).
 *
 * Usage in a classic worker:
 *   importScripts('/path/to/siglum-filesystem-worker.js')
 *   const data = await siglumFS.readBinaryOPFS('/path/to/file')
 *
 * The compiled output is a self-contained IIFE that exposes `siglumFS` globally.
 */

// Storage constants (same as constants.ts)
const IDB_NAME = 'siglum_filesystem'
const IDB_VERSION = 1
const IDB_FILES_STORE = 'files'

interface StoredFile {
  path: string
  content: string | Uint8Array
  isBinary: boolean
  size: number
  mtime: number
  ctime: number
}

// ============================================================================
// IndexedDB helpers
// ============================================================================

let idbPromise: Promise<IDBDatabase> | null = null

function getIDB(): Promise<IDBDatabase> {
  if (idbPromise) return idbPromise

  idbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(IDB_FILES_STORE)) {
        const store = db.createObjectStore(IDB_FILES_STORE, { keyPath: 'path' })
        store.createIndex('mtime', 'mtime', { unique: false })
      }
      if (!db.objectStoreNames.contains('directories')) {
        db.createObjectStore('directories', { keyPath: 'path' })
      }
    }
  })

  return idbPromise
}

function normalizeIDBPath(path: string): string {
  if (!path.startsWith('/')) {
    path = '/' + path
  }
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  return path.replace(/\/+/g, '/')
}

/**
 * Read binary data from IndexedDB
 */
export async function readBinaryIDB(path: string): Promise<Uint8Array | null> {
  try {
    const db = await getIDB()
    const normalized = normalizeIDBPath(path)

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE], 'readonly')
      const store = transaction.objectStore(IDB_FILES_STORE)
      const request = store.get(normalized)

      request.onsuccess = () => {
        const file = request.result as StoredFile | undefined
        if (!file) {
          resolve(null)
          return
        }
        if (file.isBinary) {
          resolve(file.content as Uint8Array)
        } else {
          const encoder = new TextEncoder()
          resolve(encoder.encode(file.content as string))
        }
      }
      request.onerror = () => reject(request.error)
    })
  } catch {
    return null
  }
}

/**
 * Write binary data to IndexedDB
 */
export async function writeBinaryIDB(path: string, content: Uint8Array): Promise<void> {
  const db = await getIDB()
  const normalized = normalizeIDBPath(path)
  const now = Date.now()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([IDB_FILES_STORE], 'readwrite')
    const store = transaction.objectStore(IDB_FILES_STORE)

    const getRequest = store.get(normalized)
    getRequest.onsuccess = () => {
      const existing = getRequest.result as StoredFile | undefined
      const file: StoredFile = {
        path: normalized,
        content,
        isBinary: true,
        size: content.length,
        mtime: now,
        ctime: existing?.ctime ?? now
      }

      const putRequest = store.put(file)
      putRequest.onsuccess = () => resolve()
      putRequest.onerror = () => reject(putRequest.error)
    }
    getRequest.onerror = () => reject(getRequest.error)
  })
}

/**
 * Check if a file exists in IndexedDB
 */
export async function existsIDB(path: string): Promise<boolean> {
  try {
    const db = await getIDB()
    const normalized = normalizeIDBPath(path)

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE], 'readonly')
      const store = transaction.objectStore(IDB_FILES_STORE)
      const request = store.get(normalized)

      request.onsuccess = () => resolve(!!request.result)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return false
  }
}

/**
 * Read multiple files from IndexedDB in a single transaction
 */
export async function readBinaryBatchIDB(paths: string[]): Promise<Map<string, Uint8Array>> {
  const results = new Map<string, Uint8Array>()

  try {
    const db = await getIDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE], 'readonly')
      const store = transaction.objectStore(IDB_FILES_STORE)
      let pending = paths.length

      if (pending === 0) {
        resolve(results)
        return
      }

      for (const path of paths) {
        const normalized = normalizeIDBPath(path)
        const request = store.get(normalized)

        request.onsuccess = () => {
          const file = request.result as StoredFile | undefined
          if (file) {
            if (file.isBinary) {
              results.set(path, file.content as Uint8Array)
            } else {
              const encoder = new TextEncoder()
              results.set(path, encoder.encode(file.content as string))
            }
          }
          pending--
          if (pending === 0) resolve(results)
        }

        request.onerror = () => {
          pending--
          if (pending === 0) resolve(results)
        }
      }

      transaction.onerror = () => reject(transaction.error)
    })
  } catch {
    return results
  }
}

// ============================================================================
// OPFS helpers
// ============================================================================

let opfsRootPromise: Promise<FileSystemDirectoryHandle> | null = null

function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  if (opfsRootPromise) return opfsRootPromise
  opfsRootPromise = navigator.storage.getDirectory()
  return opfsRootPromise
}

function normalizeOPFSPath(path: string): string {
  let normalized = path
  if (normalized.startsWith('/')) {
    normalized = normalized.slice(1)
  }
  if (normalized.endsWith('/') && normalized.length > 0) {
    normalized = normalized.slice(0, -1)
  }
  return normalized.replace(/\/+/g, '/')
}

function getOPFSPathParts(path: string): string[] {
  const normalized = normalizeOPFSPath(path)
  if (!normalized) return []
  return normalized.split('/')
}

async function getOPFSParentAndName(
  path: string
): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
  const parts = getOPFSPathParts(path)
  if (parts.length === 0) {
    throw new Error('Invalid path: root has no parent')
  }

  const name = parts.pop()!
  const root = await getOPFSRoot()

  let parent = root
  for (const part of parts) {
    parent = await parent.getDirectoryHandle(part)
  }

  return { parent, name }
}

/**
 * Read binary data from OPFS
 */
export async function readBinaryOPFS(path: string): Promise<Uint8Array | null> {
  try {
    const { parent, name } = await getOPFSParentAndName(path)
    const fileHandle = await parent.getFileHandle(name)
    const file = await fileHandle.getFile()
    const buffer = await file.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

/**
 * Write binary data to OPFS
 */
export async function writeBinaryOPFS(path: string, content: Uint8Array): Promise<void> {
  const parts = getOPFSPathParts(path)
  if (parts.length === 0) {
    throw new Error('Cannot write to root')
  }

  const name = parts.pop()!
  const root = await getOPFSRoot()

  // Create parent directories
  let parent = root
  for (const part of parts) {
    parent = await parent.getDirectoryHandle(part, { create: true })
  }

  const fileHandle = await parent.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

/**
 * Check if a file exists in OPFS
 */
export async function existsOPFS(path: string): Promise<boolean> {
  try {
    const { parent, name } = await getOPFSParentAndName(path)
    try {
      await parent.getFileHandle(name)
      return true
    } catch {
      try {
        await parent.getDirectoryHandle(name)
        return true
      } catch {
        return false
      }
    }
  } catch {
    return false
  }
}

/**
 * Read multiple files from OPFS in parallel
 */
export async function readBinaryBatchOPFS(paths: string[]): Promise<Map<string, Uint8Array>> {
  const results = new Map<string, Uint8Array>()

  const readPromises = paths.map(async (path) => {
    const data = await readBinaryOPFS(path)
    if (data) {
      results.set(path, data)
    }
  })

  await Promise.all(readPromises)
  return results
}

/**
 * Check if OPFS is available
 */
export function isOPFSAvailable(): boolean {
  return typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    'getDirectory' in navigator.storage
}

// ============================================================================
// Auto-select helpers (try OPFS first, fall back to IDB)
// ============================================================================

/**
 * Read binary data, trying OPFS first then IndexedDB
 */
export async function readBinary(path: string): Promise<Uint8Array | null> {
  if (isOPFSAvailable()) {
    const data = await readBinaryOPFS(path)
    if (data) return data
  }
  return readBinaryIDB(path)
}

/**
 * Write binary data, trying OPFS first then IndexedDB
 */
export async function writeBinary(path: string, content: Uint8Array): Promise<void> {
  if (isOPFSAvailable()) {
    try {
      await writeBinaryOPFS(path, content)
      return
    } catch {
      // Fall back to IDB
    }
  }
  await writeBinaryIDB(path, content)
}

/**
 * Check if file exists, trying OPFS first then IndexedDB
 */
export async function exists(path: string): Promise<boolean> {
  if (isOPFSAvailable()) {
    if (await existsOPFS(path)) return true
  }
  return existsIDB(path)
}

// Export constants
export { IDB_NAME, IDB_VERSION, IDB_FILES_STORE }

// For IIFE build, expose globally
if (typeof self !== 'undefined') {
  (self as any).siglumFS = {
    // Constants
    IDB_NAME,
    IDB_VERSION,
    IDB_FILES_STORE,

    // Auto-select
    readBinary,
    writeBinary,
    exists,
    isOPFSAvailable,

    // OPFS direct
    readBinaryOPFS,
    writeBinaryOPFS,
    existsOPFS,
    readBinaryBatchOPFS,

    // IndexedDB direct
    readBinaryIDB,
    writeBinaryIDB,
    existsIDB,
    readBinaryBatchIDB,
  }
}
