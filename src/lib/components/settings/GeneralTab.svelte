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

            <section class="group">
              <div class="group-title">Appearance</div>
              <label class="field">
                <span>Theme</span>
                <select
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
              <p class="hint">Choose whether to match your device setting or force a light or dark theme.</p>
            </section>
            <section class="group">
              <div class="group-title">Keyboard shortcuts</div>
              <label class="field">
                <span>Send message</span>
                <select
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
              <label class="field">
                <span>New line</span>
                <select
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
              <p class="hint">Configure keyboard shortcuts for actions in the composer. Does not apply on mobile devices.</p>
            </section>
            <section class="group">
              <div class="group-title">Data</div>
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
              <label class="switch data-media-switch" title="Include media in all-data exports">
                <input
                  type="checkbox"
                  checked={exportIncludesMedia}
                  disabled={importExportWorking}
                  onchange={(event) => (exportIncludesMedia = !!event.currentTarget.checked)}
                  aria-label="Include media in export"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Include media in export</span>
              </label>
              {#if importExportStatus}
                <p class="hint" aria-live="polite">{importExportStatus}</p>
              {:else}
                <p class="hint">Import chats, settings, and images. Export all data skips media unless enabled. {exportSizeEstimateText}</p>
              {/if}
            </section>
            <section class="group legal-group">
              <div class="group-title">Open-source notice</div>
              <p class="hint">This program is licensed under the GNU Affero General Public License, version 3 or any later version.</p>
              <p class="hint">You can access the complete corresponding source code here:</p>
              <a
                class="legal-link"
                href={SOURCE_CODE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {SOURCE_CODE_URL}
              </a>
              <p class="hint">This software is provided without warranty, to the extent permitted by law.</p>
            </section>
            <section class="group developer-group">
              <div class="group-title">Developer</div>
              <label class="switch">
                <input
                  type="checkbox"
                  bind:checked={local.debug}
                  onchange={() => persistSettings()}
                  aria-label="Debug Mode"
                />
                <span class="switch-ui" aria-hidden="true"></span>
                <span class="switch-label">Debug mode</span>
              </label>
              <p class="hint">Useless and dangerous tools used for debugging. You don't need these.</p>
            </section>

<style>
  @keyframes backdrop-fade-in {
    from { opacity: 0;
    }
    to { opacity: 1;
    }
  }
  @keyframes panel-slide-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  .field { display: grid; gap: 6px;
  }
  .field > span {
    font-size: .875rem;
    font-weight: 500;
    color: var(--muted);
  }
  select {
    flex: 1;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 11px 14px;
    background: var(--panel);
    color: var(--text);
    font: inherit;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  select:hover:not(:focus) {
    border-color: color-mix(in srgb, var(--border) 70%, var(--text) 30%);
  }
  .hint {
    color: var(--muted);
    font-size: .85rem;
    margin-top: 2px;
    line-height: 1.4;
  }
  /* API key action buttons size */
  .group {
    display: grid;
    gap: 12px;
    padding: 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    transition: border-color 0.15s ease;
  }
  .group:hover {
    border-color: color-mix(in srgb, var(--border) 80%, var(--text) 20%);
  }
  .group-title {
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: -0.01em;
    color: var(--text);
  }
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
  /* Item list for connections and presets */
  /* Reorder list with smooth transitions */
  /* Remove old drag-over highlight - items now shift visually */
  /* Mobile: always show drag handle clearly */
  /* Form section styling */
  /* Add button styling */
  /* Legacy styles kept for backward compatibility */
  /* Toggle switch */
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }
  .switch > input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none;
  }
  .switch-ui {
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 80%, var(--muted) 20%);
    position: relative;
    transition: background-color .2s ease, box-shadow .2s ease;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
  }
  .switch-ui::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.1);
    transition: transform .2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .switch:hover .switch-ui {
    background: color-mix(in srgb, var(--border) 60%, var(--muted) 40%);
  }
  :global(:root[data-theme='dark']) .switch-ui {
    background: #2a2a2a;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
  }
  :global(:root[data-theme='dark']) .switch-ui::after { background: #e6e6e6;
  }
  .switch > input:checked + .switch-ui {
    background: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .switch > input:checked + .switch-ui::after { transform: translateX(20px);
  }
  .switch-label {
    font-size: .95rem;
    font-weight: 500;
    color: var(--text);
  }
  .data-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .data-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .data-action-btn:hover:not(:disabled) {
    background: var(--panel);
    border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .data-action-btn:active:not(:disabled) {
    transform: translateY(0);
  }
  .data-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (max-width: 640px) {
    .group { padding: 16px; border-radius: 12px;
    }
    .data-actions { flex-direction: column;
    }
    .data-action-btn { width: 100%; justify-content: center;
    }
  }
  /* Smooth scrollbar styling */
  /* Reset button */
  /* Action item in message buttons list */
  /* Tools grid */
</style>
