/**
 * OPFS (Origin Private File System) Backend
 *
 * Native browser filesystem with:
 * - Fast file I/O (designed for large files)
 * - Streaming support
 * - Persistent storage
 * - Direct file handles (no serialization overhead)
 *
 * Used for:
 * - Document storage (/documents)
 * - WASM compiler binaries (/compiler)
 * - Compilation output (/output)
 * - Git repositories (/git)
 */
import type { FileSystemBackend, FileStats, FileEntry } from './types';
export declare class OPFSBackend implements FileSystemBackend {
    readonly name = "opfs";
    private rootPromise;
    private getRoot;
    private normalizePath;
    private getPathParts;
    private getDirectoryHandle;
    private getParentAndName;
    readFile(path: string): Promise<string>;
    readBinary(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string): Promise<void>;
    writeBinary(path: string, content: Uint8Array): Promise<void>;
    deleteFile(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FileStats>;
    mkdir(path: string): Promise<void>;
    rmdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    readdir(path: string): Promise<FileEntry[]>;
    rename(oldPath: string, newPath: string): Promise<void>;
    copyFile(src: string, dest: string): Promise<void>;
    /**
     * Get a file handle for direct access (useful for WASM)
     * This allows the WASM compiler to read files directly
     */
    getFileHandle(path: string): Promise<FileSystemFileHandle>;
    /**
     * Get a directory handle for direct access
     */
    getDirectoryHandleForPath(path: string): Promise<FileSystemDirectoryHandle>;
}
export declare const opfsBackend: OPFSBackend;
//# sourceMappingURL=OPFSBackend.d.ts.map