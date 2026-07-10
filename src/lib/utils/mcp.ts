import type { McpServerConfig } from '../types/api.js';

export function normalizeMcpServerList(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return [];
  const normalized: McpServerConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!label && !url) continue;
    normalized.push({ label, url });
  }
  return normalized;
}
