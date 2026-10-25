import { afterEach, expect, it, vi } from 'vitest';
import { responsesAdapter } from './responses';
import { geminiAdapter, DEFAULT_GEMINI_BASE_URL } from './gemini';
const ctx = { model: 'test', apiKey: 'dummy', baseURL: 'https://example.test/v1', input: 'hello', params: {}, tools: {}, callbacks: {}, provideAbort: () => {} };
afterEach(() => vi.unstubAllGlobals());
it('preserves every message in a non-streaming response around tool calls', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [
    { type: 'message', content: [{ type: 'output_text', text: 'Let me check.\n' }] },
    { type: 'web_search_call', id: 'search' },
    { type: 'message', content: [{ type: 'output_text', text: 'Here is the answer.' }] },
  ] }))));
  expect((await responsesAdapter.respond(ctx, false)).text).toBe('Let me check.\nHere is the answer.');
});
it.each([
  [undefined, DEFAULT_GEMINI_BASE_URL],
  ['https://api.openai.com/v1', DEFAULT_GEMINI_BASE_URL],
  ['https://custom.example.test/v1beta/', 'https://custom.example.test/v1beta'],
])('uses the same Gemini endpoint for listing and generation (%s)', async (apiBaseUrl, expected) => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ models: [], candidates: [] })));
  vi.stubGlobal('fetch', fetcher);
  await geminiAdapter.listModels({ apiKey: 'dummy', baseURL: apiBaseUrl });
  expect(fetcher.mock.calls[0][0]).toBe(`${expected}/models?key=dummy`);
  await geminiAdapter.respond({ ...ctx, apiBaseUrl }, false);
  expect(fetcher.mock.calls[1][0]).toBe(`${expected}/models/test:generateContent?key=dummy`);
});

it('rejects premature EOF while delivering partial text to the caller', async () => {
  const onTextDelta = vi.fn();
  vi.stubGlobal('fetch', async () => new Response('data: {"type":"response.output_text.delta","delta":"Partial reply"}\n\n'));
  await expect(responsesAdapter.respond({ ...ctx, callbacks: { onTextDelta } }, true)).rejects.toThrow('interrupted');
  expect(onTextDelta.mock.calls[0][0]).toBe('Partial reply');
});
it('accepts a stream with a terminal completion event', async () => {
  vi.stubGlobal('fetch', async () => new Response('data: {"type":"response.output_text.delta","delta":"Complete"}\n\ndata: {"type":"response.completed","response":{"output":[]}}\n\n'));
  expect((await responsesAdapter.respond(ctx, true)).text).toBe('Complete');
});
