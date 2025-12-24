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

import type {
  FileSystemBackend,
  FileStats,
  FileEntry,
  FileSystemEvent,
  FileSystemEventHandler,
  WriteOptions,
} from './types'

interface MountPoint {
  path: string
  backend: FileSystemBackend
}

export type BackendPreference = 'opfs' | 'indexeddb' | 'auto'

export interface MountOptions {
  /** Which backend to use: 'opfs', 'indexeddb', or 'auto' (default: 'auto') */
  backend?: BackendPreference
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
  try {
    const root = await navigator.storage.getDirectory()
    const testFile = await root.getFileHandle('.opfs-write-test', { create: true })

    // Safari doesn't support createWritable - this is what fails
    if (typeof (testFile as any).createWritable !== 'function') {
      return false
    }

    const writable = await (testFile as any).createWritable()
    await writable.write('test')
    await writable.close()

    // Clean up test file
    await root.removeEntry('.opfs-write-test')
    return true
  } catch {
    return false
  }
}

/**
 * Get the best available backend based on browser support
 */
export async function getBestBackend(): Promise<FileSystemBackend> {
  // Lazy import to avoid circular dependencies
  const { opfsBackend } = await import('./OPFSBackend')
  const { indexedDBBackend } = await import('./IndexedDBBackend')

  if (isOPFSAvailable()) {
    // Verify OPFS actually works including write support
    // Safari has OPFS read support but no createWritable() for writes
    try {
      const writeSupported = await testOPFSWriteSupport()
      if (writeSupported) {
        return opfsBackend
      }
      console.warn('[FileSystem] OPFS available but createWritable not supported, falling back to IndexedDB')
      return indexedDBBackend
    } catch {
      console.warn('[FileSystem] OPFS available but failed, falling back to IndexedDB')
      return indexedDBBackend
    }
  }

  return indexedDBBackend
}

/**
 * Get a specific backend by name
 */
export async function getBackend(preference: BackendPreference): Promise<FileSystemBackend> {
  const { opfsBackend } = await import('./OPFSBackend')
  const { indexedDBBackend } = await import('./IndexedDBBackend')

  switch (preference) {
    case 'opfs':
      if (!isOPFSAvailable()) {
        throw new Error('OPFS is not available in this browser')
      }
      return opfsBackend
    case 'indexeddb':
      return indexedDBBackend
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
    const backend = await getBackend(preference)
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

  async readBinary(path: string): Promise<Uint8Array> {
    const { backend, relativePath } = this.getBackendForPath(path)
    return backend.readBinary(relativePath)
  }

  async writeFile(path: string, content: string, options?: WriteOptions): Promise<void> {
    const { backend, relativePath } = this.getBackendForPath(path)

    if (options?.createParents) {
      const parentPath = this.getParentPath(relativePath)
      if (parentPath !== '/') {
        await backend.mkdir(parentPath)
      }
    }

    const existed = await backend.exists(relativePath)
    await backend.writeFile(relativePath, content)

    if (!options?.silent) {
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

    const existed = await backend.exists(relativePath)
    await backend.writeBinary(relativePath, content)

    if (!options?.silent) {
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
      path: normalizedMountPath === '/'
        ? entry.path
        : normalizedMountPath + entry.path.slice(1)
    }))
  }

  // Utility Operations

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldBackend = this.getBackendForPath(oldPath)
    const newBackend = this.getBackendForPath(newPath)

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
}

// Export singleton instance
export const fileSystem = new FileSystemService()
