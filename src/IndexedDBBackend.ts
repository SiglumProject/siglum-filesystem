/**
 * IndexedDB-backed filesystem
 *
 * Fallback backend for browsers without OPFS support.
 * Stores files and directories in IndexedDB object stores.
 */

import type { FileSystemBackend, FileStats, FileEntry, WriteBinaryBatchEntry, WriteBinaryBatchOptions } from './types.js'
import { IDB_NAME, IDB_VERSION, IDB_FILES_STORE, IDB_DIRS_STORE } from './constants.js'

interface StoredFile {
  path: string
  content: string | Uint8Array
  isBinary: boolean
  size: number
  mtime: number
  ctime: number
}

interface StoredDirectory {
  path: string
  ctime: number
}

export class IndexedDBBackend implements FileSystemBackend {
  readonly name = 'indexeddb'
  private dbPromise: Promise<IDBDatabase>

  constructor() {
    this.dbPromise = this.initDB()
  }

  private async initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Files store - keyed by path
        if (!db.objectStoreNames.contains(IDB_FILES_STORE)) {
          const filesStore = db.createObjectStore(IDB_FILES_STORE, { keyPath: 'path' })
          filesStore.createIndex('mtime', 'mtime', { unique: false })
        }

        // Directories store - keyed by path
        if (!db.objectStoreNames.contains(IDB_DIRS_STORE)) {
          db.createObjectStore(IDB_DIRS_STORE, { keyPath: 'path' })
        }
      }
    })
  }

  private normalizePath(path: string): string {
    // Ensure path starts with /
    if (!path.startsWith('/')) {
      path = '/' + path
    }
    // Remove trailing slash unless it's root
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1)
    }
    // Normalize multiple slashes
    return path.replace(/\/+/g, '/')
  }

  private getParentPath(path: string): string {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) return '/'
    return normalized.slice(0, lastSlash)
  }

  async readFile(path: string): Promise<string> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE], 'readonly')
      const store = transaction.objectStore(IDB_FILES_STORE)
      const request = store.get(normalized)

      request.onsuccess = () => {
        const file = request.result as StoredFile | undefined
        if (!file) {
          reject(new Error(`ENOENT: no such file: ${path}`))
          return
        }
        if (file.isBinary) {
          // Convert Uint8Array to string
          const decoder = new TextDecoder()
          resolve(decoder.decode(file.content as Uint8Array))
        } else {
          resolve(file.content as string)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE], 'readonly')
      const store = transaction.objectStore(IDB_FILES_STORE)
      const request = store.get(normalized)

      request.onsuccess = () => {
        const file = request.result as StoredFile | undefined
        if (!file) {
          reject(new Error(`ENOENT: no such file: ${path}`))
          return
        }
        if (file.isBinary) {
          resolve(file.content as Uint8Array)
        } else {
          // Convert string to Uint8Array
          const encoder = new TextEncoder()
          resolve(encoder.encode(file.content as string))
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  async writeFile(path: string, content: string): Promise<void> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)
    const now = Date.now()

    // Ensure parent directory exists
    const parentPath = this.getParentPath(normalized)
    if (parentPath !== '/') {
      const parentExists = await this.exists(parentPath)
      if (!parentExists) {
        await this.mkdir(parentPath)
      }
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE], 'readwrite')
      const store = transaction.objectStore(IDB_FILES_STORE)

      // Check if file exists to preserve ctime
      const getRequest = store.get(normalized)
      getRequest.onsuccess = () => {
        const existing = getRequest.result as StoredFile | undefined
        const file: StoredFile = {
          path: normalized,
          content,
          isBinary: false,
          size: new Blob([content]).size,
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

  async writeBinary(path: string, content: Uint8Array): Promise<void> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)
    const now = Date.now()

    // Ensure parent directory exists
    const parentPath = this.getParentPath(normalized)
    if (parentPath !== '/') {
      const parentExists = await this.exists(parentPath)
      if (!parentExists) {
        await this.mkdir(parentPath)
      }
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE], 'readwrite')
      const store = transaction.objectStore(IDB_FILES_STORE)

      // Check if file exists to preserve ctime
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

  async deleteFile(path: string): Promise<void> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE], 'readwrite')
      const store = transaction.objectStore(IDB_FILES_STORE)
      const request = store.delete(normalized)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async exists(path: string): Promise<boolean> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)

    // Check both stores in a single transaction
    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE, IDB_DIRS_STORE], 'readonly')
      const filesStore = transaction.objectStore(IDB_FILES_STORE)
      const dirsStore = transaction.objectStore(IDB_DIRS_STORE)

      const fileRequest = filesStore.get(normalized)
      fileRequest.onsuccess = () => {
        if (fileRequest.result) {
          resolve(true)
          return
        }
        // Not a file, check directories
        const dirRequest = dirsStore.get(normalized)
        dirRequest.onsuccess = () => resolve(!!dirRequest.result)
        dirRequest.onerror = () => reject(dirRequest.error)
      }
      fileRequest.onerror = () => reject(fileRequest.error)
    })
  }

  async stat(path: string): Promise<FileStats> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)

    // Check both stores in a single transaction
    return new Promise<FileStats>((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE, IDB_DIRS_STORE], 'readonly')
      const filesStore = transaction.objectStore(IDB_FILES_STORE)
      const dirsStore = transaction.objectStore(IDB_DIRS_STORE)

      const fileRequest = filesStore.get(normalized)
      fileRequest.onsuccess = () => {
        const file = fileRequest.result as StoredFile | undefined
        if (file) {
          resolve({
            size: file.size,
            isDirectory: false,
            isFile: true,
            mtime: new Date(file.mtime)
          })
          return
        }

        // Not a file, check directories
        const dirRequest = dirsStore.get(normalized)
        dirRequest.onsuccess = () => {
          const dir = dirRequest.result as StoredDirectory | undefined
          if (dir) {
            resolve({
              size: 0,
              isDirectory: true,
              isFile: false,
              mtime: new Date(dir.ctime)
            })
          } else {
            reject(new Error(`ENOENT: no such file or directory: ${path}`))
          }
        }
        dirRequest.onerror = () => reject(dirRequest.error)
      }
      fileRequest.onerror = () => reject(fileRequest.error)
    })
  }

  async mkdir(path: string): Promise<void> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)

    // Build all paths that need to exist
    const parts = normalized.split('/').filter(Boolean)
    const pathsToCreate: string[] = []
    let currentPath = ''
    for (const part of parts) {
      currentPath += '/' + part
      pathsToCreate.push(currentPath)
    }

    if (pathsToCreate.length === 0) return

    // Check which paths already exist in a single transaction
    const existingPaths = await new Promise<Set<string>>((resolve) => {
      const existing = new Set<string>()
      const transaction = db.transaction([IDB_DIRS_STORE], 'readonly')
      const store = transaction.objectStore(IDB_DIRS_STORE)
      let pending = pathsToCreate.length

      for (const p of pathsToCreate) {
        const request = store.get(p)
        request.onsuccess = () => {
          if (request.result) existing.add(p)
          pending--
          if (pending === 0) resolve(existing)
        }
        request.onerror = () => {
          pending--
          if (pending === 0) resolve(existing)
        }
      }
    })

    // Create missing directories in a single transaction
    const missingPaths = pathsToCreate.filter(p => !existingPaths.has(p))
    if (missingPaths.length === 0) return

    const now = Date.now()
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([IDB_DIRS_STORE], 'readwrite')
      const store = transaction.objectStore(IDB_DIRS_STORE)
      let pending = missingPaths.length

      for (const p of missingPaths) {
        const dir: StoredDirectory = { path: p, ctime: now }
        const request = store.put(dir)
        request.onsuccess = () => {
          pending--
          if (pending === 0) resolve()
        }
        request.onerror = () => reject(request.error)
      }

      transaction.onerror = () => reject(transaction.error)
    })
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)

    if (options?.recursive) {
      // Delete all files and subdirectories under this path
      const entries = await this.readdir(normalized)
      for (const entry of entries) {
        if (entry.isDirectory) {
          await this.rmdir(entry.path, { recursive: true })
        } else {
          await this.deleteFile(entry.path)
        }
      }
    }

    // Delete the directory itself
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_DIRS_STORE], 'readwrite')
      const store = transaction.objectStore(IDB_DIRS_STORE)
      const request = store.delete(normalized)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async readdir(path: string): Promise<FileEntry[]> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)
    const prefix = normalized === '/' ? '/' : normalized + '/'

    // Use IDBKeyRange to only scan entries with matching prefix
    // Keys starting with prefix up to prefix + '\uffff' (highest unicode char)
    const keyRange = IDBKeyRange.bound(prefix, prefix + '\uffff', false, true)

    const entries: FileEntry[] = []
    const seenNames = new Set<string>()

    // Get files and directories in a single transaction
    return new Promise<FileEntry[]>((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE, IDB_DIRS_STORE], 'readonly')

      // Get files in this directory
      const filesStore = transaction.objectStore(IDB_FILES_STORE)
      const filesRequest = filesStore.openCursor(keyRange)

      filesRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const file = cursor.value as StoredFile
          // Get the immediate child name
          const relativePath = file.path.slice(prefix.length)
          const slashIndex = relativePath.indexOf('/')
          const name = slashIndex === -1 ? relativePath : relativePath.slice(0, slashIndex)

          if (name && !seenNames.has(name) && slashIndex === -1) {
            // Direct child file
            seenNames.add(name)
            entries.push({
              name,
              path: file.path,
              isDirectory: false
            })
          }
          cursor.continue()
        } else {
          // Files done, now get directories
          const dirsStore = transaction.objectStore(IDB_DIRS_STORE)
          const dirsRequest = dirsStore.openCursor(keyRange)

          dirsRequest.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result
            if (cursor) {
              const dir = cursor.value as StoredDirectory
              if (dir.path !== normalized) {
                const relativePath = dir.path.slice(prefix.length)
                const slashIndex = relativePath.indexOf('/')
                const name = slashIndex === -1 ? relativePath : relativePath.slice(0, slashIndex)

                if (name && !seenNames.has(name)) {
                  seenNames.add(name)
                  entries.push({
                    name,
                    path: prefix + name,
                    isDirectory: true
                  })
                }
              }
              cursor.continue()
            } else {
              // Sort and return
              entries.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                  return a.isDirectory ? -1 : 1
                }
                return a.name.localeCompare(b.name)
              })
              resolve(entries)
            }
          }
          dirsRequest.onerror = () => reject(dirsRequest.error)
        }
      }
      filesRequest.onerror = () => reject(filesRequest.error)
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = await this.readBinary(oldPath)
    const stats = await this.stat(oldPath)

    if (stats.isDirectory) {
      throw new Error('Cannot rename directories with rename(), use recursive copy')
    }

    await this.writeBinary(newPath, content)
    await this.deleteFile(oldPath)
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const content = await this.readBinary(src)
    await this.writeBinary(dest, content)
  }

  /**
   * Read multiple files in a single transaction (more efficient for batch reads)
   */
  async readBinaryBatch(paths: string[]): Promise<Map<string, Uint8Array>> {
    const db = await this.dbPromise
    const results = new Map<string, Uint8Array>()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_FILES_STORE], 'readonly')
      const store = transaction.objectStore(IDB_FILES_STORE)
      let pending = paths.length

      if (pending === 0) {
        resolve(results)
        return
      }

      for (const path of paths) {
        const normalized = this.normalizePath(path)
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
  }

  /**
   * Write multiple files with progress reporting
   * Uses batched transactions for efficiency
   */
  async writeBinaryBatch(
    entries: WriteBinaryBatchEntry[],
    options: WriteBinaryBatchOptions = {}
  ): Promise<void> {
    const { createParents = true, onProgress, concurrency = 20 } = options
    const total = entries.length
    let completed = 0

    if (total === 0) {
      onProgress?.(0, 0)
      return
    }

    // Collect all parent directories that need to be created
    if (createParents) {
      const dirsToCreate = new Set<string>()
      for (const { path } of entries) {
        const normalized = this.normalizePath(path)
        const parts = normalized.split('/').filter(Boolean)
        parts.pop() // Remove filename
        let currentPath = ''
        for (const part of parts) {
          currentPath += '/' + part
          dirsToCreate.add(currentPath)
        }
      }
      // Create all directories at once
      for (const dir of dirsToCreate) {
        await this.mkdir(dir)
      }
    }

    const db = await this.dbPromise
    const now = Date.now()

    // Process in batches to avoid transaction size limits
    for (let i = 0; i < entries.length; i += concurrency) {
      const batch = entries.slice(i, i + concurrency)

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([IDB_FILES_STORE], 'readwrite')
        const store = transaction.objectStore(IDB_FILES_STORE)
        let pending = batch.length

        for (const { path, content } of batch) {
          const normalized = this.normalizePath(path)
          const file: StoredFile = {
            path: normalized,
            content,
            isBinary: true,
            size: content.length,
            mtime: now,
            ctime: now
          }

          const request = store.put(file)
          request.onsuccess = () => {
            completed++
            pending--
            if (pending === 0) resolve()
          }
          request.onerror = () => reject(request.error)
        }

        transaction.onerror = () => reject(transaction.error)
      })

      onProgress?.(completed, total)
    }
  }
}

export const indexedDBBackend = new IndexedDBBackend()
