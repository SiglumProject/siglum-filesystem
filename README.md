# @siglum/filesystem

[![npm version](https://img.shields.io/npm/v/@siglum/filesystem)](https://www.npmjs.com/package/@siglum/filesystem)
[![weekly npm downloads](https://img.shields.io/npm/dw/@siglum/filesystem)](https://www.npmjs.com/package/@siglum/filesystem)

A TypeScript filesystem API for browser-local storage. OPFS and IndexedDB
share the same file, directory, and mount operations.

## Install

```sh
npm install @siglum/filesystem
```

## Quick start

```typescript
import { fileSystem } from '@siglum/filesystem'

await fileSystem.mountAuto('/documents')
await fileSystem.writeFile('/documents/hello.txt', 'Hello, world!')

const text = await fileSystem.readFile('/documents/hello.txt')
console.log(text)
```

Mounts select an available backend and preserve existing storage choices.
Text and binary files stay in the browser's local storage.

Use a mount namespace when separate projects need isolated storage.
Backend selection, recovery behavior, and worker access are covered in the
usage guide.

## Documentation

- [Usage and API](docs/usage.md)
- [Development and repository map](docs/development.md)
- [Contributor instructions](AGENTS.md)

## License

[MIT](LICENSE)
