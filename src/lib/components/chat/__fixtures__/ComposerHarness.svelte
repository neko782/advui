<script lang="ts">
  import Composer from '../Composer.svelte'
  import type { Image } from '../../../types'
  let { initialInput = '', locked = false, onFilesSelected = (_files: File[]) => {} } = $props()
  let input = $state(initialInput)
  let sent = $state('')
  let attachedImages = $state<Image[]>([])
</script>

<Composer
  {input}
  {locked}
  {attachedImages}
  onInput={(value) => { input = value }}
  onFilesSelected={(files) => {
    onFilesSelected(files)
    attachedImages = files.map((file, index) => ({ id: `${index}`, name: file.name, mimeType: file.type, data: 'aGk=' }))
  }}
  onSend={() => { sent = input; input = ''; attachedImages = [] }}
/>
<output data-testid="draft">{input}</output>
<output data-testid="sent">{sent}</output>
