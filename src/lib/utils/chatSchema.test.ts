import { expect, it } from 'vitest';
import { assertValidChat } from './chatSchema';

it('rejects duplicate message IDs across nodes and within variants', () => {
  const variant = { id: 1, role: 'user', content: 'Hello', next: null };
  for (const nodes of [
    [{ id: 1, variants: [variant], active: 0 }, { id: 2, variants: [variant], active: 0 }],
    [{ id: 1, variants: [variant, variant], active: 0 }],
  ]) {
    expect(() => assertValidChat({ id: 'test', nodes, rootId: 1 })).toThrow('Duplicate message id');
  }
});
