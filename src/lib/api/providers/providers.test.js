import { afterEach, expect, it, vi } from 'vitest';
import { responsesAdapter } from './responses';
import { geminiAdapter, DEFAULT_GEMINI_BASE_URL } from './gemini';
import { chatCompletionsAdapter } from './chatCompletions';
import { buildClientOptions } from '../core';
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

const sse = (...events) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
const incomplete = { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } };
it('keeps the partial reply when a stream ends at the output token limit', async () => {
  vi.stubGlobal('fetch', async () => new Response(sse({ type: 'response.output_text.delta', delta: 'Cut off' }, incomplete)));
  expect((await responsesAdapter.respond(ctx, true)).text).toBe('Cut off');
});
it.each([true, false])('explains an empty reply that hit the output token limit (streaming=%s)', async (streaming) => {
  vi.stubGlobal('fetch', async () => new Response(streaming ? sse(incomplete) : JSON.stringify(incomplete.response)));
  await expect(responsesAdapter.respond(ctx, streaming)).rejects.toThrow('max output tokens');
});
it('reports a failed non-streaming response instead of an empty reply', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ status: 'failed', error: { message: 'Model overloaded' }, output: [] })));
  await expect(responsesAdapter.respond(ctx, false)).rejects.toThrow('Model overloaded');
});
it('reports an error body returned with a success status', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'No endpoints found', code: 404 } })));
  await expect(chatCompletionsAdapter.respond(ctx, false)).rejects.toThrow('No endpoints found');
});
it.each([
  ['{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}', 'API error 401: Incorrect API key provided'],
  ['{"error":"Rate limited"}', 'API error 401: Rate limited'],
  ['{"detail":"Not authenticated"}', 'API error 401: Not authenticated'],
  ['upstream unavailable', 'API error 401: upstream unavailable'],
  ['', 'API error 401'],
])('shows the provider message for an error response (%s)', async (body, message) => {
  vi.stubGlobal('fetch', async () => new Response(body, { status: 401 }));
  await expect(chatCompletionsAdapter.respond(ctx, false)).rejects.toMatchObject({ message, status: 401 });
});
it('requests the same endpoint whether or not the base URL ends with a slash', async () => {
  expect(buildClientOptions({ apiKey: 'k', apiBaseUrl: ' https://example.test/v1// ' }).baseURL).toBe('https://example.test/v1');
});
it.each([
  [{ promptFeedback: { blockReason: 'SAFETY' } }, 'blocked the prompt (SAFETY)'],
  [{ candidates: [{ finishReason: 'RECITATION' }] }, 'stopped without a reply (RECITATION)'],
  [{ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'max output tokens'],
])('explains an empty Gemini reply: %j', async (body, message) => {
  for (const streaming of [false, true]) {
    vi.stubGlobal('fetch', async () => new Response(streaming ? sse(body) : JSON.stringify(body)));
    await expect(geminiAdapter.respond(ctx, streaming)).rejects.toThrow(message);
  }
});
it('keeps Gemini text that stopped at the token limit and skips blank messages', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Partial' }] } }] })));
  vi.stubGlobal('fetch', fetcher);
  const input = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: '' }, { role: 'user', content: 'again' }];
  expect((await geminiAdapter.respond({ ...ctx, input }, false)).text).toBe('Partial');
  expect(JSON.parse(fetcher.mock.calls[0][1].body).contents.map(c => c.parts[0].text)).toEqual(['hi', 'again']);
});
it.each([
  ['low', { thinkingLevel: 'low' }],
  ['default', undefined],
  ['xhigh', undefined], // not a Gemini level
])('sends reasoning effort %s to Gemini as a thinking level only when Gemini accepts it', async (reasoningEffort, thinkingConfig) => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })));
  vi.stubGlobal('fetch', fetcher);
  await geminiAdapter.respond({ ...ctx, params: { reasoningEffort } }, false);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig?.thinkingConfig).toEqual(thinkingConfig);
});
