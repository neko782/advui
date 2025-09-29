// ID generation utilities

export function genPresetId() {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function genConnectionId() {
  return `connection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}