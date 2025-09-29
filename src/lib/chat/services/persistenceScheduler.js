/**
 * Creates a persistence scheduler that batches refresh callbacks
 * to avoid excessive parent updates
 */
export function createPersistenceScheduler() {
  let refreshScheduled = false
  let refreshTimer = null

  /**
   * Schedules a parent refresh callback to be called asynchronously
   * @param {Function} callback - Callback to invoke with the updated data
   * @param {any} updated - The updated data to pass to the callback
   */
  function scheduleRefresh(callback, updated) {
    if (refreshScheduled) return

    refreshScheduled = true

    if (refreshTimer) {
      clearTimeout(refreshTimer)
    }

    refreshTimer = setTimeout(() => {
      refreshScheduled = false
      refreshTimer = null
      try {
        callback?.(updated)
      } catch {}
    }, 0)
  }

  /**
   * Cancels any pending refresh
   */
  function cancel() {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    refreshScheduled = false
  }

  return {
    scheduleRefresh,
    cancel,
  }
}