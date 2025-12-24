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
import type { FileSystemBackend, FileStats, FileEntry, FileSystemEventHandler, WriteOptions } from './types';
export type BackendPreference = 'opfs' | 'indexeddb' | 'auto';
export interface MountOptions {
    /** Which backend to use: 'opfs', 'indexeddb', or 'auto' (default: 'auto') */
    backend?: BackendPreference;
}
/**
 * Check if OPFS is available in the current browser
 */
export declare function isOPFSAvailable(): boolean;
/**
 * Get the best available backend based on browser support
 */
export declare function getBestBackend(): Promise<FileSystemBackend>;
/**
 * Get a specific backend by name
 */
export declare function getBackend(preference: BackendPreference): Promise<FileSystemBackend>;
export declare class FileSystemService {
    private mounts;
    private eventHandlers;
    /**
     * Mount a backend at a specific path
     * More specific paths take precedence
     */
    mount(path: string, backend: FileSystemBackend): void;
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
    mountAuto(path: string, options?: MountOptions): Promise<FileSystemBackend>;
    /**
     * Unmount a backend at a specific path
     */
    unmount(path: string): void;
    /**
     * Get the backend for a given path
     */
    private getBackendForPath;
    private normalizePath;
    private normalizeMountPath;
    /**
     * Subscribe to filesystem events
     */
    subscribe(handler: FileSystemEventHandler): () => void;
    private emit;
    readFile(path: string): Promise<string>;
    readBinary(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string, options?: WriteOptions): Promise<void>;
    writeBinary(path: string, content: Uint8Array, options?: WriteOptions): Promise<void>;
    deleteFile(path: string, options?: {
        silent?: boolean;
    }): Promise<void>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FileStats>;
    mkdir(path: string, options?: {
        silent?: boolean;
    }): Promise<void>;
    rmdir(path: string, options?: {
        recursive?: boolean;
        silent?: boolean;
    }): Promise<void>;
    readdir(path: string): Promise<FileEntry[]>;
    rename(oldPath: string, newPath: string): Promise<void>;
    copyFile(src: string, dest: string): Promise<void>;
    private getParentPath;
    /**
     * Get information about mounted filesystems
     */
    getMounts(): Array<{
        path: string;
        backend: string;
    }>;
    /**
     * Check if a path has a mounted backend
     */
    isMounted(path: string): boolean;
}
export declare const fileSystem: FileSystemService;
//# sourceMappingURL=FileSystemService.d.ts.map