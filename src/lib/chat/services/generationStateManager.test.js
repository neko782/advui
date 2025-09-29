import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGenerationStateManager } from './generationStateManager.js'

describe('createGenerationStateManager', () => {
  let manager

  beforeEach(() => {
    manager = createGenerationStateManager()
  })

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      const abortFn = vi.fn()

      manager.registerAbortHandler(abortFn)
      manager.setTypingVariantId(123)
      manager.requestAbort()

      manager.reset()

      expect(manager.getTypingVariantId()).toBe(null)
      expect(manager.isAbortRequested()).toBe(false)
    })
  })

  describe('registerAbortHandler', () => {
    it('should register a function as abort handler', () => {
      const abortFn = vi.fn()

      const result = manager.registerAbortHandler(abortFn)

      expect(result).toBe(false)
      expect(abortFn).not.toHaveBeenCalled()
    })

    it('should immediately call abort handler if abort was already requested', () => {
      const abortFn = vi.fn()

      manager.requestAbort()
      const result = manager.registerAbortHandler(abortFn)

      expect(result).toBe(true)
      expect(abortFn).toHaveBeenCalledTimes(1)
    })

    it('should handle non-function values gracefully', () => {
      const result = manager.registerAbortHandler(null)

      expect(result).toBe(false)
    })

    it('should handle abort handler throwing error', () => {
      const abortFn = vi.fn(() => {
        throw new Error('Abort failed')
      })

      manager.requestAbort()

      expect(() => manager.registerAbortHandler(abortFn)).not.toThrow()
      expect(abortFn).toHaveBeenCalledTimes(1)
    })

    it('should replace previous abort handler', () => {
      const abortFn1 = vi.fn()
      const abortFn2 = vi.fn()

      manager.registerAbortHandler(abortFn1)
      manager.registerAbortHandler(abortFn2)
      manager.requestAbort()

      expect(abortFn1).not.toHaveBeenCalled()
      expect(abortFn2).toHaveBeenCalledTimes(1)
    })
  })

  describe('requestAbort', () => {
    it('should set abort requested flag', () => {
      expect(manager.isAbortRequested()).toBe(false)

      manager.requestAbort()

      expect(manager.isAbortRequested()).toBe(true)
    })

    it('should call abort handler if available', () => {
      const abortFn = vi.fn()
      manager.registerAbortHandler(abortFn)

      const result = manager.requestAbort()

      expect(result).toBe(true)
      expect(abortFn).toHaveBeenCalledTimes(1)
    })

    it('should return false if no abort handler is available', () => {
      const result = manager.requestAbort()

      expect(result).toBe(false)
    })

    it('should handle abort handler throwing error', () => {
      const abortFn = vi.fn(() => {
        throw new Error('Abort failed')
      })
      manager.registerAbortHandler(abortFn)

      const result = manager.requestAbort()

      expect(result).toBe(false)
      expect(abortFn).toHaveBeenCalledTimes(1)
    })

    it('should only call abort handler once even if requested multiple times', () => {
      const abortFn = vi.fn()
      manager.registerAbortHandler(abortFn)

      manager.requestAbort()
      manager.requestAbort()
      manager.requestAbort()

      expect(abortFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('setTypingVariantId', () => {
    it('should set the typing variant ID', () => {
      manager.setTypingVariantId(123)

      expect(manager.getTypingVariantId()).toBe(123)
    })

    it('should update the typing variant ID', () => {
      manager.setTypingVariantId(123)
      manager.setTypingVariantId(456)

      expect(manager.getTypingVariantId()).toBe(456)
    })

    it('should handle null value', () => {
      manager.setTypingVariantId(123)
      manager.setTypingVariantId(null)

      expect(manager.getTypingVariantId()).toBe(null)
    })
  })

  describe('getTypingVariantId', () => {
    it('should return null initially', () => {
      expect(manager.getTypingVariantId()).toBe(null)
    })

    it('should return the set typing variant ID', () => {
      manager.setTypingVariantId(789)

      expect(manager.getTypingVariantId()).toBe(789)
    })
  })

  describe('isAbortRequested', () => {
    it('should return false initially', () => {
      expect(manager.isAbortRequested()).toBe(false)
    })

    it('should return true after abort is requested', () => {
      manager.requestAbort()

      expect(manager.isAbortRequested()).toBe(true)
    })

    it('should return false after reset', () => {
      manager.requestAbort()
      manager.reset()

      expect(manager.isAbortRequested()).toBe(false)
    })
  })

  describe('integration scenarios', () => {
    it('should handle complete generation lifecycle', () => {
      const abortFn = vi.fn()

      // Start generation
      manager.setTypingVariantId(100)
      manager.registerAbortHandler(abortFn)

      expect(manager.getTypingVariantId()).toBe(100)
      expect(manager.isAbortRequested()).toBe(false)

      // User requests abort
      manager.requestAbort()

      expect(abortFn).toHaveBeenCalledTimes(1)
      expect(manager.isAbortRequested()).toBe(true)

      // Finish generation
      manager.reset()

      expect(manager.getTypingVariantId()).toBe(null)
      expect(manager.isAbortRequested()).toBe(false)
    })

    it('should handle abort before handler registration', () => {
      const abortFn = vi.fn()

      // User requests abort before generation starts
      manager.requestAbort()

      expect(manager.isAbortRequested()).toBe(true)

      // Generation starts and registers handler
      manager.setTypingVariantId(200)
      manager.registerAbortHandler(abortFn)

      // Handler should be called immediately
      expect(abortFn).toHaveBeenCalledTimes(1)
    })
  })
})