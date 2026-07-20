<script lang="ts">
  import { onMount } from 'svelte'
  import { IconDownload, IconUpload } from '../../icons'
  import { getThemeState, setThemeMode, subscribeTheme } from '../../themeStore'
  import { estimateExportAllDataSize, exportAllData, importAllData, importChat } from '../../utils/exportImport'
  import type { ThemeState } from '../../types'
  import type { SettingsDraft } from './settingsDraft.svelte'

  interface Props {
    draft: SettingsDraft
  }

  const props: Props = $props()
  const local = $derived(props.draft.local)
  const persistSettings = () => props.draft.persist()

  const SOURCE_CODE_URL = (import.meta.env.VITE_SOURCE_CODE_URL || 'https://github.com/neko782/advui').trim()

  let themeState = $state<ThemeState>({ mode: 'system', theme: 'light' })

  onMount(() => {
    themeState = getThemeState()
    const unsubscribe = subscribeTheme((next) => {
      themeState = next
    })
    return () => {
      unsubscribe()
    }
  })

  // Import/Export state
  let importExportStatus = $state('')
  let importExportWorking = $state(false)
  let exportIncludesMedia = $state(false)
  let exportSizeEstimateText = $state('Estimating download size...')
  let exportSizeEstimateRun = 0

  $effect(() => {
    exportIncludesMedia
    refreshExportSizeEstimate()
  })

  async function handleExportAllData() {
    if (importExportWorking) return
    importExportWorking = true
    importExportStatus = exportIncludesMedia ? 'Exporting data with media...' : 'Exporting data...'
    try {
      await exportAllData({ includeMedia: exportIncludesMedia })
      importExportStatus = 'Export successful!'
      setTimeout(() => {
        importExportStatus = ''
      }, 3000)
    } catch (err) {
      console.error('Export failed:', err)
      importExportStatus = `Export failed: ${err.message}`
      setTimeout(() => {
        importExportStatus = ''
      }, 5000)
    } finally {
      importExportWorking = false
    }
  }

  async function refreshExportSizeEstimate() {
    const run = ++exportSizeEstimateRun
    exportSizeEstimateText = 'Estimating download size...'
    try {
      const estimate = await estimateExportAllDataSize({ includeMedia: exportIncludesMedia })
      if (run !== exportSizeEstimateRun) return
      const base = `Estimated download: ${formatBytes(estimate.bytes)}`
      exportSizeEstimateText = estimate.includesMedia
        ? `${base} plus media. Media size is not scanned.`
        : `${base}.`
    } catch (err) {
      if (run !== exportSizeEstimateRun) return
      console.error('Failed to estimate export size:', err)
      exportSizeEstimateText = 'Estimated download size unavailable.'
    }
  }

  function formatBytes(bytes: number) {
    const value = Number(bytes) || 0
    if (value < 1024) return `${Math.max(0, Math.round(value))} B`
    const units = ['KB', 'MB', 'GB']
    let amount = value / 1024
    let unitIndex = 0
    while (amount >= 1024 && unitIndex < units.length - 1) {
      amount /= 1024
      unitIndex++
    }
    const precision = amount >= 10 || unitIndex === 0 ? 0 : 1
    return `${amount.toFixed(precision)} ${units[unitIndex]}`
  }

  async function handleImportAllData() {
    if (importExportWorking) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.tar'
    input.onchange = async (e) => {
      const file = e.target.files?.[0]
      if (!file) return

      importExportWorking = true
      importExportStatus = 'Importing data...'
      try {
        const results = await importAllData(file)
        let msg = `Import complete: ${results.chatsImported} chats`
        if (results.imagesImported > 0) {
          msg += `, ${results.imagesImported} images`
        }
        if (results.settingsImported) {
          msg += ', settings'
        }
        if (results.errors.length > 0) {
          msg += ` (${results.errors.length} errors)`
        }
        importExportStatus = msg
        setTimeout(() => {
          importExportStatus = ''
          // Refresh the page to reload all data
          if (results.chatsImported > 0 || results.settingsImported) {
            window.location.reload()
          }
        }, 3000)
      } catch (err) {
        console.error('Import failed:', err)
        importExportStatus = `Import failed: ${err.message}`
        setTimeout(() => {
          importExportStatus = ''
        }, 5000)
      } finally {
        importExportWorking = false
      }
    }
    input.click()
  }

  async function handleImportChat() {
    if (importExportWorking) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = e.target.files?.[0]
      if (!file) return

      importExportWorking = true
      importExportStatus = 'Importing chat...'
      try {
        await importChat(file)
        importExportStatus = 'Chat imported successfully!'
        setTimeout(() => {
          importExportStatus = ''
          // Refresh the page to show the new chat
          window.location.reload()
        }, 2000)
      } catch (err) {
        console.error('Import failed:', err)
        importExportStatus = `Import failed: ${err.message}`
        setTimeout(() => {
          importExportStatus = ''
        }, 5000)
      } finally {
        importExportWorking = false
      }
    }
    input.click()
  }
