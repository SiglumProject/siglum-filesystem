import { describe, expect, test } from 'bun:test'
import {
  IDB_NAME,
  IDB_VERSION,
  IDB_FILES_STORE,
  IDB_DIRS_STORE,
  OPFS_ROOT
} from '../src/constants'

describe('constants', () => {
  test('IDB_NAME is correct', () => {
    expect(IDB_NAME).toBe('siglum_filesystem')
  })

  test('IDB_VERSION is correct', () => {
    expect(IDB_VERSION).toBe(1)
  })

  test('IDB_FILES_STORE is correct', () => {
    expect(IDB_FILES_STORE).toBe('files')
  })

  test('IDB_DIRS_STORE is correct', () => {
    expect(IDB_DIRS_STORE).toBe('directories')
  })

  test('OPFS_ROOT is empty string', () => {
    expect(OPFS_ROOT).toBe('')
  })
})
