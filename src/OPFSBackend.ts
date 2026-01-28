/**
 * OPFS (Origin Private File System) Backend
 *
 * Native browser filesystem with:
 * - Fast file I/O (optimized for large files)
 * - Streaming support via createWritable()
 * - Persistent storage
 * - No serialization overhead
 */

import type { FileSystemBackend, FileStats, FileEntry } from './types'

export class OPFSBackend implements FileSystemBackend {
  readonly name = 'opfs'
  private rootPromise: Promise<FileSystemDirectoryHandle> | null = null

  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.rootPromise) {
      this.rootPromise = navigator.storage.getDirectory()
    }
    return this.rootPromise
  }

  private normalizePath(path: string): string {
    // Remove leading slash for OPFS (it uses relative paths from root)
    let normalized = path
    if (normalized.startsWith('/')) {
      normalized = normalized.slice(1)
    }
    // Remove trailing slash
    if (normalized.endsWith('/') && normalized.length > 0) {
      normalized = normalized.slice(0, -1)
    }
    // Normalize multiple slashes
    normalized = normalized.replace(/\/+/g, '/')
    return normalized
  }

  private getPathParts(path: string): string[] {
    const normalized = this.normalizePath(path)
    if (!normalized) return []
    return normalized.split('/')
  }

  private async getDirectoryHandle(
    path: string,
    options: { create?: boolean } = {}
  ): Promise<FileSystemDirectoryHandle> {
    const root = await this.getRoot()
    const parts = this.getPathParts(path)

    let current = root
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: options.create })
    }
    return current
  }

  private async getParentAndName(
    path: string,
    options: { createParents?: boolean } = {}
  ): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
    const parts = this.getPathParts(path)
    if (parts.length === 0) {
      throw new Error('Invalid path: root has no parent')
    }

    const name = parts.pop()!
    const root = await this.getRoot()

    let parent = root
    for (const part of parts) {
      parent = await parent.getDirectoryHandle(part, { create: options.createParents })
    }

    return { parent, name }
  }

  async readFile(path: string): Promise<string> {
    const { parent, name } = await this.getParentAndName(path)
    const fileHandle = await parent.getFileHandle(name)
    const file = await fileHandle.getFile()
    return file.text()
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const { parent, name } = await this.getParentAndName(path)
    const fileHandle = await parent.getFileHandle(name)
    const file = await fileHandle.getFile()
    const buffer = await file.arrayBuffer()
    return new Uint8Array(buffer)
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { parent, name } = await this.getParentAndName(path, { createParents: true })
    const fileHandle = await parent.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()
  }

  async writeBinary(path: string, content: Uint8Array): Promise<void> {
    const { parent, name } = await this.getParentAndName(path, { createParents: true })
    const fileHandle = await parent.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()
  }

  async deleteFile(path: string): Promise<void> {
    const { parent, name } = await this.getParentAndName(path)
    await parent.removeEntry(name)
  }

  async exists(path: string): Promise<boolean> {
    try {
      const parts = this.getPathParts(path)
      if (parts.length === 0) {
        // Root always exists
        return true
      }

      const { parent, name } = await this.getParentAndName(path)

      // Try as file first
      try {
        await parent.getFileHandle(name)
        return true
      } catch {
        // Not a file, try as directory
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

  async stat(path: string): Promise<FileStats> {
    const parts = this.getPathParts(path)

    if (parts.length === 0) {
      // Root directory
      return {
        size: 0,
        isDirectory: true,
        isFile: false,
        mtime: new Date(0)
      }
    }

    const { parent, name } = await this.getParentAndName(path)

    // Try as file first
    try {
      const fileHandle = await parent.getFileHandle(name)
      const file = await fileHandle.getFile()
      return {
        size: file.size,
        isDirectory: false,
        isFile: true,
        mtime: new Date(file.lastModified)
      }
    } catch {
      // Try as directory
      try {
        await parent.getDirectoryHandle(name)
        return {
          size: 0,
          isDirectory: true,
          isFile: false,
          mtime: new Date(0) // OPFS doesn't track directory mtime
        }
      } catch {
        throw new Error(`ENOENT: no such file or directory: ${path}`)
      }
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.getDirectoryHandle(path, { create: true })
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const parts = this.getPathParts(path)
    if (parts.length === 0) {
      throw new Error('Cannot remove root directory')
    }

    const { parent, name } = await this.getParentAndName(path)
    await parent.removeEntry(name, { recursive: options?.recursive })
  }

  async readdir(path: string): Promise<FileEntry[]> {
    const dir = this.getPathParts(path).length === 0
      ? await this.getRoot()
      : await this.getDirectoryHandle(path)

    const entries: FileEntry[] = []
    const prefix = this.normalizePath(path)
    const pathPrefix = prefix ? '/' + prefix + '/' : '/'

    // Use values() iterator which has better TypeScript support
    // Cast to async iterable since TS types may be incomplete
    const dirAsIterable = dir as unknown as AsyncIterable<[string, FileSystemHandle]>
    for await (const [name, handle] of dirAsIterable) {
      entries.push({
        name,
        path: pathPrefix + name,
        isDirectory: handle.kind === 'directory'
      })
    }

    return entries.sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    // OPFS doesn't have native rename, so copy + delete
    const content = await this.readBinary(oldPath)
    await this.writeBinary(newPath, content)
    await this.deleteFile(oldPath)
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const content = await this.readBinary(src)
    await this.writeBinary(dest, content)
  }

  /**
   * Get a file handle for direct access (useful for WASM)
   * This allows the WASM compiler to read files directly
   */
  async getFileHandle(path: string): Promise<FileSystemFileHandle> {
    const { parent, name } = await this.getParentAndName(path)
    return parent.getFileHandle(name)
  }

  /**
   * Get a directory handle for direct access
   */
  async getDirectoryHandleForPath(path: string): Promise<FileSystemDirectoryHandle> {
    const parts = this.getPathParts(path)
    if (parts.length === 0) {
      return this.getRoot()
    }
    return this.getDirectoryHandle(path)
  }

  /**
   * Read multiple files in parallel (more efficient for batch reads)
   */
  async readBinaryBatch(paths: string[]): Promise<Map<string, Uint8Array>> {
    const results = new Map<string, Uint8Array>()

    // Read all files in parallel
    const readPromises = paths.map(async (path) => {
      try {
        const data = await this.readBinary(path)
        return { path, data }
      } catch {
        return { path, data: null }
      }
    })

    const outcomes = await Promise.all(readPromises)
    for (const { path, data } of outcomes) {
      if (data) {
        results.set(path, data)
      }
    }

    return results
  }
}

export const opfsBackend = new OPFSBackend()
