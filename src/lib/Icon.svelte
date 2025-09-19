<script>
  export let name = ''
  export let size = 22 // px
  export let weight = 400 // 100..700
  export let filled = false // outline vs filled
  export let grade = 0 // -50..200
  export let opticalSize = 24 // 20..48
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

