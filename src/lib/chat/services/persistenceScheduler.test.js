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

  it('should keep only the latest refresh payload while pending', async () => {
    const scheduler = createPersistenceScheduler()
    const callback = vi.fn()

    scheduler.scheduleRefresh(callback, { data: 'first' })
    scheduler.scheduleRefresh(callback, { data: 'second' })
    scheduler.scheduleRefresh(callback, { data: 'third' })

    await vi.runAllTimersAsync()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ data: 'third' })
  })

  it('should use latest callback when multiple are scheduled before flush', async () => {
    const scheduler = createPersistenceScheduler()
    const callback1 = vi.fn()
    const callback2 = vi.fn()

    scheduler.scheduleRefresh(callback1, { data: 'first' })

    // Replace pending callback before timer flush
    scheduler.scheduleRefresh(callback2, { data: 'second' })

    await vi.runAllTimersAsync()

    expect(callback1).not.toHaveBeenCalled()
    expect(callback2).toHaveBeenCalledTimes(1)
    expect(callback2).toHaveBeenCalledWith({ data: 'second' })
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
