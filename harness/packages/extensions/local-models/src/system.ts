/** Scan this computer and rank catalog models against what it can run. */

import { execFile } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import { arch, cpus, freemem, platform, totalmem } from 'node:os'
import type { CatalogModel } from './catalog.ts'
import type { ModelFit, SystemInfo } from './types.ts'

/** Runtime buffers, the context cache and the OS slack a loaded model needs beyond its file. */
const OVERHEAD_BYTES = 450 * 1_048_576
/**
 * Sustained memory bandwidth a laptop CPU reaches while decoding, before any
 * measurement. Decoding reads the active weights once per token, so speed is
 * roughly bandwidth divided by active bytes.
 */
const DEFAULT_BANDWIDTH = 25e9
/** Speed at which a model counts as fast enough for smooth coding, and gets recommended. */
export const TARGET_TPS = 25
/** Measured speed-up from drafting with the 0.8B model (23 to 29.6 tokens/s for Qwen3.5 2B). */
const DRAFT_SPEEDUP = 1.3
/**
 * Share of free RAM the model weights may take. The rest is left for the
 * context cache, GhostCode, Laya and the OS.
 */
export const WEIGHT_SHARE = 0.675

let gpuCache: Promise<readonly string[]> | undefined

/** Read GPU names once; failures leave the list empty. */
function gpus(): Promise<readonly string[]> {
  gpuCache ??= new Promise((resolve) => {
    if (process.platform === 'darwin') { resolve(process.arch === 'arm64' ? ['Apple GPU (Metal)'] : []); return }
    if (process.platform !== 'win32') { resolve([]); return }
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
      { windowsHide: true, timeout: 8000 }, (error, stdout) => {
        resolve(error === null ? stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [])
      })
  })
  return gpuCache
}

/**
 * Read RAM, CPU, GPU and free disk.
 * @param modelDir - directory whose drive holds the models.
 * @returns the scan result.
 */
export async function scanSystem(modelDir: string): Promise<SystemInfo> {
  const cores = cpus()
  let freeDisk: number | undefined
  try {
    const stats = await statfs(modelDir)
    freeDisk = stats.bavail * stats.bsize
  } catch {
    freeDisk = undefined
  }
  return {
    platform: platform(),
    arch: arch(),
    cpu: cores[0]?.model.trim() ?? 'unknown CPU',
    threads: cores.length,
    totalRam: totalmem(),
    freeRam: freemem(),
    gpus: await gpus(),
    ...freeDisk === undefined ? {} : { freeDisk },
  }
}

/**
 * Memory a model needs while loaded.
 * @param model - catalog entry.
 * @returns bytes.
 */
export function ramNeed(model: CatalogModel): number {
  return Math.round(model.size * 1.08 + OVERHEAD_BYTES)
}

/**
 * Judge a model against free and total memory. `tight` means it fits after
 * closing other apps.
 * @param model - catalog entry.
 * @param system - scan result.
 * @returns the fit.
 */
export function fitOf(model: CatalogModel, system: SystemInfo): ModelFit {
  if (model.size <= system.freeRam * WEIGHT_SHARE) return 'good'
  // Fits once other apps close and about 60% of RAM is free.
  if (model.size <= system.totalRam * 0.6 * WEIGHT_SHARE) return 'tight'
  return 'too-big'
}

/**
 * Estimate decode speed from active weight bytes.
 * @param model - catalog entry.
 * @param bandwidth - measured bytes per second, when a model has run here.
 * @returns tokens per second, rounded.
 */
export function estimateTps(model: CatalogModel, bandwidth = DEFAULT_BANDWIDTH): number {
  const base = bandwidth / (model.size * model.activeFraction)
  return Math.max(1, Math.min(150, Math.round(model.draft === undefined ? base : base * DRAFT_SPEEDUP)))
}

/**
 * Turn one measured speed into a bandwidth figure that predicts the others.
 * @param model - the model that ran.
 * @param tps - its measured tokens per second.
 * @returns bytes per second.
 */
export function bandwidthFrom(model: CatalogModel, tps: number): number {
  return tps * model.size * model.activeFraction
}

/**
 * Pick the model to recommend: the most capable one that fits now and reaches
 * {@link TARGET_TPS}, else the most capable one that fits at all.
 * @param models - catalog with fit and speed.
 * @returns the id, or undefined when nothing fits.
 */
export function recommend(models: ReadonlyArray<{ id: string, rank: number, fit: ModelFit, tps: number }>): string | undefined {
  const fitting = models.filter(model => model.fit === 'good').sort((a, b) => b.rank - a.rank)
  return (fitting.find(model => model.tps >= TARGET_TPS) ?? fitting[0])?.id
}
