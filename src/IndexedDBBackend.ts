/**
 * IndexedDB-backed filesystem
 *
 * This is a transitional backend that stores files in IndexedDB.
 * It wraps the storage pattern from DocumentStore but exposes a
 * filesystem-like interface.
 *
 * In the future, this will be replaced by OPFSBackend.
 */

import type { FileSystemBackend, FileStats, FileEntry } from './types'

const DB_NAME = 'siglum_filesystem'
const DB_VERSION = 1
const FILES_STORE = 'files'
const DIRS_STORE = 'directories'

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
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Files store - keyed by path
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          const filesStore = db.createObjectStore(FILES_STORE, { keyPath: 'path' })
          filesStore.createIndex('mtime', 'mtime', { unique: false })
        }

        // Directories store - keyed by path
        if (!db.objectStoreNames.contains(DIRS_STORE)) {
          db.createObjectStore(DIRS_STORE, { keyPath: 'path' })
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
      const transaction = db.transaction([FILES_STORE], 'readonly')
      const store = transaction.objectStore(FILES_STORE)
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
      const transaction = db.transaction([FILES_STORE], 'readonly')
      const store = transaction.objectStore(FILES_STORE)
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
      const transaction = db.transaction([FILES_STORE], 'readwrite')
      const store = transaction.objectStore(FILES_STORE)

      // Check if file exists to preserve ctime
      const getRequest = store.get(normalized)
      getRequest.onsuccess = () => {
        const existing = getRequest.result as StoredFile | undefined
        const file: StoredFile = {
          path: normalized,
          content,
          isBinary: false,
          size: new TextEncoder().encode(content).length,
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
      const transaction = db.transaction([FILES_STORE], 'readwrite')
      const store = transaction.objectStore(FILES_STORE)

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
      const transaction = db.transaction([FILES_STORE], 'readwrite')
      const store = transaction.objectStore(FILES_STORE)
      const request = store.delete(normalized)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async exists(path: string): Promise<boolean> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)

    // Check files
    const fileExists = await new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([FILES_STORE], 'readonly')
      const store = transaction.objectStore(FILES_STORE)
      const request = store.get(normalized)

      request.onsuccess = () => resolve(!!request.result)
      request.onerror = () => reject(request.error)
    })

    if (fileExists) return true

    // Check directories
    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([DIRS_STORE], 'readonly')
      const store = transaction.objectStore(DIRS_STORE)
      const request = store.get(normalized)

      request.onsuccess = () => resolve(!!request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async stat(path: string): Promise<FileStats> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)

    // Try files first
    const file = await new Promise<StoredFile | undefined>((resolve, reject) => {
      const transaction = db.transaction([FILES_STORE], 'readonly')
      const store = transaction.objectStore(FILES_STORE)
      const request = store.get(normalized)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    if (file) {
      return {
        size: file.size,
        isDirectory: false,
        isFile: true,
        mtime: new Date(file.mtime)
      }
    }

    // Try directories
    const dir = await new Promise<StoredDirectory | undefined>((resolve, reject) => {
      const transaction = db.transaction([DIRS_STORE], 'readonly')
      const store = transaction.objectStore(DIRS_STORE)
      const request = store.get(normalized)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    if (dir) {
      return {
        size: 0,
        isDirectory: true,
        isFile: false,
        mtime: new Date(dir.ctime)
      }
    }

    throw new Error(`ENOENT: no such file or directory: ${path}`)
  }

  async mkdir(path: string): Promise<void> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)

    // Create all parent directories
    const parts = normalized.split('/').filter(Boolean)
    let currentPath = ''

    for (const part of parts) {
      currentPath += '/' + part

      const exists = await new Promise<boolean>((resolve, reject) => {
        const transaction = db.transaction([DIRS_STORE], 'readonly')
        const store = transaction.objectStore(DIRS_STORE)
        const request = store.get(currentPath)

        request.onsuccess = () => resolve(!!request.result)
        request.onerror = () => reject(request.error)
      })

      if (!exists) {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction([DIRS_STORE], 'readwrite')
          const store = transaction.objectStore(DIRS_STORE)
          const dir: StoredDirectory = {
            path: currentPath,
            ctime: Date.now()
          }
          const request = store.put(dir)

          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
      }
    }
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
      const transaction = db.transaction([DIRS_STORE], 'readwrite')
      const store = transaction.objectStore(DIRS_STORE)
      const request = store.delete(normalized)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async readdir(path: string): Promise<FileEntry[]> {
    const db = await this.dbPromise
    const normalized = this.normalizePath(path)
    const prefix = normalized === '/' ? '/' : normalized + '/'

    const entries: FileEntry[] = []
    const seenNames = new Set<string>()

    // Get files in this directory
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([FILES_STORE], 'readonly')
      const store = transaction.objectStore(FILES_STORE)
      const request = store.openCursor()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const file = cursor.value as StoredFile
          if (file.path.startsWith(prefix)) {
            // Get the immediate child name
            const relativePath = file.path.slice(prefix.length)
            const slashIndex = relativePath.indexOf('/')
            const name = slashIndex === -1 ? relativePath : relativePath.slice(0, slashIndex)

            if (name && !seenNames.has(name)) {
              seenNames.add(name)
              if (slashIndex === -1) {
                // Direct child file
                entries.push({
                  name,
                  path: file.path,
                  isDirectory: false
                })
              }
            }
          }
          cursor.continue()
        } else {
          resolve()
        }
      }
      request.onerror = () => reject(request.error)
    })

    // Get subdirectories
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([DIRS_STORE], 'readonly')
      const store = transaction.objectStore(DIRS_STORE)
      const request = store.openCursor()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const dir = cursor.value as StoredDirectory
          if (dir.path.startsWith(prefix) && dir.path !== normalized) {
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
          resolve()
        }
      }
      request.onerror = () => reject(request.error)
    })

    return entries.sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name)
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
}

export const indexedDBBackend = new IndexedDBBackend()
