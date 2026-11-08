import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { deferredModule } from '../src/renderer/deferredModule'
import { warmIdleModules } from '../src/renderer/idleModules'

let stop: (() => void) | undefined
let idleCallbacks: Map<number, IdleRequestCallback>
let nextIdle: number
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
const idle = async (available = 20) => {
  const callbacks = [...idleCallbacks.values()]
  idleCallbacks.clear()
  for (const callback of callbacks) callback({ didTimeout: false, timeRemaining: () => available })
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers()
  idleCallbacks = new Map()
  nextIdle = 0
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
    idleCallbacks.set(++nextIdle, callback)
    return nextIdle
  }))
  vi.stubGlobal('cancelIdleCallback', vi.fn((id: number) => idleCallbacks.delete(id)))
})
afterEach(() => {
  stop?.(); stop = undefined
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

it('shares a foreground request with an import already warming and caches success', async () => {
  let finish!: (value: string) => void
  const load = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
  const module = deferredModule(load)
  stop = warmIdleModules([module])
  await vi.advanceTimersByTimeAsync(1500); await idle()
  const foreground = module()
  expect(load).toHaveBeenCalledTimes(1)
  finish('ready')
  expect(await foreground).toBe('ready')
  expect(await module()).toBe('ready')
  expect(load).toHaveBeenCalledTimes(1)
})

it('loads a requested module immediately without waiting for its background turn', async () => {
  const load = vi.fn(async () => 'requested')
  const module = deferredModule(load)
  stop = warmIdleModules([vi.fn(async () => undefined), module])
  expect(await module()).toBe('requested')
  expect(load).toHaveBeenCalledTimes(1)
  expect(idleCallbacks.size).toBe(0)
})

it('retries a failed speculative import and continues the remaining queue', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ready')
  const module = deferredModule(load)
  const second = vi.fn(async () => undefined)
  stop = warmIdleModules([module, second])
  await vi.advanceTimersByTimeAsync(1500); await idle()
  expect(await module()).toBe('ready')
  await vi.advanceTimersByTimeAsync(1500); await idle()
  expect(load).toHaveBeenCalledTimes(2)
  expect(second).toHaveBeenCalledTimes(1)
})

it('does not overlap imports and waits a fresh gap after completion', async () => {
  let finish!: () => void
  const first = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const second = vi.fn(async () => undefined)
  stop = warmIdleModules([first, second])
  await vi.advanceTimersByTimeAsync(1499)
  expect(first).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1); await idle()
  await vi.advanceTimersByTimeAsync(6000); await idle()
  expect(second).not.toHaveBeenCalled()
  finish(); await flush()
  await vi.advanceTimersByTimeAsync(1499); await idle()
  expect(second).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1); await idle()
  expect(second).toHaveBeenCalledTimes(1)
})

it('postpones warming during input and when the idle budget is small', async () => {
  const task = vi.fn(async () => undefined)
  stop = warmIdleModules([task])
  await vi.advanceTimersByTimeAsync(1400)
  document.dispatchEvent(new Event('input', { bubbles: true }))
  await vi.advanceTimersByTimeAsync(100); await idle()
  expect(task).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1500); await idle(2)
  expect(task).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1500); await idle()
  expect(task).toHaveBeenCalledTimes(1)
})

it('does no warming while hidden and cancels pending idle work on cleanup', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  const task = vi.fn(async () => undefined)
  stop = warmIdleModules([task])
  await vi.advanceTimersByTimeAsync(1500); await idle()
  expect(task).not.toHaveBeenCalled()
  visibility.mockReturnValue('visible')
  await vi.advanceTimersByTimeAsync(1500)
  expect(idleCallbacks.size).toBe(1)
  stop()
  await idle(); await vi.advanceTimersByTimeAsync(6000)
  expect(task).not.toHaveBeenCalled()
})

it('does not schedule another import after cancellation during an active import', async () => {
  let finish!: () => void
  const first = () => new Promise<void>(resolve => { finish = resolve })
  const second = vi.fn(async () => undefined)
  stop = warmIdleModules([first, second])
  await vi.advanceTimersByTimeAsync(1500); await idle()
  stop(); finish(); await flush()
  await vi.advanceTimersByTimeAsync(6000); await idle()
  expect(second).not.toHaveBeenCalled()
})

it('keeps the quiet delay in browsers without idle callbacks', async () => {
  vi.stubGlobal('requestIdleCallback', undefined)
  const task = vi.fn(async () => undefined)
  stop = warmIdleModules([task])
  await vi.advanceTimersByTimeAsync(1500)
  expect(task).toHaveBeenCalledTimes(1)
})
