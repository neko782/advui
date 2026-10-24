import { describe, expect, it, vi } from 'vitest'
import { getImage, storeImage } from '../imageStore'
import { buildProviderInput } from '../api/core'
import { buildVisible } from '../branching'
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
    expect(manager.imageCache['image-id']?.data).toBe('aGVsbG8=')
  })
})

it('reports a generated-image storage failure instead of returning a dangling reference', async () => {
  vi.mocked(storeImage).mockRejectedValueOnce(new Error('quota exceeded'));
  const manager = new ChatImageManager();
  await expect(manager.storeGeneratedImagesInMedia({ text: '', generatedImages: [{ id: 'generated', data: 'AQID' }] })).rejects.toThrow('Could not save generated image: quota exceeded');
});

it('waits for an existing media load before constructing the request', async () => {
  let finish: (value: unknown) => void;
  vi.mocked(getImage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish }));
  const manager = new ChatImageManager();
  const nodes = [{ id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'Describe it', time: 0, typing: false, images: [{ id: 'photo', mimeType: 'image/png' }], next: null }] }];
  manager.ensureImagesAvailable([{ id: 'photo' }]);
  let ready = false;
  const pending = manager.prepareRequestNodes(nodes as any, 1, null).then(value => { ready = true; return value });
  await Promise.resolve();
  expect(ready).toBe(false);
  finish!({ id: 'photo', data: 'AQID', mimeType: 'image/png' });
  const enriched = await pending;
  const history = buildVisible(enriched, 1).map(vm => vm.m);
  expect(buildProviderInput(history as any, undefined)).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'Describe it' }, { type: 'input_image', image_url: 'data:image/png;base64,AQID' }] }]);
});

it('fails visibly for missing request media and ignores media after the generation point', async () => {
  vi.mocked(getImage).mockResolvedValue(null);
  const manager = new ChatImageManager();
  const nodes = [{ id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hi', images: [{ id: 'missing' }], next: null }] }];
  await expect(manager.prepareRequestNodes(nodes as any, 1, null)).rejects.toThrow('Could not load attachment: missing');
  await expect(manager.prepareRequestNodes(nodes as any, 1, 1)).resolves.toEqual(nodes);
});

it('preserves legacy string refs on every branch and hydrates them for requests', async () => {
  vi.mocked(getImage).mockResolvedValue({ id: 'photo', data: 'AQID', mimeType: 'image/png', timestamp: 0 });
  const manager = new ChatImageManager();
  const nodes = [{ id: 1, active: 0, variants: [
    { id: 1, role: 'user', content: 'Describe it', time: 0, typing: false, images: [' photo ', { id: 'photo', mimeType: 'image/png' }, ''], next: null },
    { id: 2, role: 'user', content: 'Alternate', time: 0, typing: false, images: ['other-photo'], next: null },
  ] }];
  const sanitized = manager.sanitizeNodesImageData(nodes as never);
  expect(sanitized[0]?.variants[0]?.images).toEqual([{ id: 'photo' }]);
  expect(sanitized[0]?.variants[1]?.images).toEqual([{ id: 'other-photo' }]);
  const enriched = await manager.prepareRequestNodes(sanitized, 1, null);
  expect(buildProviderInput(buildVisible(enriched, 1).map(vm => vm.m) as never, undefined)).toEqual([
    { role: 'user', content: [{ type: 'input_text', text: 'Describe it' }, { type: 'input_image', image_url: 'data:image/png;base64,AQID' }] },
  ]);
});
