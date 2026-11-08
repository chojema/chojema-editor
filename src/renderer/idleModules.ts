/** Warm one module per idle period, with a quiet gap between imports.
 * Import evaluation still runs on the renderer thread, not a worker.
 */
export function warmIdleModules(tasks: ReadonlyArray<() => Promise<unknown>>): () => void {
  const GAP_MS = 1500
  const QUIET_MS = 1000
  let stopped = false
  let index = 0
  let timer: number | undefined
  let idle: number | undefined
  let lastInput = performance.now()
  const activity = () => { lastInput = performance.now() }
  const events = ['keydown', 'pointerdown', 'input', 'wheel'] as const
  for (const event of events) document.addEventListener(event, activity, { capture: true, passive: true })

  const schedule = () => {
    if (!stopped && index < tasks.length) timer = window.setTimeout(waitForIdle, GAP_MS)
  }
  const run = () => {
    idle = undefined
    if (stopped) return
    if (document.visibilityState === 'hidden' || performance.now() - lastInput < QUIET_MS) {
      schedule()
      return
    }
    // A foreground request calls its loader directly and never waits for this queue.
    const task = tasks[index++]!
    void Promise.resolve().then(task).catch(() => {
      // Speculative failures must not interrupt editing; foreground can retry.
    }).finally(schedule)
  }
  function waitForIdle() {
    timer = undefined
    if (stopped) return
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback((deadline) => {
        idle = undefined
        if (deadline.timeRemaining() < 8) schedule()
        else run()
      })
    } else {
      // Browsers without idle callbacks still wait for the quiet gap.
      run()
    }
  }
  schedule()
  return () => {
    stopped = true
    if (timer !== undefined) window.clearTimeout(timer)
    if (idle !== undefined) window.cancelIdleCallback(idle)
    for (const event of events) document.removeEventListener(event, activity, true)
  }
}
