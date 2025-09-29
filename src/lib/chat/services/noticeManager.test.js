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

  describe('showMissingApiKeyNotice', () => {
    it('should return missing API key notice', () => {
      const result = manager.showMissingApiKeyNotice('')

      expect(result.missingApiKey).toBe('No API key configured')
      expect(result.dismissed).toBe('')
    })

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

    it('should handle empty dismissed notice', () => {
      const result = manager.showMissingApiKeyNotice('')

      expect(result.dismissed).toBe('')
      expect(result.missingApiKey).toBe('No API key configured')
    })
  })

  describe('clearMissingApiKeyNotice', () => {
    it('should return empty missing API key notice', () => {
      const result = manager.clearMissingApiKeyNotice()

      expect(result.missingApiKey).toBe('')
    })
  })

  describe('dismissNotice', () => {
    it('should return the assembled notice as dismissed', () => {
      const assembledNotice = 'This is an assembled notice'

      const result = manager.dismissNotice(assembledNotice)

      expect(result).toBe('This is an assembled notice')
    })

    it('should handle empty assembled notice', () => {
      const result = manager.dismissNotice('')

      expect(result).toBe('')
    })

    it('should handle undefined assembled notice', () => {
      const result = manager.dismissNotice(undefined)

      expect(result).toBe(undefined)
    })
  })
})