import { test, expect } from 'bun:test'
import './setup'
import { FileSystemService } from '../src/FileSystemService'
import { IndexedDBBackend } from '../src/IndexedDBBackend'

const unique = () => '/audit-' + crypto.randomUUID()
test('namespaced auto mount falls back without OPFS', async () => {
 const fs = new FileSystemService()
 const backend = await fs.mountAuto('/git', { namespace: 'audit-git' })
 expect(backend.name).toBe('indexeddb')
 await fs.writeFile('/git/test.tex', 'hello')
 expect(await fs.readFile('/git/test.tex')).toBe('hello')
})
test('explicit IndexedDB preference is honored with a namespace', async () => {
 const fs = new FileSystemService()
 expect((await fs.mountAuto('/git', {backend:'indexeddb',namespace:'audit-2'})).name).toBe('indexeddb')
})
test('non-recursive rmdir preserves a nonempty directory', async () => {
 const fs = new FileSystemService(); fs.mount('/project',new IndexedDBBackend())
 const path='/project'+unique()
 await fs.writeFile(path+'/keep.txt','keep',{createParents:true})
 await expect(fs.rmdir(path)).rejects.toThrow()
 expect(await fs.exists(path)).toBe(true)
})

test('IndexedDB namespaces are isolated and survive remounting', async () => {
 const a = new FileSystemService(), b = new FileSystemService()
 const namespace = 'audit-' + crypto.randomUUID()
 await a.mountAuto('/a', {backend:'indexeddb', namespace})
 await b.mountAuto('/b', {backend:'indexeddb', namespace:namespace+'-other'})
 await a.writeFile('/a/main.tex', 'one')
 await b.writeFile('/b/main.tex', 'two')
 expect(await a.readFile('/a/main.tex')).toBe('one')
 expect(await b.readFile('/b/main.tex')).toBe('two')
 const remounted = new FileSystemService()
 await remounted.mountAuto('/c', {backend:'indexeddb', namespace})
 expect(await remounted.readFile('/c/main.tex')).toBe('one')
})

test('nested directory listings return canonical paths without repeating the directory', async () => {
 const fs = new FileSystemService(); fs.mount('/project', new IndexedDBBackend())
 const path = '/project' + unique()
 await fs.writeFile(path + '/nested/main.tex', 'text', {createParents:true})
 expect((await fs.readdir(path + '/nested'))[0].path).toBe(path + '/nested/main.tex')
})

test('directory rename preserves nested binary files and rejects moving into itself', async () => {
 const fs = new FileSystemService(); fs.mount('/project', new IndexedDBBackend())
 const path = '/project' + unique()
 const bytes = new Uint8Array([0, 255, 42])
 await fs.writeBinary(path + '/old/nested/image.bin', bytes, {createParents:true})
 await expect(fs.rename(path + '/old', path + '/old/child')).rejects.toThrow()
 await fs.rename(path + '/old', path + '/new')
 expect(await fs.readBinary(path + '/new/nested/image.bin')).toEqual(bytes)
 expect(await fs.exists(path + '/old')).toBe(false)
})
