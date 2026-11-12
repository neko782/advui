import type { McpServerConfig } from '../types/api.js';

export function normalizeMcpServerList(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return [];
  const normalized: McpServerConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const text = (field: string) => (typeof item[field] === 'string' ? (item[field] as string).trim() : '');
    const label = text('label');
    const url = text('url');
    if (!label && !url) continue;
    const server: McpServerConfig = { label, url };
    const authorization = text('authorization');
    if (authorization) server.authorization = authorization;
    const allowedTools = text('allowedTools');
    if (allowedTools) server.allowedTools = allowedTools;
    normalized.push(server);
  }
  return normalized;
}

/** Tool names from a comma- or whitespace-separated allowlist. */
export function parseMcpAllowedTools(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}
