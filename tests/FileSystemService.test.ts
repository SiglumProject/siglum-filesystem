import { describe, expect, test, beforeEach } from 'bun:test'
import './setup'
import { FileSystemService } from '../src/FileSystemService'
import { IndexedDBBackend } from '../src/IndexedDBBackend'

describe('FileSystemService', () => {
  let service: FileSystemService
  let backend: IndexedDBBackend
  let testPath: string

  beforeEach(() => {
    service = new FileSystemService()
    backend = new IndexedDBBackend()
    // Generate unique path for each test
    testPath = `/test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  })

  describe('mount and unmount', () => {
    test('mounts backend at path', () => {
      service.mount(testPath, backend)
      expect(service.getBackendType(testPath)).toBe('indexeddb')
    })

    test('unmounts backend', () => {
      service.mount(testPath, backend)
      service.unmount(testPath)
      expect(service.getBackendType(testPath)).toBe(null)
    })
  })

  describe('getBackendType', () => {
    test('returns null for unmounted path', () => {
      expect(service.getBackendType('/unmounted')).toBe(null)
    })

    test('returns backend name for mounted path', () => {
      service.mount(testPath, backend)
      expect(service.getBackendType(testPath + '/subpath')).toBe('indexeddb')
    })
  })

  describe('file operations through service', () => {
    beforeEach(() => {
      service.mount(testPath, backend)
    })

    test('writeFile and readFile', async () => {
      await service.writeFile(testPath + '/hello.txt', 'world')
      const content = await service.readFile(testPath + '/hello.txt')
      expect(content).toBe('world')
    })

    test('writeBinary and readBinary', async () => {
      const data = new Uint8Array([10, 20, 30])
      await service.writeBinary(testPath + '/data.bin', data)
      const result = await service.readBinary(testPath + '/data.bin')
      expect(result).toEqual(data)
    })

    test('exists returns true for existing file', async () => {
      await service.writeFile(testPath + '/exists.txt', 'content')
      expect(await service.exists(testPath + '/exists.txt')).toBe(true)
    })

    test('exists returns false for non-existent file', async () => {
      expect(await service.exists(testPath + '/nonexistent.txt')).toBe(false)
    })

    test('mkdir creates directory', async () => {
      await service.mkdir(testPath + '/newdir')
      expect(await service.exists(testPath + '/newdir')).toBe(true)
    })

    test('readdir lists contents', async () => {
      await service.mkdir(testPath + '/dir')
      await service.writeFile(testPath + '/dir/a.txt', 'a')
      await service.writeFile(testPath + '/dir/b.txt', 'b')

      const entries = await service.readdir(testPath + '/dir')
      const names = entries.map(e => e.name).sort()
      expect(names).toEqual(['a.txt', 'b.txt'])
    })

    test('deleteFile removes file', async () => {
      await service.writeFile(testPath + '/todelete.txt', 'bye')
      await service.deleteFile(testPath + '/todelete.txt')
      expect(await service.exists(testPath + '/todelete.txt')).toBe(false)
    })

    test('stat returns file info', async () => {
      await service.writeFile(testPath + '/info.txt', 'hello')
      const stats = await service.stat(testPath + '/info.txt')
      expect(stats.isFile).toBe(true)
      expect(stats.size).toBe(5)
    })
  })

  describe('readBinaryBatch', () => {
    beforeEach(() => {
      service.mount(testPath, backend)
    })

    test('reads multiple files', async () => {
      await service.writeBinary(testPath + '/a.bin', new Uint8Array([1]))
      await service.writeBinary(testPath + '/b.bin', new Uint8Array([2]))

      const results = await service.readBinaryBatch([testPath + '/a.bin', testPath + '/b.bin'])

      expect(results.size).toBe(2)
      expect(results.get(testPath + '/a.bin')).toEqual(new Uint8Array([1]))
      expect(results.get(testPath + '/b.bin')).toEqual(new Uint8Array([2]))
    })

    test('skips unmounted paths', async () => {
      await service.writeBinary(testPath + '/exists.bin', new Uint8Array([1]))

      const results = await service.readBinaryBatch([testPath + '/exists.bin', '/unmounted/file.bin'])

      expect(results.size).toBe(1)
      expect(results.has(testPath + '/exists.bin')).toBe(true)
      expect(results.has('/unmounted/file.bin')).toBe(false)
    })

    test('handles empty array', async () => {
      const results = await service.readBinaryBatch([])
      expect(results.size).toBe(0)
    })
  })

  describe('multiple mounts', () => {
    test('routes to correct mount point based on path', async () => {
      // Use different relative file names to avoid collision in shared backend
      const docsPath = `/docs-${Date.now()}`
      const dataPath = `/data-${Date.now()}`

      service.mount(docsPath, backend)
      service.mount(dataPath, backend)

      // Write to different relative paths to avoid collision
      await service.writeFile(docsPath + '/doc-file.txt', 'docs content')
      await service.writeFile(dataPath + '/data-file.txt', 'data content')

      // Each mount point routes to the correct relative path in backend
      expect(await service.readFile(docsPath + '/doc-file.txt')).toBe('docs content')
      expect(await service.readFile(dataPath + '/data-file.txt')).toBe('data content')
    })

    test('nested mounts work correctly', async () => {
      const outerPath = `/outer-${Date.now()}`
      const innerPath = outerPath + '/inner'

      service.mount(outerPath, backend)
      service.mount(innerPath, backend)

      await service.writeFile(outerPath + '/outer.txt', 'outer')
      await service.writeFile(innerPath + '/inner.txt', 'inner')

      // Inner path should use inner mount
      expect(service.getBackendType(innerPath + '/inner.txt')).toBe('indexeddb')
      expect(await service.readFile(outerPath + '/outer.txt')).toBe('outer')
      expect(await service.readFile(innerPath + '/inner.txt')).toBe('inner')
    })
  })

  describe('error handling', () => {
    test('throws when reading from unmounted path', async () => {
      await expect(service.readFile('/unmounted/file.txt')).rejects.toThrow()
    })

    test('throws when writing to unmounted path', async () => {
      await expect(service.writeFile('/unmounted/file.txt', 'content')).rejects.toThrow()
    })
  })
})
