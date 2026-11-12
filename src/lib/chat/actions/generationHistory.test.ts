import { describe, it, expect, vi } from 'vitest';
vi.mock('../../openaiClient.js', () => ({ respond: vi.fn(async () => ({ text: 'reply' })) }));
import { respond } from '../../openaiClient.js';
import { buildHistory, generateResponse, handleGenerationSuccess, prepareRefreshAfterUser } from './generationActions';

describe('generation history at an insertion point', () => {
  it.each([false, true])('excludes later conversation while preserving prompt injections (streaming=%s)', async (streaming) => {
    const nodes = ['first user', 'old answer', 'later user'].map((content, i) => ({
      id: i + 1, active: 0, variants: [{ id: i + 1, role: i === 1 ? 'assistant' : 'user', content, time: 0, typing: false, next: i < 2 ? i + 2 : null }],
    }));
    const prepared = prepareRefreshAfterUser(nodes as any, 1, 0, 4, 4)!;
    await generateResponse({
      nodes: prepared.nodes, rootId: 1, chatSettings: {} as any, connectionId: null, streaming, typingVariantId: 4,
      historyPrefix: [{ role: 'system', content: 'character prompt' }],
      historySuffix: [{ role: 'system', content: 'post-history instructions' }],
    });
    expect(vi.mocked(respond).mock.lastCall?.[0].messages?.map(m => m.content)).toEqual(['character prompt', 'first user', 'post-history instructions']);
    expect(prepared.nodes.find(n => n.id === 4)?.variants[0]?.next).toBe(2);
  });
});

describe('replies as the provider returned them', () => {
  const native = { api: 'anthropic' as const, endpoint: 'https://api.anthropic.com/v1', model: 'm', text: 'answer', data: [{ type: 'text', text: 'answer' }] };

  it('are stored with the reply and sent back with it', async () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'q', time: 0, typing: false, next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'typing', time: 0, typing: true, next: null }] },
    ] as any;
    const done = handleGenerationSuccess(nodes, 2, { text: 'answer', native });
    expect(done[1]?.variants[0]?.native).toBe(native);

    const withNext = [...done.map((n: any) => (n.id === 2 ? { ...n, variants: [{ ...n.variants[0], next: 3 }] } : n)),
      { id: 3, active: 0, variants: [{ id: 3, role: 'user', content: 'more', time: 0, typing: false, next: null }] }];
    await generateResponse({ nodes: withNext, rootId: 1, chatSettings: {} as any, connectionId: null, streaming: false, typingVariantId: null });
    expect(vi.mocked(respond).mock.lastCall?.[0].messages?.[1]).toEqual({ role: 'assistant', content: 'answer', native });
  });
});

describe('a steered reply stored as the messages it became', () => {
  const native = { api: 'responses' as const, endpoint: 'e', model: 'm', text: 'Cats are\n\nDogs too.', data: [] };
  const steered = {
    text: 'Cats are\n\nDogs too.',
    parts: [
      { role: 'assistant' as const, content: 'Cats are' },
      { role: 'user' as const, content: 'also dogs' },
      { role: 'assistant' as const, content: 'Dogs too.' },
    ],
    steers: [{ at: 8, text: 'also dogs' }],
  };
  const messages = (middle = 'also dogs') => [
    { id: 1, role: 'user', content: 'cats?', time: 0, typing: false, next: null },
    { id: 2, role: 'assistant', content: 'Cats are', time: 0, typing: false, next: null },
    { id: 3, role: 'user', content: middle, time: 0, typing: false, next: null },
    { id: 4, role: 'assistant', content: 'Dogs too.', time: 0, typing: false, next: null, native, steered },
  ] as any;

  it('goes back as one native turn while its messages are unchanged', () => {
    expect(buildHistory(messages())).toEqual([
      { role: 'user', content: 'cats?' },
      { role: 'assistant', content: 'Cats are\n\nDogs too.', native, steers: steered.steers },
    ]);
  });

  it('goes back as its messages once one of them is edited', () => {
    expect(buildHistory(messages('also birds')).map(m => [m.role, m.content, !!m.native])).toEqual([
      ['user', 'cats?', false],
      ['assistant', 'Cats are', false],
      ['user', 'also birds', false],
      // The final message alone is not the native turn's text, so it goes plain.
      ['assistant', 'Dogs too.', true],
    ]);
  });
});