</script>

            <section class="ui-group">
              <div class="ui-group-title">Appearance</div>
              <label class="ui-field">
                <span>Theme</span>
                <select
                  class="ui-select"
                  value={themeState.mode}
                  onchange={(event) => {
                    const next = event.currentTarget.value
                    themeState = setThemeMode(next)
                  }}
                  aria-label="Theme preference"
                >
                  <option value="system">System default</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <p class="ui-hint">Choose whether to match your device setting or force a light or dark theme.</p>
            </section>
            <section class="ui-group">
              <div class="ui-group-title">Keyboard shortcuts</div>
              <label class="ui-field">
                <span>Send message</span>
                <select
                  class="ui-select"
                  value={local.keybinds?.sendMessage || 'Enter'}
                  onchange={(event) => { local.keybinds = { ...local.keybinds, sendMessage: event.currentTarget.value }; persistSettings() }}
                  aria-label="Send message keybind"
                >
                  <option value="Enter">Enter</option>
                  <option value="Shift+Enter">Shift+Enter</option>
                  <option value="Ctrl+Enter">Ctrl+Enter (Cmd+Enter on Mac)</option>
                  <option value="Alt+Enter">Alt+Enter</option>
                  <option value="None">None</option>
                </select>
              </label>
              <label class="ui-field">
                <span>New line</span>
                <select
                  class="ui-select"
                  value={local.keybinds?.newLine || 'Shift+Enter'}
                  onchange={(event) => { local.keybinds = { ...local.keybinds, newLine: event.currentTarget.value }; persistSettings() }}
                  aria-label="New line keybind"
                >
                  <option value="Enter">Enter</option>
                  <option value="Shift+Enter">Shift+Enter</option>
                  <option value="Ctrl+Enter">Ctrl+Enter (Cmd+Enter on Mac)</option>
                  <option value="Alt+Enter">Alt+Enter</option>
                  <option value="None">None</option>
                </select>
              </label>
              <p class="ui-hint">Configure keyboard shortcuts for actions in the composer. Does not apply on mobile devices.</p>
            </section>
            <section class="ui-group">
              <div class="ui-group-title">Data</div>
              <div class="data-actions">
                <button
                  type="button"
                  class="data-action-btn"
                  onclick={handleImportChat}
                  disabled={importExportWorking}
                  title="Import a chat from JSON file"
                  aria-label="Import chat"
                >
                  <IconUpload style="font-size: 20px;" />
                  <span>Import chat</span>
                </button>
                <button
                  type="button"
                  class="data-action-btn"
                  onclick={handleExportAllData}
                  disabled={importExportWorking}
                  title={exportIncludesMedia ? 'Export all chats, settings, and media as an archive' : 'Export all chats and settings as an archive'}
                  aria-label="Export all data"
                >
                  <IconDownload style="font-size: 20px;" />
                  <span>Export all data</span>
                </button>
                <button
                  type="button"
                  class="data-action-btn"
                  onclick={handleImportAllData}
                  disabled={importExportWorking}
                  title="Import all data from an archive"
                  aria-label="Import all data"
                >
                  <IconUpload style="font-size: 20px;" />
                  <span>Import all data</span>
                </button>
              </div>
              <label class="ui-switch" title="Include media in all-data exports">
                <input
                  type="checkbox"
                  checked={exportIncludesMedia}
                  disabled={importExportWorking}
                  onchange={(event) => (exportIncludesMedia = !!event.currentTarget.checked)}
                  aria-label="Include media in export"
                />
                <span class="ui-switch-ui" aria-hidden="true"></span>
                <span class="ui-switch-label">Include media in export</span>
              </label>
              {#if importExportStatus}
                <p class="ui-hint" aria-live="polite">{importExportStatus}</p>
              {:else}
                <p class="ui-hint">Import chats, settings, and images. Export all data skips media unless enabled. {exportSizeEstimateText}</p>
              {/if}
            </section>
            <section class="ui-group legal-group">
              <div class="ui-group-title">Open-source notice</div>
              <p class="ui-hint">This program is licensed under the GNU Affero General Public License, version 3 or any later version.</p>
              <p class="ui-hint">You can access the complete corresponding source code here:</p>
              <a
                class="legal-link"
                href={SOURCE_CODE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {SOURCE_CODE_URL}
              </a>
              <p class="ui-hint">This software is provided without warranty, to the extent permitted by law.</p>
            </section>
            <section class="ui-group developer-group">
              <div class="ui-group-title">Developer</div>
              <label class="ui-switch">
                <input
                  type="checkbox"
                  bind:checked={local.debug}
                  onchange={() => persistSettings()}
                  aria-label="Debug Mode"
                />
                <span class="ui-switch-ui" aria-hidden="true"></span>
                <span class="ui-switch-label">Debug mode</span>
              </label>
              <p class="ui-hint">Useless and dangerous tools used for debugging. You don't need these.</p>
            </section>

<style>
  /* group/field/hint/switch/select primitives come from shared ui.css */
  .developer-group {
    background: color-mix(in srgb, var(--panel) 95%, var(--muted) 5%);
    border-style: dashed;
  }
  .legal-group {
    background: color-mix(in srgb, var(--panel) 96%, var(--accent) 4%);
  }
  .legal-link {
    color: var(--accent);
    font-size: 0.9rem;
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-all;
  }
  .legal-link:hover, .legal-link:focus-visible {
    color: color-mix(in srgb, var(--accent) 80%, var(--text) 20%);
  }
  .data-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }
  .data-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 12px var(--s4);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease), transform 100ms var(--ease);
  }
  .data-action-btn:hover:not(:disabled) {
    background: var(--hover-bg);
    border-color: color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
  }
  .data-action-btn:active:not(:disabled) {
    transform: scale(0.97);
  }
  .data-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (max-width: 640px) {
    .data-actions { flex-direction: column;
    }
    .data-action-btn { width: 100%; justify-content: center;
    }
  }
</style>
