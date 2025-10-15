/**
 * Creates a generation state manager for handling abort handlers and generation lifecycle
 */
export function createGenerationStateManager() {
  let inFlightAbort = null
  let inFlightTypingVariantId = null
  let abortRequested = false
  let abortExecuted = false
  let generationActive = false
  let generationSequence = 0

  /**
   * Resets all generation state
   */
  function reset() {
    inFlightAbort = null
    inFlightTypingVariantId = null
    abortRequested = false
    abortExecuted = false
    generationActive = false
  }

  /**
   * Starts a new generation and returns its sequence number
   * @returns {number} The generation sequence number
   */
  function startGeneration() {
    generationActive = true
    generationSequence++
    abortRequested = false
    abortExecuted = false
    return generationSequence
  }

  /**
   * Marks generation as complete if the sequence matches
   * @param {number} sequence - The generation sequence number
   * @returns {boolean} Whether the generation was marked complete
   */
  function completeGeneration(sequence) {
    if (sequence !== generationSequence) {
      return false
    }
    generationActive = false
    return true
  }

  /**
   * Checks if a generation is currently active
   * @returns {boolean}
   */
  function isGenerationActive() {
    return generationActive
  }

  /**
   * Gets the current generation sequence number
   * @returns {number}
   */
  function getGenerationSequence() {
    return generationSequence
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
    startGeneration,
    completeGeneration,
    isGenerationActive,
    getGenerationSequence,
    registerAbortHandler,
    requestAbort,
    setTypingVariantId,
    getTypingVariantId,
    isAbortRequested,
  }
}