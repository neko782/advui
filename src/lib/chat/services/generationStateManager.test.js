import { describe, it, expect, beforeEach } from 'vitest'
import { createGenerationStateManager } from './generationStateManager.js'

describe('GenerationStateManager', () => {
  let manager

  beforeEach(() => {
    manager = createGenerationStateManager()
  })

  describe('basic lifecycle', () => {
    it('should start inactive', () => {
      expect(manager.isGenerationActive()).toBe(false)
      expect(manager.getGenerationSequence()).toBe(0)
    })

    it('should activate on startGeneration', () => {
      const seq = manager.startGeneration()
      expect(seq).toBe(1)
      expect(manager.isGenerationActive()).toBe(true)
    })

    it('should increment sequence on each start', () => {
      expect(manager.startGeneration()).toBe(1)
      manager.completeGeneration(1)
      expect(manager.startGeneration()).toBe(2)
      manager.completeGeneration(2)
      expect(manager.startGeneration()).toBe(3)
    })

    it('should complete generation with matching sequence', () => {
      const seq = manager.startGeneration()
      expect(manager.completeGeneration(seq)).toBe(true)
      expect(manager.isGenerationActive()).toBe(false)
    })

    it('should reject completion with wrong sequence', () => {
      manager.startGeneration()
      expect(manager.completeGeneration(999)).toBe(false)
      expect(manager.isGenerationActive()).toBe(true) // still active
    })
  })

  describe('state snapshots', () => {
    it('should capture current state in snapshot', () => {
      const seq = manager.startGeneration()
      manager.setTypingVariantId(42)
      
      const snapshot = manager.getStateSnapshot()
      expect(snapshot.sequence).toBe(seq)
      expect(snapshot.typingVariantId).toBe(42)
      expect(snapshot.abortRequested).toBe(false)
    })

    it('should detect state changes via snapshot', () => {
      const seq = manager.startGeneration()
      manager.setTypingVariantId(42)
      const snapshot = manager.getStateSnapshot()

      // Change state
      manager.setTypingVariantId(100)

      // Snapshot should still have old value
      expect(snapshot.typingVariantId).toBe(42)
      expect(manager.getTypingVariantId()).toBe(100)
    })
  })

  describe('guardedUpdate', () => {
    it('should execute update when snapshot matches', () => {
      const seq = manager.startGeneration()
      manager.setTypingVariantId(42)
      const snapshot = manager.getStateSnapshot()

      let executed = false
      const result = manager.guardedUpdate(snapshot, () => {
        executed = true
        return 'success'
      })

      expect(result.applied).toBe(true)
      expect(result.result).toBe('success')
      expect(executed).toBe(true)
    })

    it('should reject update when sequence changed', () => {
      const seq1 = manager.startGeneration()
      const snapshot = manager.getStateSnapshot()
      
      manager.completeGeneration(seq1)
      manager.startGeneration() // seq = 2 now

      let executed = false
      const result = manager.guardedUpdate(snapshot, () => {
        executed = true
        return 'success'
      })

      expect(result.applied).toBe(false)
      expect(result.result).toBe(null)
      expect(executed).toBe(false)
    })

    it('should reject update when abort requested', () => {
      manager.startGeneration()
      manager.setTypingVariantId(42)
      const snapshot = manager.getStateSnapshot()

      manager.requestAbort()

      let executed = false
      const result = manager.guardedUpdate(snapshot, () => {
        executed = true
        return 'success'
      })

      expect(result.applied).toBe(false)
      expect(executed).toBe(false)
    })
  })

  describe('isSequenceValid', () => {
    it('should return true for active matching sequence', () => {
      const seq = manager.startGeneration()
      expect(manager.isSequenceValid(seq)).toBe(true)
    })

    it('should return false for wrong sequence', () => {
      manager.startGeneration()
      expect(manager.isSequenceValid(999)).toBe(false)
    })

    it('should return false after abort', () => {
      const seq = manager.startGeneration()
      manager.requestAbort()
      expect(manager.isSequenceValid(seq)).toBe(false)
    })

    it('should return false when inactive', () => {
      const seq = manager.startGeneration()
      manager.completeGeneration(seq)
      expect(manager.isSequenceValid(seq)).toBe(false)
    })
  })

  describe('abort handling', () => {
    it('should execute abort handler immediately', () => {
      manager.startGeneration()
      let aborted = false
      manager.registerAbortHandler(() => { aborted = true })
      
      expect(manager.requestAbort()).toBe(true)
      expect(aborted).toBe(true)
    })

    it('should execute abort handler on register if already requested', () => {
      manager.startGeneration()
      manager.requestAbort()

      let aborted = false
      manager.registerAbortHandler(() => { aborted = true })
      
      expect(aborted).toBe(true)
    })

    it('should only execute abort handler once', () => {
      manager.startGeneration()
      let count = 0
      manager.registerAbortHandler(() => { count++ })
      
      manager.requestAbort()
      manager.requestAbort() // second call
      
      expect(count).toBe(1)
    })

    it('should increment state version on abort', () => {
      manager.startGeneration()
      const v1 = manager.getStateVersion()
      manager.requestAbort()
      const v2 = manager.getStateVersion()
      expect(v2).toBeGreaterThan(v1)
    })
  })

  describe('typing variant tracking', () => {
    it('should track typing variant ID', () => {
      expect(manager.getTypingVariantId()).toBe(null)
      manager.setTypingVariantId(123)
      expect(manager.getTypingVariantId()).toBe(123)
    })

    it('should clear on reset', () => {
      manager.setTypingVariantId(123)
      manager.reset()
      expect(manager.getTypingVariantId()).toBe(null)
    })
  })

  describe('state version', () => {
    it('should increment on startGeneration', () => {
      const v1 = manager.getStateVersion()
      manager.startGeneration()
      expect(manager.getStateVersion()).toBeGreaterThan(v1)
    })

    it('should increment on manual call', () => {
      const v1 = manager.getStateVersion()
      manager.incrementStateVersion()
      expect(manager.getStateVersion()).toBeGreaterThan(v1)
    })
  })
})
