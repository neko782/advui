import { NO_API_KEY_NOTICE_TEXT } from '../../constants/index.js'

/**
 * Creates a notice manager for handling various UI notices
 */
export function createNoticeManager() {
  let dismissedNotice = ''
  let missingApiKeyNotice = ''

  /**
   * Shows the missing API key notice
   * @param {string} currentDismissed - Currently dismissed notice
   * @returns {Object} Updated state
   */
  function showMissingApiKeyNotice(currentDismissed) {
    let newDismissed = currentDismissed
    // Clear dismissed if it includes the API key notice
    if (currentDismissed && currentDismissed.includes(NO_API_KEY_NOTICE_TEXT)) {
      newDismissed = ''
    }
    return {
      dismissed: newDismissed,
      missingApiKey: NO_API_KEY_NOTICE_TEXT,
    }
  }

  /**
   * Clears the missing API key notice
   */
  function clearMissingApiKeyNotice() {
    return {
      missingApiKey: '',
    }
  }

  /**
   * Dismisses the current assembled notice
   * @param {string} assembledNotice - The assembled notice to dismiss
   * @returns {string} New dismissed notice value
   */
  function dismissNotice(assembledNotice) {
    return assembledNotice
  }

  return {
    showMissingApiKeyNotice,
    clearMissingApiKeyNotice,
    dismissNotice,
  }
}