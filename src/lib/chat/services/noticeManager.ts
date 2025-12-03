import { NO_API_KEY_NOTICE_TEXT } from '../../constants/index.js';
import type { NoticeState, NoticeManager } from '../../types/index.js';

/**
 * Creates a notice manager for handling various UI notices
 */
export function createNoticeManager(): NoticeManager {
  /**
   * Shows the missing API key notice
   */
  function showMissingApiKeyNotice(currentDismissed: string): NoticeState {
    let newDismissed = currentDismissed;
    // Clear dismissed if it includes the API key notice
    if (currentDismissed && currentDismissed.includes(NO_API_KEY_NOTICE_TEXT)) {
      newDismissed = '';
    }
    return {
      dismissed: newDismissed,
      missingApiKey: NO_API_KEY_NOTICE_TEXT,
    };
  }

  /**
   * Clears the missing API key notice
   */
  function clearMissingApiKeyNotice(): { missingApiKey: string } {
    return {
      missingApiKey: '',
    };
  }

  /**
   * Dismisses the current assembled notice
   */
  function dismissNotice(assembledNotice: string): string {
    return assembledNotice;
  }

  return {
    showMissingApiKeyNotice,
    clearMissingApiKeyNotice,
    dismissNotice,
  };
}

