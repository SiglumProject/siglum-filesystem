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

## Manual Backend Selection

For direct control, import and mount backends explicitly:

```typescript
import { fileSystem, opfsBackend, indexedDBBackend } from '@siglum/filesystem'

fileSystem.mount('/documents', opfsBackend)
fileSystem.mount('/legacy', indexedDBBackend)
```

## Backends

### OPFS (Origin Private File System)

Fast, persistent storage using the browser's Origin Private File System API.
- Best performance for large files
- Streaming support
- ~95% browser support (Chrome, Edge, Firefox, Safari 16.4+)

### IndexedDB

Fallback for browsers without OPFS support.
- Universal browser support
- Slightly slower for large files

## API

### FileSystemService

- `mount(path, backend)` - Mount a backend at a path
- `unmount(path)` - Unmount a backend
- `writeFile(path, content)` - Write text content
- `readFile(path)` - Read text content
- `writeBinary(path, data)` - Write binary data
- `readBinary(path)` - Read binary data
- `exists(path)` - Check if path exists
- `stat(path)` - Get file stats
- `readdir(path)` - List directory contents
- `mkdir(path)` - Create directory
- `deleteFile(path)` - Delete file
- `deleteDirectory(path)` - Delete directory recursively

## For Git Operations

For isomorphic-git integration, use [@siglum/git](https://github.com/SiglumProject/siglum-ui/tree/main/packages/git) instead:

```typescript
import { createOPFSGitAdapter } from '@siglum/git'
```

## License

MIT
