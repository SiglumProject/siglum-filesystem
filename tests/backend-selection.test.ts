import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

type Fixture = {
  preference?: 'opfs' | 'indexeddb'
  probeFailure?: 'opfs' | 'indexeddb'
  indexedDBFiles?: string[]
  opfsDirectories?: string[]
  opfsFiles?: string[]
}

// Backend selection is cached for the lifetime of a page. Each subprocess
// models a new page without adding a reset hook to production code.
const runFixture = String.raw`
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { BACKEND_STORAGE_KEY, IDB_NAME } from './src/constants.ts'
import { IndexedDBBackend } from './src/IndexedDBBackend.ts'
import { getBestBackend } from './src/FileSystemService.ts'

const fixture = JSON.parse(Bun.argv.at(-1))
const storage = new Map()
if (fixture.preference) storage.set(BACKEND_STORAGE_KEY, fixture.preference)

function directory(name) {
  const children = new Map()
  const getHandle = (name, kind, create) => {
    if (!children.has(name)) {
      if (!create) throw new DOMException('Missing entry', 'NotFoundError')
      children.set(name, kind === 'directory' ? directory(name) : file(name))
    }
    const handle = children.get(name)
    if (handle.kind !== kind) throw new DOMException('Wrong entry kind', 'TypeMismatchError')
    return handle
  }
  return {
    kind: 'directory',
    name,
    async getDirectoryHandle(name, options) {
      if (fixture.probeFailure === 'opfs' && name === 'siglum-files' && !options?.create) {
        throw new DOMException('Project storage is temporarily unreadable', 'NotReadableError')
      }
      return getHandle(name, 'directory', options?.create)
    },
    async getFileHandle(name, options) { return getHandle(name, 'file', options?.create) },
    async removeEntry(name) { children.delete(name) },
    async *values() { yield* children.values() },
    async *[Symbol.asyncIterator]() { yield* children.entries() }
  }
}

function file(name) {
  return {
    kind: 'file',
    name,
    async createWritable() { return { async write() {}, async close() {} } }
  }
}

const root = directory('')
Object.defineProperties(globalThis, {
  indexedDB: { value: new IDBFactory() },
  IDBKeyRange: { value: IDBKeyRange },
  localStorage: { value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  } },
  navigator: { value: { storage: { getDirectory: async () => root } } }
})

async function makeDirectory(path) {
  let current = root
  for (const name of path.split('/').filter(Boolean)) {
    current = await current.getDirectoryHandle(name, { create: true })
  }
  return current
}

for (const path of fixture.opfsDirectories ?? []) await makeDirectory(path)
for (const path of fixture.opfsFiles ?? []) {
  const parts = path.split('/')
  const name = parts.pop()
  const parent = await makeDirectory(parts.join('/'))
  await parent.getFileHandle(name, { create: true })
}

const indexedDB = new IndexedDBBackend()
for (const path of fixture.indexedDBFiles ?? []) await indexedDB.writeFile(path, 'IndexedDB draft')

if (fixture.probeFailure === 'indexeddb') {
  globalThis.indexedDB.open = () => { throw new DOMException('IndexedDB access denied', 'SecurityError') }
}
let chosen = null
let error = null
try {
  chosen = await getBestBackend()
} catch (cause) {
  error = cause.message
}
const firstPath = fixture.indexedDBFiles?.[0]
const draft = firstPath && chosen?.name === 'indexeddb' ? await chosen.readFile(firstPath) : null
const hasIndexedDB = (await globalThis.indexedDB.databases()).some(db => db.name === IDB_NAME)
console.log(JSON.stringify({ backend: chosen?.name ?? null, error, preference: storage.get(BACKEND_STORAGE_KEY) ?? null, draft, hasIndexedDB }))
`

