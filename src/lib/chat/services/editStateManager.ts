/**
 * Edit State Manager
 *
 * Manages the editing state for messages, ensuring only one message
 * can be edited at a time. Provides a hookable API for both regular
 * edits and inserts.
 */

export interface EditState {
  editingId: number | null
  editingText: string
}

export interface EditStateCallbacks {
  onEditStart?: (id: number, text: string) => void
  onEditEnd?: (id: number | null, committed: boolean) => void
  onEditBlocked?: (attemptedId: number, currentId: number) => void
}

export interface EditStateManager {
  /** Check if currently editing any message */
  isEditing: () => boolean

  /** Get the ID of the message being edited */
  getEditingId: () => number | null

  /** Get the current editing text */
  getEditingText: () => string

  /** Get the full edit state */
  getState: () => EditState

  /**
   * Try to start editing a message.
   * Returns true if editing started, false if blocked because another edit is in progress.
   */
  startEdit: (id: number, text: string) => boolean

  /**
   * Update the editing text while editing.
   * Returns false if not currently editing.
   */
  updateText: (text: string) => boolean

  /**
   * Finish editing (commit or cancel).
   * Returns the final state before clearing.
   */
  finishEdit: (committed: boolean) => EditState | null

  /**
   * Force clear the edit state (use with caution).
   * This bypasses the normal finish flow.
   */
  forceClear: () => void

  /** Set callbacks for edit events */
  setCallbacks: (callbacks: EditStateCallbacks) => void
}

export function createEditStateManager(): EditStateManager {
  let editingId: number | null = null
  let editingText = ''
  let callbacks: EditStateCallbacks = {}

  function isEditing(): boolean {
    return editingId !== null
  }

  function getEditingId(): number | null {
    return editingId
  }

  function getEditingText(): string {
    return editingText
  }

  function getState(): EditState {
    return { editingId, editingText }
  }

  function startEdit(id: number, text: string): boolean {
    // Block if already editing a different message
    if (editingId !== null && editingId !== id) {
      callbacks.onEditBlocked?.(id, editingId)
      return false
    }

    // If already editing the same message, just update text
    if (editingId === id) {
      editingText = text
      return true
    }

    // Start new edit
    editingId = id
    editingText = text
    callbacks.onEditStart?.(id, text)
    return true
  }

  function updateText(text: string): boolean {
    if (editingId === null) return false
    editingText = text
    return true
  }

  function finishEdit(committed: boolean): EditState | null {
    if (editingId === null) return null

    const finalState: EditState = { editingId, editingText }
    const id = editingId

    editingId = null
    editingText = ''

    callbacks.onEditEnd?.(id, committed)
    return finalState
  }

  function forceClear(): void {
    editingId = null
    editingText = ''
  }

  function setCallbacks(newCallbacks: EditStateCallbacks): void {
    callbacks = newCallbacks
  }

  return {
    isEditing,
    getEditingId,
    getEditingText,
    getState,
    startEdit,
    updateText,
    finishEdit,
    forceClear,
    setCallbacks,
  }
}
