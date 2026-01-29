/**
 * @siglum/filesystem
 *
 * Unified filesystem abstraction for browser storage.
 *
 * Provides a single interface for file operations across different backends:
 * - OPFS (Origin Private File System) - primary storage, fast and persistent
 * - IndexedDB (fallback for browsers without OPFS)
 *
 * ## Auto-mounting with fallback
 *
 * ```typescript
 * import { fileSystem } from '@siglum/filesystem'
 *
 * // Auto-select best backend (OPFS if available, else IndexedDB)
 * await fileSystem.mountAuto('/documents')
 *
 * // Use the filesystem
 * await fileSystem.writeFile('/documents/main.tex', content)
 * ```
 *
 * ## Manual backend selection
 *
 * ```typescript
 * import { fileSystem, opfsBackend, indexedDBBackend } from '@siglum/filesystem'
 *
 * // Explicitly use OPFS
 * fileSystem.mount('/documents', opfsBackend)
 *
 * // Or force a specific backend with mountAuto
 * await fileSystem.mountAuto('/documents', { backend: 'opfs' })
 * await fileSystem.mountAuto('/legacy', { backend: 'indexeddb' })
 * ```
 *
 * ## Check OPFS availability
 *
 * ```typescript
 * import { isOPFSAvailable } from '@siglum/filesystem'
 *
 * if (isOPFSAvailable()) {
 *   console.log('OPFS is supported!')
 * }
 * ```
 *
 * For git operations with isomorphic-git, use @siglum/git instead:
 * ```typescript
 * import { createOPFSGitAdapter } from '@siglum/git'
 * ```
 */

// Types
export type {
  FileStats,
  FileEntry,
  FileSystemBackend,
  FileSystemEvent,
  FileSystemEventHandler,
  WriteOptions,
  WriteBinaryBatchEntry,
  WriteBinaryBatchOptions
} from './types.js'

export type { BackendPreference, MountOptions } from './FileSystemService.js'

// Service and helpers
export {
  fileSystem,
  FileSystemService,
  isOPFSAvailable,
  getBestBackend,
  getBackend
} from './FileSystemService.js'

// Backends
export { OPFSBackend, opfsBackend } from './OPFSBackend.js'
export { IndexedDBBackend, indexedDBBackend } from './IndexedDBBackend.js'

// Storage constants (for direct access in workers)
export {
  IDB_NAME,
  IDB_VERSION,
  IDB_FILES_STORE,
  IDB_DIRS_STORE,
  OPFS_ROOT
} from './constants.js'
