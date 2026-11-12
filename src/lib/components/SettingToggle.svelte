<script lang="ts">
  // One row of a .ui-setting-list: what the setting does on the left,
  // a single switch on the right.
  interface Props {
    label: string
    hint?: string
    checked?: boolean
    disabled?: boolean
    ariaLabel?: string
    onChange?: (checked: boolean) => void
  }

  let { label, hint = '', checked = false, disabled = false, ariaLabel, onChange }: Props = $props()
</script>

<label class="ui-setting-row">
  <span class="ui-setting-text">
    <span class="ui-setting-name">{label}</span>
    {#if hint}<span class="ui-setting-desc">{hint}</span>{/if}
  </span>
  <span class="ui-switch">
    <input
      type="checkbox"
      {checked}
      {disabled}
      aria-label={ariaLabel ?? label}
      onchange={(event) => onChange?.(!!event.currentTarget.checked)}
    />
    <span class="ui-switch-ui" aria-hidden="true"></span>
  </span>
</label>
