import { describe, it, expect, vi } from 'vitest'
import { createGenerationLifecycle } from './generationLifecycle.js'

function setup() {
  const changes = []
  const lifecycle = createGenerationLifecycle({ onChange: (next) => changes.push(next.phase) })
  return { lifecycle, changes }
}

describe('generation lifecycle', () => {
  it('runs idle → generating → idle', () => {
    const { lifecycle, changes } = setup()
    expect(lifecycle.phase).toBe('idle')

    const run = lifecycle.begin({ chatId: 'a', typingVariantId: 5 })
    expect(lifecycle.phase).toBe('generating')
    expect(lifecycle.snapshot()).toMatchObject({ chatId: 'a', typingVariantId: 5, sequence: run.sequence })
    expect(run.isCurrent()).toBe(true)

    lifecycle.settle(run)
    expect(lifecycle.phase).toBe('idle')
    expect(run.isCurrent()).toBe(false)
    expect(changes).toEqual(['generating', 'idle'])
  })

  it('refuses a second run while one is generating', () => {
    const { lifecycle } = setup()
    lifecycle.begin({ chatId: 'a', typingVariantId: 1 })
    expect(lifecycle.begin({ chatId: 'a', typingVariantId: 2 })).toBeNull()
  })

  it('stop aborts the transport and discards late updates', () => {
    const { lifecycle, changes } = setup()
    const abort = vi.fn()
    const run = lifecycle.begin({ chatId: 'a', typingVariantId: 1 })
    run.setAbort(abort)

    expect(lifecycle.stop()).toBe(run)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(lifecycle.phase).toBe('stopping')
    expect(run.isCurrent()).toBe(false)

    lifecycle.settle(run)
    expect(lifecycle.phase).toBe('idle')
    expect(abort).toHaveBeenCalledTimes(1)
    expect(changes).toEqual(['generating', 'stopping', 'idle'])
  })

  it('aborts a request whose handler registers after stop', () => {
    const { lifecycle } = setup()
    const abort = vi.fn()
    const run = lifecycle.begin({ chatId: 'a', typingVariantId: 1 })
    lifecycle.stop()
    expect(abort).not.toHaveBeenCalled()

    run.setAbort(abort)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('lets a new run start while the stopped one winds down', () => {
    const { lifecycle } = setup()
    const first = lifecycle.begin({ chatId: 'a', typingVariantId: 1 })
    lifecycle.stop()

    const second = lifecycle.begin({ chatId: 'a', typingVariantId: 2 })
    expect(second).not.toBeNull()
    expect(lifecycle.phase).toBe('generating')

    // The stopped run settling late must not end the new run
    lifecycle.settle(first)
    expect(lifecycle.phase).toBe('generating')
    expect(second.isCurrent()).toBe(true)
    expect(first.isCurrent()).toBe(false)
  })

  it('stop is a no-op when idle', () => {
    const { lifecycle, changes } = setup()
    expect(lifecycle.stop()).toBeNull()
    expect(changes).toEqual([])
  })

  it('dispose aborts the run and silences notifications', () => {
    const { lifecycle, changes } = setup()
    const abort = vi.fn()
    const run = lifecycle.begin({ chatId: 'a', typingVariantId: 1 })
    run.setAbort(abort)

    lifecycle.dispose()
    expect(abort).toHaveBeenCalledTimes(1)
    expect(run.isCurrent()).toBe(false)
    lifecycle.settle(run)
    expect(lifecycle.begin({ chatId: 'a', typingVariantId: 2 })).toBeNull()
    expect(changes).toEqual(['generating'])
  })

  it('tolerates throwing abort handlers and listeners', () => {
    const lifecycle = createGenerationLifecycle({ onChange: () => { throw new Error('listener') } })
    const run = lifecycle.begin({ chatId: 'a', typingVariantId: 1 })
    run.setAbort(() => { throw new Error('abort') })
    expect(() => lifecycle.stop()).not.toThrow()
    expect(lifecycle.phase).toBe('stopping')
  })
})
