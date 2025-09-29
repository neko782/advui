import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNoticeManager } from './noticeManager.js'
import * as constants from '../../constants/index.js'

vi.mock('../../constants/index.js', () => ({
  NO_API_KEY_NOTICE_TEXT: 'No API key configured',
}))

describe('createNoticeManager', () => {
  let manager

  beforeEach(() => {
    manager = createNoticeManager()
  })

  describe('stateful behavior', () => {
    it('should manage notice state through multiple operations', () => {
      let dismissedNotice = ''
      let missingApiKeyNotice = ''

      // Show API key notice
      const show1 = manager.showMissingApiKeyNotice(dismissedNotice)
      dismissedNotice = show1.dismissed
      missingApiKeyNotice = show1.missingApiKey
      expect(missingApiKeyNotice).toBe('No API key configured')
      expect(dismissedNotice).toBe('')

      // Dismiss the assembled notice
      const assembled = missingApiKeyNotice + ' Some other notice'
      dismissedNotice = manager.dismissNotice(assembled)
      expect(dismissedNotice).toBe('No API key configured Some other notice')

      // Show API key notice again - should clear dismissed since it includes API key text
      const show2 = manager.showMissingApiKeyNotice(dismissedNotice)
      dismissedNotice = show2.dismissed
      missingApiKeyNotice = show2.missingApiKey
      expect(dismissedNotice).toBe('')
      expect(missingApiKeyNotice).toBe('No API key configured')

      // Clear API key notice
      const clear = manager.clearMissingApiKeyNotice()
      missingApiKeyNotice = clear.missingApiKey
      expect(missingApiKeyNotice).toBe('')
    })

    it('should preserve dismissed notices unrelated to API key', () => {
      let dismissedNotice = 'Unrelated warning message'
      let missingApiKeyNotice = ''

      // Show API key notice with unrelated dismissed notice
      const show = manager.showMissingApiKeyNotice(dismissedNotice)
      dismissedNotice = show.dismissed
      missingApiKeyNotice = show.missingApiKey

      expect(dismissedNotice).toBe('Unrelated warning message')
      expect(missingApiKeyNotice).toBe('No API key configured')
    })

    it('should handle dismissing multiple notices in sequence', () => {
      let dismissedNotice = ''

      // Dismiss first notice
      dismissedNotice = manager.dismissNotice('First warning')
      expect(dismissedNotice).toBe('First warning')

      // Dismiss second notice (replacing first)
      dismissedNotice = manager.dismissNotice('Second warning')
      expect(dismissedNotice).toBe('Second warning')

      // Clear dismissed by setting to empty
      dismissedNotice = ''
      expect(dismissedNotice).toBe('')
    })
  })

  describe('showMissingApiKeyNotice', () => {
    it('should clear dismissed notice if it includes API key notice text', () => {
      const currentDismissed = 'Some notice. No API key configured. Other text.'

      const result = manager.showMissingApiKeyNotice(currentDismissed)

      expect(result.dismissed).toBe('')
      expect(result.missingApiKey).toBe('No API key configured')
    })

    it('should keep dismissed notice if it does not include API key notice text', () => {
      const currentDismissed = 'Some other notice'

      const result = manager.showMissingApiKeyNotice(currentDismissed)

      expect(result.dismissed).toBe('Some other notice')
      expect(result.missingApiKey).toBe('No API key configured')
    })
  })
})