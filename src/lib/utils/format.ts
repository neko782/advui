import type { MessageRole } from '../types/index.js';

export function formatRole(role: MessageRole): string {
  if (role === 'assistant') return 'Assistant';
  if (role === 'system') return 'System';
  return 'User';
}

