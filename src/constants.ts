/**
 * Shared storage constants
 *
 * These constants define the storage locations used by siglum-filesystem.
 * Export them so consumers can directly access the same storage when needed
 * (e.g., in Web Workers that can't use the full ES module API).
 */

// IndexedDB constants
export const IDB_NAME = 'siglum_filesystem'
export const IDB_VERSION = 1
export const IDB_FILES_STORE = 'files'
export const IDB_DIRS_STORE = 'directories'

// OPFS root path constants
// These are the paths used by siglum-filesystem in OPFS
export const OPFS_ROOT = '' // Empty string = navigator.storage.getDirectory()
