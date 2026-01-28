import { describe, expect, test, beforeEach } from 'bun:test'
import './setup'
import { IndexedDBBackend } from '../src/IndexedDBBackend'

describe('IndexedDBBackend', () => {
  let backend: IndexedDBBackend
  let testPrefix: string

  beforeEach(async () => {
    backend = new IndexedDBBackend()
    // Use unique prefix for each test to avoid collisions
    testPrefix = `/test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  })

  test('name is indexeddb', () => {
    expect(backend.name).toBe('indexeddb')
  })

  describe('writeFile and readFile', () => {
    test('writes and reads text file', async () => {
      await backend.writeFile(testPrefix + '/test.txt', 'hello world')
      const content = await backend.readFile(testPrefix + '/test.txt')
      expect(content).toBe('hello world')
    })

    test('overwrites existing file', async () => {
      await backend.writeFile(testPrefix + '/test.txt', 'first')
      await backend.writeFile(testPrefix + '/test.txt', 'second')
      const content = await backend.readFile(testPrefix + '/test.txt')
      expect(content).toBe('second')
    })

    test('throws on reading non-existent file', async () => {
      await expect(backend.readFile(testPrefix + '/nonexistent.txt')).rejects.toThrow()
    })
  })

  describe('writeBinary and readBinary', () => {
    test('writes and reads binary data', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      await backend.writeBinary(testPrefix + '/test.bin', data)
      const result = await backend.readBinary(testPrefix + '/test.bin')
      expect(result).toEqual(data)
    })

    test('handles empty binary data', async () => {
      const data = new Uint8Array([])
      await backend.writeBinary(testPrefix + '/empty.bin', data)
      const result = await backend.readBinary(testPrefix + '/empty.bin')
      expect(result).toEqual(data)
    })

    test('handles large binary data', async () => {
      const data = new Uint8Array(10000)
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256
      }
      await backend.writeBinary(testPrefix + '/large.bin', data)
      const result = await backend.readBinary(testPrefix + '/large.bin')
      expect(result).toEqual(data)
    })
  })

  describe('readBinaryBatch', () => {
    test('reads multiple files in one transaction', async () => {
      await backend.writeBinary(testPrefix + '/a.bin', new Uint8Array([1]))
      await backend.writeBinary(testPrefix + '/b.bin', new Uint8Array([2]))
      await backend.writeBinary(testPrefix + '/c.bin', new Uint8Array([3]))

      const results = await backend.readBinaryBatch([
        testPrefix + '/a.bin',
        testPrefix + '/b.bin',
        testPrefix + '/c.bin'
      ])

      expect(results.size).toBe(3)
      expect(results.get(testPrefix + '/a.bin')).toEqual(new Uint8Array([1]))
      expect(results.get(testPrefix + '/b.bin')).toEqual(new Uint8Array([2]))
      expect(results.get(testPrefix + '/c.bin')).toEqual(new Uint8Array([3]))
    })

    test('omits missing files from results', async () => {
      await backend.writeBinary(testPrefix + '/exists.bin', new Uint8Array([1]))

      const results = await backend.readBinaryBatch([
        testPrefix + '/exists.bin',
        testPrefix + '/missing.bin'
      ])

      expect(results.size).toBe(1)
      expect(results.get(testPrefix + '/exists.bin')).toEqual(new Uint8Array([1]))
      expect(results.has(testPrefix + '/missing.bin')).toBe(false)
    })

    test('returns empty map for empty input', async () => {
      const results = await backend.readBinaryBatch([])
      expect(results.size).toBe(0)
    })
  })

  describe('exists', () => {
    test('returns true for existing file', async () => {
      await backend.writeFile(testPrefix + '/test.txt', 'content')
      expect(await backend.exists(testPrefix + '/test.txt')).toBe(true)
    })

    test('returns false for non-existent file', async () => {
      expect(await backend.exists(testPrefix + '/nonexistent.txt')).toBe(false)
    })

    test('returns true for existing directory', async () => {
      await backend.mkdir(testPrefix + '/testdir')
      expect(await backend.exists(testPrefix + '/testdir')).toBe(true)
    })
  })

  describe('stat', () => {
    test('returns stats for file', async () => {
      await backend.writeFile(testPrefix + '/test.txt', 'hello')
      const stats = await backend.stat(testPrefix + '/test.txt')

      expect(stats.isFile).toBe(true)
      expect(stats.isDirectory).toBe(false)
      expect(stats.size).toBe(5)
      expect(stats.mtime).toBeInstanceOf(Date)
    })

    test('returns stats for directory', async () => {
      await backend.mkdir(testPrefix + '/testdir')
      const stats = await backend.stat(testPrefix + '/testdir')

      expect(stats.isFile).toBe(false)
      expect(stats.isDirectory).toBe(true)
    })

    test('throws for non-existent path', async () => {
      await expect(backend.stat(testPrefix + '/nonexistent')).rejects.toThrow()
    })
  })

  describe('mkdir', () => {
    test('creates directory', async () => {
      await backend.mkdir(testPrefix + '/newdir')
      expect(await backend.exists(testPrefix + '/newdir')).toBe(true)
    })

    test('creates nested directories', async () => {
      await backend.mkdir(testPrefix + '/a/b/c')
      expect(await backend.exists(testPrefix + '/a')).toBe(true)
      expect(await backend.exists(testPrefix + '/a/b')).toBe(true)
      expect(await backend.exists(testPrefix + '/a/b/c')).toBe(true)
    })
  })

  describe('readdir', () => {
    test('lists directory contents', async () => {
      await backend.mkdir(testPrefix + '/dir')
      await backend.writeFile(testPrefix + '/dir/file1.txt', 'a')
      await backend.writeFile(testPrefix + '/dir/file2.txt', 'b')

      const entries = await backend.readdir(testPrefix + '/dir')
      const names = entries.map(e => e.name).sort()

      expect(names).toEqual(['file1.txt', 'file2.txt'])
    })

    test('returns empty array for empty directory', async () => {
      await backend.mkdir(testPrefix + '/emptydir')
      const entries = await backend.readdir(testPrefix + '/emptydir')
      expect(entries).toEqual([])
    })

    test('distinguishes files and directories', async () => {
      await backend.mkdir(testPrefix + '/parent')
      await backend.mkdir(testPrefix + '/parent/subdir')
      await backend.writeFile(testPrefix + '/parent/file.txt', 'content')

      const entries = await backend.readdir(testPrefix + '/parent')
      const file = entries.find(e => e.name === 'file.txt')
      const dir = entries.find(e => e.name === 'subdir')

      expect(file?.isDirectory).toBe(false)
      expect(dir?.isDirectory).toBe(true)
    })
  })

  describe('deleteFile', () => {
    test('deletes existing file', async () => {
      await backend.writeFile(testPrefix + '/test.txt', 'content')
      await backend.deleteFile(testPrefix + '/test.txt')
      expect(await backend.exists(testPrefix + '/test.txt')).toBe(false)
    })

    test('succeeds silently for non-existent file', async () => {
      // IndexedDB delete doesn't throw if key doesn't exist
      await backend.deleteFile(testPrefix + '/nonexistent.txt')
    })
  })

  describe('rmdir', () => {
    test('deletes empty directory', async () => {
      await backend.mkdir(testPrefix + '/emptydir')
      await backend.rmdir(testPrefix + '/emptydir')
      expect(await backend.exists(testPrefix + '/emptydir')).toBe(false)
    })

    test('deletes directory with file recursively', async () => {
      const dirPath = testPrefix + '/dir'
      await backend.mkdir(dirPath)
      await backend.writeFile(dirPath + '/file.txt', 'content')

      await backend.rmdir(dirPath, { recursive: true })

      expect(await backend.exists(dirPath)).toBe(false)
      expect(await backend.exists(dirPath + '/file.txt')).toBe(false)
    })

    test('deletes nested directory recursively', async () => {
      const dirPath = testPrefix + '/dir'
      await backend.mkdir(dirPath + '/subdir')
      await backend.writeFile(dirPath + '/subdir/nested.txt', 'nested')

      // First verify the structure exists
      expect(await backend.exists(dirPath)).toBe(true)
      expect(await backend.exists(dirPath + '/subdir')).toBe(true)
      expect(await backend.exists(dirPath + '/subdir/nested.txt')).toBe(true)

      await backend.rmdir(dirPath, { recursive: true })

      expect(await backend.exists(dirPath + '/subdir/nested.txt')).toBe(false)
      expect(await backend.exists(dirPath + '/subdir')).toBe(false)
      expect(await backend.exists(dirPath)).toBe(false)
    })
  })

  describe('rename', () => {
    test('renames file', async () => {
      await backend.writeFile(testPrefix + '/old.txt', 'content')
      await backend.rename(testPrefix + '/old.txt', testPrefix + '/new.txt')

      expect(await backend.exists(testPrefix + '/old.txt')).toBe(false)
      expect(await backend.exists(testPrefix + '/new.txt')).toBe(true)
      expect(await backend.readFile(testPrefix + '/new.txt')).toBe('content')
    })
  })

  describe('copyFile', () => {
    test('copies file', async () => {
      const data = new Uint8Array([1, 2, 3])
      await backend.writeBinary(testPrefix + '/src.bin', data)
      await backend.copyFile(testPrefix + '/src.bin', testPrefix + '/dst.bin')

      expect(await backend.exists(testPrefix + '/src.bin')).toBe(true)
      expect(await backend.exists(testPrefix + '/dst.bin')).toBe(true)
      expect(await backend.readBinary(testPrefix + '/dst.bin')).toEqual(data)
    })
  })

  describe('path normalization', () => {
    test('handles paths without leading slash', async () => {
      const path = testPrefix.slice(1) + '/test.txt' // Remove leading slash
      await backend.writeFile(path, 'content')
      expect(await backend.readFile(testPrefix + '/test.txt')).toBe('content')
    })

    test('handles paths with trailing slash', async () => {
      await backend.writeFile(testPrefix + '/test.txt/', 'content')
      expect(await backend.readFile(testPrefix + '/test.txt')).toBe('content')
    })

    test('handles double slashes', async () => {
      await backend.writeFile(testPrefix + '//test//file.txt', 'content')
      expect(await backend.readFile(testPrefix + '/test/file.txt')).toBe('content')
    })
  })
})
