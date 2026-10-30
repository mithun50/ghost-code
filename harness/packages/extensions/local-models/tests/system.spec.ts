import { describe, expect, it } from 'vitest'
import { CATALOG, catalogModel, modelUrl, runtimeAsset } from '../src/catalog.ts'
import { bandwidthFrom, estimateTps, fitOf, ramNeed, recommend, TARGET_TPS } from '../src/system.ts'
import type { SystemInfo } from '../src/types.ts'

const GB = 1024 ** 3

function machine(freeGb: number, totalGb = 16): SystemInfo {
  return { platform: 'win32', arch: 'x64', cpu: 'test', threads: 18, totalRam: totalGb * GB, freeRam: freeGb * GB, gpus: [] }
}

describe('catalog', () => {
  it('pins every model by revision, size and digest', () => {
    const ids = new Set<string>()
    for (const model of CATALOG) {
      expect(ids.has(model.id)).toBe(false)
      ids.add(model.id)
      expect(model.revision).toMatch(/^[0-9a-f]{40}$/)
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(model.size).toBeGreaterThan(100_000_000)
      expect(model.activeFraction).toBeGreaterThan(0)
      expect(model.activeFraction).toBeLessThanOrEqual(1)
      expect(modelUrl(model)).toBe(`https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file}`)
    }
  })

  it('offers 1-bit and 2-bit models and a sub-gigabyte starter', () => {
    expect(CATALOG.some(model => model.bits === '1-bit')).toBe(true)
    expect(CATALOG.some(model => model.bits === '2-bit')).toBe(true)
    expect(CATALOG.some(model => model.size < GB)).toBe(true)
    expect(catalogModel('qwen3.5-0.8b')?.file).toBe('Qwen3.5-0.8B-Q4_K_M.gguf')
    expect(catalogModel('missing')).toBeUndefined()
  })

  it('has a pinned llama.cpp build for this platform', () => {
    const found = runtimeAsset()
    if (['win32-x64', 'win32-arm64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'].includes(`${process.platform}-${process.arch}`)) {
      expect(found?.asset.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(found?.url).toContain('github.com/ggml-org/llama.cpp/releases/download/')
    }
  })
})

describe('fit and speed', () => {
  const small = catalogModel('qwen3.5-0.8b')!
  const big = catalogModel('qwen3.6-35b-a3b-iq1')!
  const moe = catalogModel('qwen3.6-35b-a3b-iq1')!
  const dense = catalogModel('qwen3.5-4b-iq2')!

  it('needs more memory than the file alone', () => {
    expect(ramNeed(small)).toBeGreaterThan(small.size)
  })

  it('judges fit against free and total memory', () => {
    expect(fitOf(small, machine(4))).toBe('good')
    // Weights may take 67.5% of free RAM: a 10 GB file needs about 15 GB free.
    expect(fitOf(big, machine(4, 32))).toBe('tight')
    expect(fitOf(big, machine(4, 16))).toBe('too-big')
    expect(fitOf(big, machine(16, 32))).toBe('good')
    // The default 2B model (1.3 GB) fits a laptop with 2 GB free.
    expect(fitOf(catalogModel('qwen3.5-2b')!, machine(2))).toBe('good')
  })

  it('estimates MoE models faster than dense ones that read more bytes per token', () => {
    expect(estimateTps(moe)).toBeGreaterThan(estimateTps(dense))
  })

  it('recalibrates every estimate from one measured run', () => {
    const measured = 60
    const bandwidth = bandwidthFrom(small, measured)
    expect(estimateTps(small, bandwidth)).toBe(measured)
    // The 35B MoE reads fewer bytes per token than the dense 4B, so it predicts faster.
    expect(estimateTps(moe, bandwidth)).toBeGreaterThan(estimateTps(dense, bandwidth))
  })

  it('recommends the most capable model that fits and is fast enough', () => {
    expect(recommend([
      { id: 'weak', rank: 0, fit: 'good', tps: 90 },
      { id: 'strong', rank: 5, fit: 'good', tps: TARGET_TPS + 5 },
      { id: 'best-but-slow', rank: 6, fit: 'good', tps: 8 },
      { id: 'huge', rank: 7, fit: 'too-big', tps: 50 },
    ])).toBe('strong')
  })

  it('falls back to the most capable fitting model, and to nothing', () => {
    expect(recommend([{ id: 'a', rank: 1, fit: 'good', tps: 5 }, { id: 'b', rank: 2, fit: 'good', tps: 6 }])).toBe('b')
    expect(recommend([{ id: 'a', rank: 1, fit: 'tight', tps: 50 }])).toBeUndefined()
  })
})

describe('recommendation on a 16 GB laptop', () => {
  it('recommends the Qwen 2B coder with its draft model', () => {
    const system = machine(4)
    const rows = CATALOG.map(model => ({ id: model.id, rank: model.rank, fit: fitOf(model, system), tps: estimateTps(model) }))
    expect(recommend(rows)).toBe('qwen3.5-2b')
    expect(CATALOG.every(model => model.id.startsWith('qwen'))).toBe(true)
    expect(catalogModel('qwen3.5-2b')?.draft).toBe('qwen3.5-0.8b')
  })
})
