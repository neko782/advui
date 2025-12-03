// ID generation utilities

export function genPresetId(): string {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function genConnectionId(): string {
  return `connection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

