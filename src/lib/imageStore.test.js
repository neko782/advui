import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function makeRequest(exec) {
  const req = { onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, result: undefined, error: null }
  queueMicrotask(() => {
    try {
      req.result = exec()
      req.onsuccess?.()
    } catch (err) {
      req.error = err
      req.onerror?.()
    }
  })
  return req
}

function createFakeIndexedDB({ images = new Map(), failReads = false } = {}) {
  const readError = () => Object.assign(new Error('read failed'), { name: 'UnknownError' })
  const db = {
    objectStoreNames: { contains: () => true },
    close: () => {},
    onversionchange: null,
    transaction: () => ({
      objectStore: () => ({
        getAll: () => makeRequest(() => {
          if (failReads) throw readError()
          return [...images.values()]
        }),
        get: (key) => makeRequest(() => {
          if (failReads) throw readError()
          return images.get(key) // undefined for missing keys, like real IDB
        }),
        put: (value) => makeRequest(() => { images.set(value.id, value) }),
        delete: (key) => makeRequest(() => { images.delete(key) }),
      }),
    }),
  }
  return { open: () => makeRequest(() => db) }
}

async function loadImageStore(fakeIDB) {
  vi.stubGlobal('indexedDB', fakeIDB)
  vi.resetModules()
  return import('./imageStore.js')
}

const storedImage = (id) => ({ id, data: 'aGk=', mimeType: 'image/png', name: `${id}.png`, timestamp: 1 })

describe('imageStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('imageExists', () => {
    it('returns false for a missing id (IDB resolves undefined, not null)', async () => {
      const imageStore = await loadImageStore(createFakeIndexedDB())
      await expect(imageStore.imageExists('nope')).resolves.toBe(false)
    })

    it('returns true for an existing id', async () => {
      const images = new Map([['img-1', storedImage('img-1')]])
      const imageStore = await loadImageStore(createFakeIndexedDB({ images }))
      await expect(imageStore.imageExists('img-1')).resolves.toBe(true)
    })
  })

  describe('validateImageReferences error path', () => {
    it('reports no missing ids when the DB read fails', async () => {
      const imageStore = await loadImageStore(createFakeIndexedDB({ failReads: true }))
      const result = await imageStore.validateImageReferences(['img-1', 'img-2'])

      expect(result.valid).toBe(false)
      expect(result.validationFailed).toBe(true)
      expect(result.missingIds).toEqual([])
    })

    it('still detects genuinely missing ids when reads succeed', async () => {
      const images = new Map([['img-1', storedImage('img-1')]])
      const imageStore = await loadImageStore(createFakeIndexedDB({ images }))
      const result = await imageStore.validateImageReferences(['img-1', 'img-2'])

      expect(result.valid).toBe(false)
      expect(result.validationFailed).toBeUndefined()
      expect(result.missingIds).toEqual(['img-2'])
    })
  })

  describe('cleanInvalidImageReferences', () => {
    const nodes = [
      { variants: [{ images: [{ id: 'img-1' }, { id: 'img-2' }] }] },
    ]

    it('skips cleaning when validation itself failed', async () => {
      const imageStore = await loadImageStore(createFakeIndexedDB({ failReads: true }))
      const result = await imageStore.cleanInvalidImageReferences(nodes)

      expect(result.nodes).toBe(nodes)
      expect(result.removedIds).toEqual([])
    })

    it('removes only genuinely missing references when reads succeed', async () => {
      const images = new Map([['img-1', storedImage('img-1')]])
      const imageStore = await loadImageStore(createFakeIndexedDB({ images }))
      const result = await imageStore.cleanInvalidImageReferences(nodes)

      expect(result.removedIds).toEqual(['img-2'])
      expect(result.nodes[0].variants[0].images).toEqual([{ id: 'img-1' }])
    })
  })
})
