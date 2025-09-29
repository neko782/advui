import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPersistenceScheduler } from './persistenceScheduler.js'

describe('createPersistenceScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('should schedule a refresh callback', async () => {
    const scheduler = createPersistenceScheduler()
    const callback = vi.fn()
    const updated = { data: 'test' }

    scheduler.scheduleRefresh(callback, updated)

    expect(callback).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    expect(callback).toHaveBeenCalledWith(updated)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('should only schedule one refresh at a time', async () => {
    const scheduler = createPersistenceScheduler()
    const callback = vi.fn()

    scheduler.scheduleRefresh(callback, { data: 'first' })
    scheduler.scheduleRefresh(callback, { data: 'second' })
    scheduler.scheduleRefresh(callback, { data: 'third' })

    await vi.runAllTimersAsync()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ data: 'first' })
  })

  it('should not schedule new refresh when one is already pending', async () => {
    const scheduler = createPersistenceScheduler()
    const callback1 = vi.fn()
    const callback2 = vi.fn()

    scheduler.scheduleRefresh(callback1, { data: 'first' })

    // Try to schedule another refresh while first is pending
    scheduler.scheduleRefresh(callback2, { data: 'second' })

    // Only first callback should be called
    await vi.runAllTimersAsync()

    expect(callback1).toHaveBeenCalledTimes(1)
    expect(callback1).toHaveBeenCalledWith({ data: 'first' })
    expect(callback2).not.toHaveBeenCalled()
  })

  it('should handle callback throwing error gracefully', async () => {
    const scheduler = createPersistenceScheduler()
    const callback = vi.fn(() => {
      throw new Error('Callback error')
    })

    scheduler.scheduleRefresh(callback, { data: 'test' })

    await expect(vi.runAllTimersAsync()).resolves.not.toThrow()

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('should handle undefined callback gracefully', async () => {
    const scheduler = createPersistenceScheduler()

    scheduler.scheduleRefresh(undefined, { data: 'test' })

    await expect(vi.runAllTimersAsync()).resolves.not.toThrow()
  })

  it('should handle null callback gracefully', async () => {
    const scheduler = createPersistenceScheduler()

    scheduler.scheduleRefresh(null, { data: 'test' })

    await expect(vi.runAllTimersAsync()).resolves.not.toThrow()
  })

  it('should allow scheduling after previous refresh completes', async () => {
    const scheduler = createPersistenceScheduler()
    const callback = vi.fn()

    scheduler.scheduleRefresh(callback, { data: 'first' })
    await vi.runAllTimersAsync()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ data: 'first' })

    callback.mockClear()

    scheduler.scheduleRefresh(callback, { data: 'second' })
    await vi.runAllTimersAsync()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ data: 'second' })
  })

  it('should cancel pending refresh', async () => {
    const scheduler = createPersistenceScheduler()
    const callback = vi.fn()

    scheduler.scheduleRefresh(callback, { data: 'test' })

    scheduler.cancel()

    await vi.runAllTimersAsync()

    expect(callback).not.toHaveBeenCalled()
  })

  it('should allow scheduling after cancel', async () => {
    const scheduler = createPersistenceScheduler()
    const callback = vi.fn()

    scheduler.scheduleRefresh(callback, { data: 'first' })
    scheduler.cancel()

    scheduler.scheduleRefresh(callback, { data: 'second' })
    await vi.runAllTimersAsync()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ data: 'second' })
  })

  it('should handle multiple cancels gracefully', () => {
    const scheduler = createPersistenceScheduler()

    expect(() => {
      scheduler.cancel()
      scheduler.cancel()
      scheduler.cancel()
    }).not.toThrow()
  })
})