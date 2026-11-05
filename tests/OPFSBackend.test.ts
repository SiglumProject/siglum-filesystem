import { describe, expect, spyOn, test } from 'bun:test'
import { OPFSBackend } from '../src/OPFSBackend'

describe('OPFS reads', () => {
  const path = '/src/welcome.tex'

  test('preserves ENOENT for a missing file or parent directory', async () => {
    const backend = new OPFSBackend()
    spyOn(backend, 'getFileHandle').mockRejectedValue(new DOMException('Missing', 'NotFoundError'))

    await expect(backend.readFile(path)).rejects.toThrow('ENOENT: no such file or directory: ' + path)
    await expect(backend.readBinary(path)).rejects.toThrow('ENOENT: no such file or directory: ' + path)
  })

  test('reports a temporarily unreadable file as a read error', async () => {
    const backend = new OPFSBackend()
    const failure = new DOMException('The file is temporarily unavailable', 'NotReadableError')
    const handle = {
      getFile: async () => { throw failure }
    } as unknown as FileSystemFileHandle
    spyOn(backend, 'getFileHandle').mockResolvedValue(handle)

    await expect(backend.readFile(path)).rejects.toBe(failure)
    await expect(backend.readBinary(path)).rejects.toBe(failure)
  })

  test('reports errors while reading the file data', async () => {
    const backend = new OPFSBackend()
    const failure = new DOMException('The read was interrupted', 'AbortError')
    const file = new File(['draft contents'], 'welcome.tex')
    spyOn(file, 'text').mockRejectedValue(failure)
    spyOn(file, 'arrayBuffer').mockRejectedValue(failure)
    const handle = { getFile: async () => file } as unknown as FileSystemFileHandle
    spyOn(backend, 'getFileHandle').mockResolvedValue(handle)

    await expect(backend.readFile(path)).rejects.toBe(failure)
    await expect(backend.readBinary(path)).rejects.toBe(failure)
  })
})
