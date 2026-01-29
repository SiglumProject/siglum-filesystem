# @siglum/filesystem

Unified filesystem abstraction for browser storage with automatic fallback.

## Installation

```bash
npm install @siglum/filesystem
```

## Quick Start

```typescript
import { fileSystem } from '@siglum/filesystem'

// Auto-select best backend (OPFS if available, else IndexedDB)
await fileSystem.mountAuto('/documents')

// Use unified API
await fileSystem.writeFile('/documents/main.tex', '\\documentclass{article}...')
const content = await fileSystem.readFile('/documents/main.tex')
```

## Auto-mounting with Fallback

The `mountAuto` method automatically selects the best available backend:

```typescript
import { fileSystem } from '@siglum/filesystem'

// Uses OPFS if available, falls back to IndexedDB
const backend = await fileSystem.mountAuto('/documents')
console.log(`Using ${backend.name} backend`)  // 'opfs' or 'indexeddb'
```

### Force a Specific Backend

```typescript
// Force OPFS (throws if not available)
await fileSystem.mountAuto('/documents', { backend: 'opfs' })

// Force IndexedDB
await fileSystem.mountAuto('/legacy', { backend: 'indexeddb' })

// Explicit auto (same as default)
await fileSystem.mountAuto('/data', { backend: 'auto' })
```

### Check OPFS Availability

```typescript
import { isOPFSAvailable } from '@siglum/filesystem'

if (isOPFSAvailable()) {
  console.log('OPFS is supported!')
}
```

### Check Backend Type

```typescript
// Get the backend type for a mounted path
const type = fileSystem.getBackendType('/documents')  // 'opfs', 'indexeddb', or null
```

## Manual Backend Selection

For direct control, import and mount backends explicitly:

```typescript
import { fileSystem, opfsBackend, indexedDBBackend } from '@siglum/filesystem'

fileSystem.mount('/documents', opfsBackend)
fileSystem.mount('/legacy', indexedDBBackend)
```

## Batch Operations

For reading multiple files efficiently:

```typescript
const paths = ['/documents/a.txt', '/documents/b.txt', '/documents/c.txt']
const results = await fileSystem.readBinaryBatch(paths)
// Returns Map<string, Uint8Array> - missing files are omitted
```

For writing multiple files with progress tracking:

```typescript
const entries = [
  { path: '/documents/a.txt', content: new Uint8Array([1, 2, 3]) },
  { path: '/documents/b.txt', content: new Uint8Array([4, 5, 6]) },
]

await fileSystem.writeBinaryBatch(entries, {
  createParents: true,
  onProgress: (completed, total) => console.log(`${completed}/${total}`),
  concurrency: 20,  // parallel writes (default: 20)
})
```

## Web Worker Support

For accessing the filesystem from Web Workers (including classic workers that can't use ES modules):

```typescript
// In your worker
import {
  readBinaryIDB,
  writeBinaryIDB,
  readBinaryOPFS,
  writeBinaryOPFS,
  isOPFSAvailable
} from '@siglum/filesystem/worker'

// Read/write directly without the full service
const data = await readBinaryIDB('/path/to/file')
await writeBinaryOPFS('/path/to/file', new Uint8Array([1, 2, 3]))
```

### Storage Constants

Access the underlying storage identifiers (useful for direct IndexedDB/OPFS access):

```typescript
import {
  IDB_NAME,        // 'siglum_filesystem'
  IDB_VERSION,     // 1
  IDB_FILES_STORE, // 'files'
  IDB_DIRS_STORE,  // 'directories'
  OPFS_ROOT        // ''
} from '@siglum/filesystem/constants'
```

## Backends

### OPFS (Origin Private File System)

Fast, persistent storage using the browser's Origin Private File System API.
- Best performance for large files
- Streaming support

### IndexedDB

Fallback for browsers without OPFS support.
- Universal browser support
- Slightly slower for large files

## API

### FileSystemService

#### Mounting

- `mount(path, backend)` - Mount a backend at a path
- `mountAuto(path, options?)` - Mount with automatic backend selection
- `unmount(path)` - Unmount a backend
- `getMounts()` - List all mount points
- `isMounted(path)` - Check if a path has a mounted backend
- `getBackendType(path)` - Get backend type ('opfs' | 'indexeddb' | null)

#### File Operations

- `readFile(path)` - Read text content
- `writeFile(path, content, options?)` - Write text content
- `readBinary(path)` - Read binary data
- `writeBinary(path, data, options?)` - Write binary data
- `readBinaryBatch(paths)` - Read multiple files efficiently (returns `Map<string, Uint8Array>`)
- `writeBinaryBatch(entries, options?)` - Write multiple files with progress tracking
- `deleteFile(path)` - Delete a file
- `copyFile(src, dest)` - Copy a file
- `rename(oldPath, newPath)` - Rename or move a file

#### Directory Operations

- `mkdir(path)` - Create directory (and parents)
- `rmdir(path, options?)` - Remove directory (`{ recursive?: boolean }`)
- `readdir(path)` - List directory contents (returns `FileEntry[]`)

#### Query Operations

- `exists(path)` - Check if path exists
- `stat(path)` - Get file/directory stats (returns `FileStats`)

#### Events

- `subscribe(handler)` - Subscribe to filesystem events, returns unsubscribe function

### Types

```typescript
interface FileStats {
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: Date
}

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
}

type FileSystemEvent =
  | { type: 'file:created'; path: string }
  | { type: 'file:modified'; path: string }
  | { type: 'file:deleted'; path: string }
  | { type: 'directory:created'; path: string }
  | { type: 'directory:deleted'; path: string }
```

## License

MIT
