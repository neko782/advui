<script lang="ts">
  import SettingsModal from '../../../SettingsModal.svelte'
  let open = $state(false)
  export function show() { open = true }
</script>
<SettingsModal {open} onClose={() => { open = false }} />
