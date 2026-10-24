///<reference types="svelte" />
;
import { onMount } from 'svelte'
import { IconDownload, IconUpload } from '../../icons'
import { getThemeState, setThemeMode, subscribeTheme } from '../../themeStore'
import { estimateExportAllDataSize, exportAllData, importAllData, importChat } from '../../utils/exportImport'
import type { ThemeState } from '../../types'
import type { SettingsDraft } from './settingsDraft.svelte';
;

  interface Props {
    draft: SettingsDraft
  };function $$render() {

  
  
  
  
  
  


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
      importExportStatus = `Export failed: ${err instanceof Error ? err.message : String(err)}`
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
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      importExportWorking = true
      importExportStatus = 'Importing data...'
      try {
        const results = await importAllData(file)
        let msg = `Import complete: ${results.chatsImported} chats`
        if (results.charactersImported > 0) {
          msg += `, ${results.charactersImported} characters`
        }
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
          if (results.chatsImported > 0 || results.settingsImported || results.charactersImported > 0) {
            window.location.reload()
          }
        }, 3000)
      } catch (err) {
        console.error('Import failed:', err)
        importExportStatus = `Import failed: ${err instanceof Error ? err.message : String(err)}`
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
    input.onchange = async () => {
      const file = input.files?.[0]
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
        importExportStatus = `Import failed: ${err instanceof Error ? err.message : String(err)}`
        setTimeout(() => {
          importExportStatus = ''
        }, 5000)
      } finally {
        importExportWorking = false
      }
    }
    input.click()
  }
;
async () => {

             { svelteHTML.createElement("section", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", {});  }
                 { svelteHTML.createElement("select", {         "class":`ui-select`,"value":themeState.mode,"onchange":(event) => {
                    const next = event.currentTarget.value
                    themeState = setThemeMode(next as Parameters<typeof setThemeMode>[0])
                  },"aria-label":`Theme preference`,});
                   { svelteHTML.createElement("option", { "value":`system`,});  }
                   { svelteHTML.createElement("option", { "value":`light`,});  }
                   { svelteHTML.createElement("option", { "value":`dark`,});  }
                 }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});              }
             }
             { svelteHTML.createElement("section", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", {});  }
                 { svelteHTML.createElement("select", {         "class":`ui-select`,"value":local.keybinds?.sendMessage || 'Enter',"onchange":(event) => { local.keybinds = { ...local.keybinds, sendMessage: event.currentTarget.value }; persistSettings() },"aria-label":`Send message keybind`,});
                   { svelteHTML.createElement("option", { "value":`Enter`,});  }
                   { svelteHTML.createElement("option", { "value":`Shift+Enter`,});  }
                   { svelteHTML.createElement("option", { "value":`Ctrl+Enter`,});    }
                   { svelteHTML.createElement("option", { "value":`Alt+Enter`,});  }
                   { svelteHTML.createElement("option", { "value":`None`,});  }
                 }
               }
               { svelteHTML.createElement("label", { "class":`ui-field`,});
                 { svelteHTML.createElement("span", {});  }
                 { svelteHTML.createElement("select", {         "class":`ui-select`,"value":local.keybinds?.newLine || 'Shift+Enter',"onchange":(event) => { local.keybinds = { ...local.keybinds, newLine: event.currentTarget.value }; persistSettings() },"aria-label":`New line keybind`,});
                   { svelteHTML.createElement("option", { "value":`Enter`,});  }
                   { svelteHTML.createElement("option", { "value":`Shift+Enter`,});  }
                   { svelteHTML.createElement("option", { "value":`Ctrl+Enter`,});    }
                   { svelteHTML.createElement("option", { "value":`Alt+Enter`,});  }
                   { svelteHTML.createElement("option", { "value":`None`,});  }
                 }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});              }
             }
             { svelteHTML.createElement("section", { "class":`ui-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
               { svelteHTML.createElement("div", { "class":`data-actions`,});
                 { svelteHTML.createElement("button", {             "type":`button`,"class":`data-action-btn`,"onclick":handleImportChat,"disabled":importExportWorking,"title":`Import a chat from JSON file`,"aria-label":`Import chat`,});
                   { const $$_daolpUnocI3C = __sveltets_2_ensureComponent(IconUpload); new $$_daolpUnocI3C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                   { svelteHTML.createElement("span", {});  }
                 }
                 { svelteHTML.createElement("button", {             "type":`button`,"class":`data-action-btn`,"onclick":handleExportAllData,"disabled":importExportWorking,"title":exportIncludesMedia ? 'Export all chats, settings, and media as an archive' : 'Export all chats and settings as an archive',"aria-label":`Export all data`,});
                   { const $$_daolnwoDnocI3C = __sveltets_2_ensureComponent(IconDownload); new $$_daolnwoDnocI3C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                   { svelteHTML.createElement("span", {});   }
                 }
                 { svelteHTML.createElement("button", {             "type":`button`,"class":`data-action-btn`,"onclick":handleImportAllData,"disabled":importExportWorking,"title":`Import all data from an archive`,"aria-label":`Import all data`,});
                   { const $$_daolpUnocI3C = __sveltets_2_ensureComponent(IconUpload); new $$_daolpUnocI3C({ target: __sveltets_2_any(), props: {  "style":`font-size: 20px;`,}});}
                   { svelteHTML.createElement("span", {});   }
                 }
               }
               { svelteHTML.createElement("label", {   "class":`ui-switch`,"title":`Include media in all-data exports`,});
                 { svelteHTML.createElement("input", {           "type":`checkbox`,"checked":exportIncludesMedia,"disabled":importExportWorking,"onchange":(event) => (exportIncludesMedia = !!event.currentTarget.checked),"aria-label":`Include media in export`,});}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});    }
               }
              if(importExportStatus){
                 { svelteHTML.createElement("p", {   "class":`ui-hint`,"aria-live":`polite`,});importExportStatus; }
              }else{
                 { svelteHTML.createElement("p", { "class":`ui-hint`,});            exportSizeEstimateText; }
              }
             }
             { svelteHTML.createElement("section", { "class":`ui-group legal-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});                 }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});         }
               { svelteHTML.createElement("a", {         "class":`legal-link`,"href":SOURCE_CODE_URL,"target":`_blank`,"rel":`noopener noreferrer`,});
                SOURCE_CODE_URL;
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});            }
             }
             { svelteHTML.createElement("section", { "class":`ui-group developer-group`,});
               { svelteHTML.createElement("div", { "class":`ui-group-title`,});  }
               { svelteHTML.createElement("label", { "class":`ui-switch`,});
                 { svelteHTML.createElement("input", {         "type":`checkbox`,"bind:checked":local.debug,"onchange":() => persistSettings(),"aria-label":`Debug Mode`,});/*Ωignore_startΩ*/() => local.debug = __sveltets_2_any(null);/*Ωignore_endΩ*/}
                 { svelteHTML.createElement("span", {   "class":`ui-switch-ui`,"aria-hidden":`true`,}); }
                 { svelteHTML.createElement("span", { "class":`ui-switch-label`,});  }
               }
               { svelteHTML.createElement("p", { "class":`ui-hint`,});           }
             }


};
return { props: {} as any as Props, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const GeneralTab__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type GeneralTab__SvelteComponent_ = ReturnType<typeof GeneralTab__SvelteComponent_>;
/*Ωignore_endΩ*/export default GeneralTab__SvelteComponent_;