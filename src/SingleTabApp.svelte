<script lang="ts">
  import { onMount } from 'svelte'
  import App from './App.svelte'
  import { acquireSingleTabLock } from './lib/utils/singleTabLock'

  let gateStatus = $state<'checking' | 'active' | 'blocked' | 'error'>('checking')
  let error = $state('')
  const lifetime = new AbortController()

  async function start() {
    gateStatus = 'checking'
    error = ''
    try {
      const release = await acquireSingleTabLock(lifetime.signal)
      if (lifetime.signal.aborted) return
      gateStatus = release ? 'active' : 'blocked'
    } catch (err) {
      if (lifetime.signal.aborted) return
      error = err instanceof Error ? err.message : String(err)
      gateStatus = 'error'
    }
  }

  onMount(() => {
    // A document restored from the back/forward cache must acquire ownership
    // again before resuming its saved chat state.
    const reloadOnRestore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload()
    }
    window.addEventListener('pageshow', reloadOnRestore)
    void start()
    return () => {
      window.removeEventListener('pageshow', reloadOnRestore)
      lifetime.abort()
    }
  })
</script>

{#if gateStatus === 'active'}
  <App />
{:else}
  <main class="tab-gate" role={gateStatus === 'checking' ? 'status' : 'alert'}>
    {#if gateStatus === 'checking'}
      <p>Opening advui…</p>
    {:else if gateStatus === 'blocked'}
      <h1>advui is already open in another tab</h1>
      <p>Use the open tab, or close it and retry here. Only one tab can use your chats at a time.</p>
      <button type="button" class="ui-btn" onclick={start}>Retry</button>
    {:else}
      <h1>Could not secure single-tab access</h1>
      <p>{error}</p>
      <button type="button" class="ui-btn" onclick={start}>Retry</button>
    {/if}
  </main>
{/if}

<style>
  .tab-gate {
    min-height: 100dvh;
    max-width: 60ch;
    margin: 0 auto;
    padding: 48px 24px;
    display: grid;
    align-content: center;
    gap: 12px;
  }
  h1 { margin: 0; font-size: 1.4rem; }
  p { margin: 0; }
  button { justify-self: start; }
</style>
