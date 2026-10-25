import { afterEach, expect, it, vi } from 'vitest';
import { appVersion, checkForAppUpdate, downloadOfflineApp, getUpdateUrl, isOfflineApp, normalizeUpdateUrl, prepareOfflineHtml } from './offlineApp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.head.querySelector('meta[name="advui-update-url"]')?.remove();
});

const artifact = '<!doctype html><meta name="advui-offline" content="true"><meta name="advui-update-url" content=""><div id="app"></div><script>/* bundled app */</script>';

it('embeds the hosted subpath into the offline artifact and escapes HTML attributes', () => {
  const html = prepareOfflineHtml(artifact, 'https://example.test/chat/?secret=discarded#fragment');
  expect(html).toContain('name="advui-update-url" content="https://example.test/chat/"');
  expect(html).not.toContain('secret');
  expect(prepareOfflineHtml(artifact, 'https://example.test/a&b/')).toContain('/a&amp;b/');
  expect(normalizeUpdateUrl('https://example.test/chat/index.html')).toBe('https://example.test/chat/');
});

it('rejects a fallback page instead of downloading the hosted app shell as an offline file', () => {
  expect(() => prepareOfflineHtml('<html>Hosted shell</html>', 'https://example.test/')).toThrow('offline download is unavailable');
  expect(() => normalizeUpdateUrl('file:///tmp/app.html')).toThrow();
  expect(() => normalizeUpdateUrl('https://user:password@example.test/')).toThrow();
});

it('detects local HTML and reads its original update source', () => {
  vi.stubGlobal('window', { location: new URL('file:///tmp/advui-offline.html') });
  document.head.insertAdjacentHTML('beforeend', '<meta name="advui-update-url" content="https://example.test/app/">');
  expect(isOfflineApp()).toBe(true);
  expect(getUpdateUrl()).toBe('https://example.test/app/');
});

it('checks a version manifest without cookies or cached responses only when requested', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '0123456789abcdef' })));
  vi.stubGlobal('fetch', fetch);
  expect(fetch).not.toHaveBeenCalled();
  expect(await checkForAppUpdate('https://example.test/app/')).toEqual({ version: '0123456789abcdef', available: appVersion !== '0123456789abcdef' });
  expect(fetch).toHaveBeenCalledWith(new URL('https://example.test/app/version.json'), expect.objectContaining({ cache: 'no-store', credentials: 'omit' }));
});

it('reports an unchanged version and rejects malformed or failed update responses', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ version: appVersion })))
    .mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  expect((await checkForAppUpdate('https://example.test/')).available).toBe(false);
  await expect(checkForAppUpdate('https://example.test/')).rejects.toThrow('valid app version');
  await expect(checkForAppUpdate('https://example.test/')).rejects.toThrow('503');
});

it('downloads only the generated artifact and includes its update source', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(artifact)));
  let downloaded: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloaded = blob as Blob; return 'blob:test'; });
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  document.body.insertAdjacentHTML('beforeend', '<input value="private-api-key">');
  await downloadOfflineApp('https://example.test/app/');
  expect(click).toHaveBeenCalledOnce();
  const html = await downloaded!.text();
  expect(html).toContain('content="https://example.test/app/"');
  expect(html).not.toContain('private-api-key');
  await vi.runAllTimersAsync();
  expect(revoke).toHaveBeenCalledWith('blob:test');
  document.body.innerHTML = '';
});
