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
export class OPFSBackend {
    constructor() {
        this.name = 'opfs';
        this.rootPromise = null;
    }
    async getRoot() {
        if (!this.rootPromise) {
            this.rootPromise = navigator.storage.getDirectory();
        }
        return this.rootPromise;
    }
    normalizePath(path) {
        // Remove leading slash for OPFS (it uses relative paths from root)
        let normalized = path;
        if (normalized.startsWith('/')) {
            normalized = normalized.slice(1);
        }
        // Remove trailing slash
        if (normalized.endsWith('/') && normalized.length > 0) {
            normalized = normalized.slice(0, -1);
        }
        // Normalize multiple slashes
        normalized = normalized.replace(/\/+/g, '/');
        return normalized;
    }
    getPathParts(path) {
        const normalized = this.normalizePath(path);
        if (!normalized)
            return [];
        return normalized.split('/');
    }
    async getDirectoryHandle(path, options = {}) {
        const root = await this.getRoot();
        const parts = this.getPathParts(path);
        let current = root;
        for (const part of parts) {
            current = await current.getDirectoryHandle(part, { create: options.create });
        }
        return current;
    }
    async getParentAndName(path, options = {}) {
        const parts = this.getPathParts(path);
        if (parts.length === 0) {
            throw new Error('Invalid path: root has no parent');
        }
        const name = parts.pop();
        const root = await this.getRoot();
        let parent = root;
        for (const part of parts) {
            parent = await parent.getDirectoryHandle(part, { create: options.createParents });
        }
        return { parent, name };
    }
    async readFile(path) {
        const { parent, name } = await this.getParentAndName(path);
        const fileHandle = await parent.getFileHandle(name);
        const file = await fileHandle.getFile();
        return file.text();
    }
    async readBinary(path) {
        const { parent, name } = await this.getParentAndName(path);
        const fileHandle = await parent.getFileHandle(name);
        const file = await fileHandle.getFile();
        const buffer = await file.arrayBuffer();
        return new Uint8Array(buffer);
    }
    async writeFile(path, content) {
        const { parent, name } = await this.getParentAndName(path, { createParents: true });
        const fileHandle = await parent.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    }
    async writeBinary(path, content) {
        const { parent, name } = await this.getParentAndName(path, { createParents: true });
        const fileHandle = await parent.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    }
    async deleteFile(path) {
        const { parent, name } = await this.getParentAndName(path);
        await parent.removeEntry(name);
    }
    async exists(path) {
        try {
            const parts = this.getPathParts(path);
            if (parts.length === 0) {
                // Root always exists
                return true;
            }
            const { parent, name } = await this.getParentAndName(path);
            // Try as file first
            try {
                await parent.getFileHandle(name);
                return true;
            }
            catch {
                // Not a file, try as directory
                try {
                    await parent.getDirectoryHandle(name);
                    return true;
                }
                catch {
                    return false;
                }
            }
        }
        catch {
            return false;
        }
    }
    async stat(path) {
        const parts = this.getPathParts(path);
        if (parts.length === 0) {
            // Root directory
            return {
                size: 0,
                isDirectory: true,
                isFile: false,
                mtime: new Date(0)
            };
        }
        const { parent, name } = await this.getParentAndName(path);
        // Try as file first
        try {
            const fileHandle = await parent.getFileHandle(name);
            const file = await fileHandle.getFile();
            return {
                size: file.size,
                isDirectory: false,
                isFile: true,
                mtime: new Date(file.lastModified)
            };
        }
        catch {
            // Try as directory
            try {
                await parent.getDirectoryHandle(name);
                return {
                    size: 0,
                    isDirectory: true,
                    isFile: false,
                    mtime: new Date(0) // OPFS doesn't track directory mtime
                };
            }
            catch {
                throw new Error(`ENOENT: no such file or directory: ${path}`);
            }
        }
    }
    async mkdir(path) {
        await this.getDirectoryHandle(path, { create: true });
    }
    async rmdir(path, options) {
        const parts = this.getPathParts(path);
        if (parts.length === 0) {
            throw new Error('Cannot remove root directory');
        }
        const { parent, name } = await this.getParentAndName(path);
        await parent.removeEntry(name, { recursive: options?.recursive });
    }
    async readdir(path) {
        const dir = this.getPathParts(path).length === 0
            ? await this.getRoot()
            : await this.getDirectoryHandle(path);
        const entries = [];
        const prefix = this.normalizePath(path);
        const pathPrefix = prefix ? '/' + prefix + '/' : '/';
        // Use values() iterator which has better TypeScript support
        // Cast to async iterable since TS types may be incomplete
        const dirAsIterable = dir;
        for await (const [name, handle] of dirAsIterable) {
            entries.push({
                name,
                path: pathPrefix + name,
                isDirectory: handle.kind === 'directory'
            });
        }
        return entries.sort((a, b) => {
            // Directories first, then alphabetical
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }
    async rename(oldPath, newPath) {
        // OPFS doesn't have native rename, so copy + delete
        const content = await this.readBinary(oldPath);
        await this.writeBinary(newPath, content);
        await this.deleteFile(oldPath);
    }
    async copyFile(src, dest) {
        const content = await this.readBinary(src);
        await this.writeBinary(dest, content);
    }
    /**
     * Get a file handle for direct access (useful for WASM)
     * This allows the WASM compiler to read files directly
     */
    async getFileHandle(path) {
        const { parent, name } = await this.getParentAndName(path);
        return parent.getFileHandle(name);
    }
    /**
     * Get a directory handle for direct access
     */
    async getDirectoryHandleForPath(path) {
        const parts = this.getPathParts(path);
        if (parts.length === 0) {
            return this.getRoot();
        }
        return this.getDirectoryHandle(path);
    }
}
export const opfsBackend = new OPFSBackend();
//# sourceMappingURL=OPFSBackend.js.map