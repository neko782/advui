const OFFLINE_FILE = 'advui-offline.html';
const UPDATE_META = /<meta name="advui-update-url" content="[^"]*">/;

export const appVersion = __APP_VERSION__;

export function isOfflineApp(): boolean {
  return __OFFLINE_BUILD__ || window.location.protocol === 'file:';
}

export function normalizeUpdateUrl(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter the HTTP or HTTPS address of the hosted app.');
  }
  url.search = '';
  url.hash = '';
  if (url.pathname.endsWith('.html')) return new URL('./', url).href;
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

export function getUpdateUrl(): string {
  if (!isOfflineApp()) return new URL('./', window.location.href).href;
  return document.querySelector<HTMLMetaElement>('meta[name="advui-update-url"]')?.content || '';
}

export async function checkForAppUpdate(source: string): Promise<{ version: string; available: boolean }> {
  const url = new URL('version.json', normalizeUpdateUrl(source));
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Update check failed (HTTP ${response.status}).`);
  const manifest: unknown = await response.json();
  if (!manifest || typeof manifest !== 'object' || !('version' in manifest)
    || typeof manifest.version !== 'string' || !/^[a-f0-9]{16}$/.test(manifest.version)) {
    throw new Error('This address did not return a valid app version.');
  }
  return { version: manifest.version, available: manifest.version !== appVersion };
}

export function prepareOfflineHtml(html: string, source: string): string {
  if (!html.includes('<meta name="advui-offline" content="true">') || !UPDATE_META.test(html)) {
    throw new Error('The offline download is unavailable. Build and deploy the app first.');
  }
  const escaped = normalizeUpdateUrl(source).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return html.replace(UPDATE_META, () => `<meta name="advui-update-url" content="${escaped}">`);
}

/** Download the build artifact, never the live DOM containing user data. */
export async function downloadOfflineApp(source: string): Promise<void> {
  const base = normalizeUpdateUrl(source);
  const response = await fetch(new URL(OFFLINE_FILE, base), {
    cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Offline download failed (HTTP ${response.status}).`);
  const html = prepareOfflineHtml(await response.text(), base);
  const objectUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = OFFLINE_FILE;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
