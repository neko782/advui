import type { GenerationStateManager } from '../../types/index.js';

/**
 * Atomic state snapshot for guarded updates
 */
export interface GenerationStateSnapshot {
  sequence: number;
  typingVariantId: number | null;
  abortRequested: boolean;
}

/**
 * Creates a generation state manager for handling abort handlers and generation lifecycle
 * Provides atomic state checking to prevent race conditions
 */
export function createGenerationStateManager(): GenerationStateManager {
  let inFlightAbort: (() => void) | null = null;
  let inFlightTypingVariantId: number | null = null;
  let abortRequested = false;
  let abortExecuted = false;
  let generationActive = false;
  let generationSequence = 0;
  // Track expected nodes state version to detect mutations
  let stateVersion = 0;

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
    stateVersion++;
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
   * Gets an atomic snapshot of current state for guarded operations.
   * Use this to capture state before async operations and validate
   * the snapshot hasn't changed before applying updates.
   */
  function getStateSnapshot(): GenerationStateSnapshot {
    return {
      sequence: generationSequence,
      typingVariantId: inFlightTypingVariantId,
      abortRequested,
    };
  }

  /**
   * Atomically validates a snapshot and executes an update if valid.
   * Returns true if the update was applied, false if state changed.
   */
  function guardedUpdate<T>(
    snapshot: GenerationStateSnapshot,
    update: () => T
  ): { applied: boolean; result: T | null } {
    // Validate snapshot still matches current state
    if (
      snapshot.sequence !== generationSequence ||
      snapshot.typingVariantId !== inFlightTypingVariantId ||
      abortRequested !== snapshot.abortRequested
    ) {
      return { applied: false, result: null };
    }
    // State matches, execute update
    const result = update();
    return { applied: true, result };
  }

  /**
   * Validates that a given sequence is still the active generation.
   * More explicit than comparing sequences manually.
   */
  function isSequenceValid(sequence: number): boolean {
    return generationActive && sequence === generationSequence && !abortRequested;
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
    stateVersion++;

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

  /**
   * Gets the current state version for change detection
   */
  function getStateVersion(): number {
    return stateVersion;
  }

  /**
   * Increments state version when external mutations occur
   */
  function incrementStateVersion(): void {
    stateVersion++;
  }

  return {
    reset,
    startGeneration,
    completeGeneration,
    isGenerationActive,
    getGenerationSequence,
    getStateSnapshot,
    guardedUpdate,
    isSequenceValid,
    registerAbortHandler,
    requestAbort,
    setTypingVariantId,
    getTypingVariantId,
    isAbortRequested,
    getStateVersion,
    incrementStateVersion,
  };
}

