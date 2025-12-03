import type { GenerationStateManager } from '../../types/index.js';

/**
 * Creates a generation state manager for handling abort handlers and generation lifecycle
 */
export function createGenerationStateManager(): GenerationStateManager {
  let inFlightAbort: (() => void) | null = null;
  let inFlightTypingVariantId: number | null = null;
  let abortRequested = false;
  let abortExecuted = false;
  let generationActive = false;
  let generationSequence = 0;

  /**
   * Resets all generation state
   */
  function reset(): void {
    inFlightAbort = null;
    inFlightTypingVariantId = null;
    abortRequested = false;
    abortExecuted = false;
    generationActive = false;
  }

  /**
   * Starts a new generation and returns its sequence number
   */
  function startGeneration(): number {
    generationActive = true;
    generationSequence++;
    abortRequested = false;
    abortExecuted = false;
    return generationSequence;
  }

  /**
   * Marks generation as complete if the sequence matches
   */
  function completeGeneration(sequence: number): boolean {
    if (sequence !== generationSequence) {
      return false;
    }
    generationActive = false;
    return true;
  }

  /**
   * Checks if a generation is currently active
   */
  function isGenerationActive(): boolean {
    return generationActive;
  }

  /**
   * Gets the current generation sequence number
   */
  function getGenerationSequence(): number {
    return generationSequence;
  }

  /**
   * Registers an abort handler function
   */
  function registerAbortHandler(fn: (() => void) | null): boolean {
    inFlightAbort = (typeof fn === 'function') ? fn : null;

    // If abort was already requested and not yet executed, trigger it immediately
    if (abortRequested && !abortExecuted && typeof inFlightAbort === 'function') {
      abortExecuted = true;
      try {
        inFlightAbort();
      } catch {
        // Ignore abort handler errors
      }
      return true;
    }

    return false;
  }

  /**
   * Requests an abort of the current generation
   */
  function requestAbort(): boolean {
    abortRequested = true;

    // Only execute the abort handler once
    if (abortExecuted) {
      return false;
    }

    if (typeof inFlightAbort === 'function') {
      abortExecuted = true;
      try {
        inFlightAbort();
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Sets the typing variant ID
   */
  function setTypingVariantId(variantId: number | null): void {
    inFlightTypingVariantId = variantId;
  }

  /**
   * Gets the current typing variant ID
   */
  function getTypingVariantId(): number | null {
    return inFlightTypingVariantId;
  }

  /**
   * Checks if abort was requested
   */
  function isAbortRequested(): boolean {
    return abortRequested;
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
  };
}

