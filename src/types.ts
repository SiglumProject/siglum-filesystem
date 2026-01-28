/**
 * FileSystem abstraction types
 *
 * Provides a unified interface for file operations across different backends:
 * - OPFS (Origin Private File System) - primary, fast storage
 * - IndexedDB - fallback for browsers without OPFS support
 */

export interface FileStats {
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: Date
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
}

/**
 * Abstract filesystem backend interface
 * Implementations handle the actual storage mechanism
 */
export interface FileSystemBackend {
  /** Unique identifier for this backend */
  readonly name: string

  /** Read file contents as string */
  readFile(path: string): Promise<string>

  /** Read file contents as binary */
  readBinary(path: string): Promise<Uint8Array>

  /** Write string content to file */
  writeFile(path: string, content: string): Promise<void>

  /** Write binary content to file */
  writeBinary(path: string, content: Uint8Array): Promise<void>

  /** Delete a file */
  deleteFile(path: string): Promise<void>

  /** Check if path exists */
  exists(path: string): Promise<boolean>

  /** Get file/directory stats */
  stat(path: string): Promise<FileStats>

  /** Create directory (and parents if needed) */
  mkdir(path: string): Promise<void>

  /** Remove directory */
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>

  /** List directory contents */
  readdir(path: string): Promise<FileEntry[]>

  /** Rename/move a file or directory */
  rename(oldPath: string, newPath: string): Promise<void>

  /** Copy a file */
  copyFile(src: string, dest: string): Promise<void>
}

/**
 * Events emitted by FileSystemService
 */
export type FileSystemEvent =
  | { type: 'file:created'; path: string }
  | { type: 'file:modified'; path: string }
  | { type: 'file:deleted'; path: string }
  | { type: 'directory:created'; path: string }
  | { type: 'directory:deleted'; path: string }

export type FileSystemEventHandler = (event: FileSystemEvent) => void

/**
 * Options for FileSystemService operations
 */
export interface WriteOptions {
  /** Create parent directories if they don't exist */
  createParents?: boolean
  /** Skip emitting change event */
  silent?: boolean
}
