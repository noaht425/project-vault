/// <reference lib="webworker" />

// Runs the (synchronous, CPU-bound) fight simulator off the main thread so a
// 1000-trial sweep doesn't freeze the window. Driven by `runner.ts`.

import { runSim, runSweep, type SimSetup, type SweepDim } from '@common/sim/ui'

type Req =
  | { id: number; kind: 'sim'; setup: SimSetup }
  | { id: number; kind: 'sweep'; setup: SimSetup; dim: SweepDim }

self.onmessage = (e: MessageEvent<Req>): void => {
  const msg = e.data
  try {
    const result = msg.kind === 'sim' ? runSim(msg.setup) : runSweep(msg.setup, msg.dim)
    ;(self as unknown as Worker).postMessage({ id: msg.id, ok: true, result })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
