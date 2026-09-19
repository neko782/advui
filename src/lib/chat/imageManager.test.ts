import { describe, expect, it, vi } from 'vitest'
import { ChatImageManager } from './imageManager.svelte'

vi.mock('../imageStore.js', () => ({
  storeImage: vi.fn().mockResolvedValue('image-id'),
  generateImageId: () => 'image-id',
  fileToBase64: vi.fn().mockResolvedValue('aGVsbG8='),
  getImage: vi.fn(),
}))

describe('attachment file collections', () => {
  it('reads and attaches files supplied as a FileList', async () => {
    const manager = new ChatImageManager()
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const files = { 0: file, length: 1, item: () => file } as unknown as FileList
    await manager.handleFilesSelected(files)
    expect(manager.attachedImages).toEqual([
      { id: 'image-id', data: 'aGVsbG8=', mimeType: 'text/plain', name: 'notes.txt' },
    ])
    expect(manager.imageCache['image-id'].data).toBe('aGVsbG8=')
  })
})
