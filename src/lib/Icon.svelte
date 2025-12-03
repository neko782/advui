<script lang="ts">
  interface Props {
    name?: string
    size?: number
    weight?: number
    filled?: boolean
    grade?: number
    opticalSize?: number
  }

  let { name = '', size = 22, weight = 400, filled = false, grade = 0, opticalSize = 24 }: Props = $props()
</script>

<span
  class="icon material-symbols-rounded"
  style="font-size: {size}px; font-variation-settings: 'FILL' {filled ? 1 : 0}, 'wght' {weight}, 'GRAD' {grade}, 'opsz' {opticalSize};"
  aria-hidden="true"
>
  {name}
</span>

<style>
  .icon { line-height: 1; display: inline-block; }
</style>

