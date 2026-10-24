<script lang="ts">
  import SettingsModal from '../../../SettingsModal.svelte'
  import TavernSettingsModal from '../../tavern/TavernSettingsModal.svelte'
  import CharacterEditorModal from '../../tavern/CharacterEditorModal.svelte'
  import { makeDefaultPromptPreset } from '../../../tavern/promptPresets'
  import { normalizeCardJson } from '../../../tavern/characterCard'
  let { kind = 'normal' }: { kind?: 'normal' | 'tavern' | 'character' } = $props()
  let open = $state(false)
  const characters = { a: normalizeCardJson({ name: 'A' }), b: normalizeCardJson({ name: 'B' }) }
  let character = $state(characters.a)
  let prompts = $state([makeDefaultPromptPreset()])
  export function show(id: 'a' | 'b' = 'a') { character = characters[id]; open = true }
  export function hide() { open = false }
</script>

{#if kind === 'normal'}
  <SettingsModal {open} onClose={() => { open = false }} />
{:else if kind === 'tavern'}
  <TavernSettingsModal {open} promptPresets={prompts} selectedPromptPresetId={prompts[0]?.id}
    onSave={(next) => { prompts = next.promptPresets }} onClose={() => { open = false }} />
{:else}
  <CharacterEditorModal {open} {character} onCancel={() => { open = false }} />
{/if}