function chooseBackend(fixture: Fixture) {
  const result = Bun.spawnSync(
    [process.execPath, '--eval', runFixture, '--', JSON.stringify(fixture)],
    { cwd: resolve(import.meta.dir, '..') }
  )
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return JSON.parse(result.stdout.toString().trim().split('\n').at(-1)!)
}

test('reopens a legacy IndexedDB draft when OPFS has only caches and empty directories', () => {
  const result = chooseBackend({
    indexedDBFiles: ['/src/book/chapter.tex'],
    opfsDirectories: ['/siglum-files/src/empty', '/siglum-git/empty'],
    opfsFiles: ['/siglum-files/compiler/latex.fmt', '/siglum-files/manifest.json']
  })
  expect(result).toMatchObject({ backend: 'indexeddb', preference: 'indexeddb', draft: 'IndexedDB draft' })
})

test('detects a legacy top-level IndexedDB document', () => {
  const result = chooseBackend({ indexedDBFiles: ['/welcome.tex'] })
  expect(result).toMatchObject({ backend: 'indexeddb', preference: 'indexeddb', draft: 'IndexedDB draft' })
})

test('keeps the existing OPFS default when both stores contain project files', () => {
  for (const path of ['/siglum-files/src/book/chapter.tex', '/siglum-files/welcome.tex', '/siglum-git/repository/main.tex']) {
    const result = chooseBackend({ indexedDBFiles: ['/src/main.tex'], opfsFiles: [path] })
    expect(result).toMatchObject({ backend: 'opfs', preference: 'opfs' })
  }
})

test('does not select IndexedDB for compiler cache entries alone', () => {
  const result = chooseBackend({ indexedDBFiles: ['/compiler/cache.tex', '/manifest.json'] })
  expect(result).toMatchObject({ backend: 'opfs', preference: 'opfs' })
})

test('does not create an IndexedDB database on a fresh origin', () => {
  expect(chooseBackend({})).toMatchObject({ backend: 'opfs', preference: 'opfs', hasIndexedDB: false })
})

test('rejects backend selection when a project storage probe fails', () => {
  for (const probeFailure of ['opfs', 'indexeddb'] as const) {
    for (const preference of [undefined, 'opfs'] as const) {
      const result = chooseBackend({ indexedDBFiles: ['/src/main.tex'], probeFailure, preference })
      expect(result).toMatchObject({
        backend: null,
        preference: preference ?? null,
        hasIndexedDB: true
      })
      expect(result.error).toMatch(/storage.*temporarily unavailable/i)
    }
  }
})

test('recovers an IndexedDB draft despite a saved OPFS preference when OPFS has no documents', () => {
  const result = chooseBackend({
    preference: 'opfs',
    indexedDBFiles: ['/src/resume.tex'],
    opfsDirectories: ['/siglum-files/src/empty', '/siglum-git/empty'],
    opfsFiles: ['/siglum-files/compiler/latex.fmt', '/siglum-files/manifest.json']
  })
  expect(result).toMatchObject({
    backend: 'indexeddb',
    preference: 'indexeddb',
    draft: 'IndexedDB draft'
  })
})

test('keeps a saved OPFS preference when OPFS contains documents', () => {
  for (const path of ['/siglum-files/src/book/chapter.tex', '/siglum-files/welcome.tex', '/siglum-git/repository/main.tex']) {
    const result = chooseBackend({
      preference: 'opfs',
      indexedDBFiles: ['/src/resume.tex'],
      opfsFiles: [path]
    })
    expect(result).toMatchObject({ backend: 'opfs', preference: 'opfs' })
  }
})

test('honors a saved IndexedDB preference when OPFS contains documents', () => {
  const result = chooseBackend({
    preference: 'indexeddb',
    indexedDBFiles: ['/src/resume.tex'],
    opfsFiles: ['/siglum-files/src/main.tex']
  })
  expect(result).toMatchObject({
    backend: 'indexeddb',
    preference: 'indexeddb',
    draft: 'IndexedDB draft'
  })
})
