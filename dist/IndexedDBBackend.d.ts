/**
 * IndexedDB-backed filesystem
 *
 * This is a transitional backend that stores files in IndexedDB.
 * It wraps the storage pattern from DocumentStore but exposes a
 * filesystem-like interface.
 *
 * In the future, this will be replaced by OPFSBackend.
 */
import type { FileSystemBackend, FileStats, FileEntry } from './types';
export declare class IndexedDBBackend implements FileSystemBackend {
    readonly name = "indexeddb";
    private dbPromise;
    constructor();
    private initDB;
    private normalizePath;
    private getParentPath;
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
}
export declare const indexedDBBackend: IndexedDBBackend;
//# sourceMappingURL=IndexedDBBackend.d.ts.map