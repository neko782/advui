import { describe, it, expect, vi } from 'vitest';
vi.mock('../../openaiClient.js', () => ({ respond: vi.fn(async () => ({ text: 'reply' })) }));
import { respond } from '../../openaiClient.js';
import { generateResponse, prepareRefreshAfterUser } from './generationActions';

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
