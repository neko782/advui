/**
 * Creates a generation state manager for handling abort handlers and generation lifecycle
 */
export function createGenerationStateManager() {
  let inFlightAbort = null
  let inFlightTypingVariantId = null
  let abortRequested = false
  let abortExecuted = false

  /**
   * Resets all generation state
   */
  function reset() {
    inFlightAbort = null
    inFlightTypingVariantId = null
    abortRequested = false
    abortExecuted = false
  }

  /**
   * Registers an abort handler function
   * @param {Function|null} fn - The abort handler function
   * @returns {boolean} Whether the abort was immediately triggered
   */
  function registerAbortHandler(fn) {
    inFlightAbort = (typeof fn === 'function') ? fn : null

    // If abort was already requested and not yet executed, trigger it immediately
    if (abortRequested && !abortExecuted && typeof inFlightAbort === 'function') {
      abortExecuted = true
      try {
        inFlightAbort()
      } catch {}
      return true
    }

    return false
  }

  /**
   * Requests an abort of the current generation
   * @returns {boolean} Whether an abort handler was available and called
   */
  function requestAbort() {
    abortRequested = true

    // Only execute the abort handler once
    if (abortExecuted) {
      return false
    }

    if (typeof inFlightAbort === 'function') {
      abortExecuted = true
      try {
        inFlightAbort()
        return true
      } catch {
        return false
      }
    }

    return false
  }

  /**
   * Sets the typing variant ID
   * @param {number|null} variantId
   */
  function setTypingVariantId(variantId) {
    inFlightTypingVariantId = variantId
  }

  /**
   * Gets the current typing variant ID
   * @returns {number|null}
   */
  function getTypingVariantId() {
    return inFlightTypingVariantId
  }

  /**
   * Checks if abort was requested
   * @returns {boolean}
   */
  function isAbortRequested() {
    return abortRequested
  }

  return {
    reset,
    registerAbortHandler,
    requestAbort,
    setTypingVariantId,
    getTypingVariantId,
    isAbortRequested,
  }
}