<script lang="ts">
  import { appVersion, checkForAppUpdate, downloadOfflineApp, getUpdateUrl, isOfflineApp } from '../../utils/offlineApp'
  import { IconAutorenew, IconDownload } from '../../icons'
  import './settingsActions.css'

  const offline = isOfflineApp()
  let source = $state(getUpdateUrl())
  let working = $state(false)
  let status = $state('')
  let updateAvailable = $state(false)

  async function check() {
    if (working) return
    working = true
    status = 'Checking for updates…'
    updateAvailable = false
    try {
      const result = await checkForAppUpdate(source)
      updateAvailable = result.available
      status = result.available ? 'An updated offline HTML is available.' : 'This offline HTML is up to date.'
    } catch (error) {
      status = `Could not check for updates: ${error instanceof Error ? error.message : String(error)} Check your connection and the hosted app address. If the address is correct, download a fresh copy from the hosted app.`
    } finally { working = false }
  }

  async function download() {
    if (working) return
    working = true
    status = 'Preparing offline HTML…'
    try {
      await downloadOfflineApp(source)
      status = 'Offline HTML downloaded. Open the downloaded file to use it.'
    } catch (error) {
      status = `Could not download offline HTML: ${error instanceof Error ? error.message : String(error)}`
    } finally { working = false }
  }
</script>

<section class="ui-group">
  <div class="ui-group-title">Offline app</div>
  <p class="ui-hint">Download the complete app as a single HTML file. AI providers still need an internet connection. Chats, settings, and API keys are separate; use Export all data to transfer them.</p>
  {#if offline}
    <p class="ui-hint">You are using the offline HTML. Version: {appVersion}.</p>
    <label class="ui-field">
      <span>Hosted app address</span>
      <input class="ui-input" type="url" bind:value={source} placeholder="https://your-app.example/"
        aria-label="Hosted app address" disabled={working} oninput={() => { updateAvailable = false; status = '' }} />
    </label>
    <p class="ui-hint">Updates are checked only when you press the button. Export your data before replacing the file; browser storage for local files can vary.</p>
  {/if}
  <div class="settings-actions">
    <button type="button" class="settings-action-btn" onclick={download} disabled={working || !source.trim()}>
      <IconDownload style="font-size: 20px;" />
      <span>{updateAvailable ? 'Download updated offline HTML' : 'Download offline HTML'}</span>
    </button>
    {#if offline}
      <button type="button" class="settings-action-btn" onclick={check} disabled={working || !source.trim()}>
        <IconAutorenew style="font-size: 20px;" />
        <span>Check for updates</span>
      </button>
    {/if}
  </div>
  {#if status}<p class="ui-hint" role="status">{status}</p>{/if}
</section>
