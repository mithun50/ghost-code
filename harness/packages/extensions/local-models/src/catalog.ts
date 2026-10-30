/** Pinned GGUF models and llama.cpp builds GhostCode installs for local use. */

/** One downloadable model. Every byte is pinned by revision, size and SHA-256. */
export interface CatalogModel {
  readonly id: string
  readonly name: string
  readonly repo: string
  readonly revision: string
  readonly file: string
  readonly size: number
  readonly sha256: string
  readonly params: string
  readonly activeParams: string
  /** Share of the weights read for each generated token (1 for dense models). */
  readonly activeFraction: number
  readonly bits: string
  readonly quant: string
  /** Context the server opens for this model. */
  readonly contextWindow: number
  readonly license: string
  readonly notes: string
  /** Higher is more capable; ranks recommendations. */
  readonly rank: number
  /**
   * Catalog id of a smaller model from the same family that drafts tokens for
   * this one (speculative decoding). Installed alongside it; measured 23 to 30
   * tokens/s for Qwen3.5 2B on an Intel Arc laptop.
   */
  readonly draft?: string
}

/** Qwen models only, for smooth coding. Sizes and digests read from the Hugging Face API at the pinned revisions. */
export const CATALOG: readonly CatalogModel[] = [
  {
    id: 'qwen3.5-0.8b',
    name: 'Qwen3.5 0.8B',
    repo: 'unsloth/Qwen3.5-0.8B-GGUF',
    revision: '6ab461498e2023f6e3c1baea90a8f0fe38ab64d0',
    file: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    size: 532_517_120,
    sha256: 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517',
    params: '0.8B',
    activeParams: '0.8B',
    activeFraction: 1,
    bits: '4-bit',
    quant: 'Q4_K_M',
    contextWindow: 32_768,
    license: 'Apache-2.0',
    notes: 'Smallest download. Good for a first test, too weak for long tasks.',
    rank: 0,
  },
  {
    id: 'qwen3.5-2b-iq2',
    name: 'Qwen3.5 2B',
    repo: 'unsloth/Qwen3.5-2B-GGUF',
    revision: 'f6d5376be1edb4d416d56da11e5397a961aca8ae',
    file: 'Qwen3.5-2B-UD-IQ2_M.gguf',
    size: 859_857_152,
    sha256: '7df5673b6c1a8efb3b5f5988a506d991ab936b3e00ad29f94e0f75cfbf8599da',
    params: '2B',
    activeParams: '2B',
    activeFraction: 1,
    bits: '2-bit',
    quant: 'UD-IQ2_M',
    contextWindow: 32_768,
    license: 'Apache-2.0',
    notes: 'A 2B model squeezed to 2 bits, under 1 GB.',
    rank: 2,
  },
  {
    id: 'qwen3.5-2b',
    name: 'Qwen3.5 2B',
    repo: 'unsloth/Qwen3.5-2B-GGUF',
    revision: 'f6d5376be1edb4d416d56da11e5397a961aca8ae',
    file: 'Qwen3.5-2B-Q4_K_M.gguf',
    size: 1_280_835_840,
    sha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
    params: '2B',
    activeParams: '2B',
    activeFraction: 1,
    bits: '4-bit',
    quant: 'Q4_K_M',
    contextWindow: 32_768,
    license: 'Apache-2.0',
    notes: 'The default coding model. Ships with Qwen3.5 0.8B as a draft model for about 30 tokens/s on a laptop.',
    rank: 2.5,
    draft: 'qwen3.5-0.8b',
  },
  {
    id: 'qwen3.5-4b-iq2',
    name: 'Qwen3.5 4B',
    repo: 'unsloth/Qwen3.5-4B-GGUF',
    revision: 'e87f176479d0855a907a41277aca2f8ee7a09523',
    file: 'Qwen3.5-4B-UD-IQ2_XXS.gguf',
    size: 1_520_217_248,
    sha256: '4c1ba794e8d6098f4fb6482b4db6e880c80b5ee0b4c64d8668afaf9541163677',
    params: '4B',
    activeParams: '4B',
    activeFraction: 1,
    bits: '2-bit',
    quant: 'UD-IQ2_XXS',
    contextWindow: 32_768,
    license: 'Apache-2.0',
    notes: 'Best scores under 5B, at 2 bits. Dense, so slower on a CPU.',
    rank: 3,
  },
  {
    id: 'qwen3.6-35b-a3b-iq1',
    name: 'Qwen3.6 35B A3B',
    repo: 'unsloth/Qwen3.6-35B-A3B-GGUF',
    revision: 'a483e9e6cbd595906af30beda3187c2663a1118c',
    file: 'Qwen3.6-35B-A3B-UD-IQ1_M.gguf',
    size: 10_047_749_088,
    sha256: '0dc2488c89d916c5599f7c03a286cd8f37a6a75a02bc13caf41c6bac26d70c9e',
    params: '35B',
    activeParams: '3B',
    activeFraction: 3 / 35,
    bits: '1-bit',
    quant: 'UD-IQ1_M',
    contextWindow: 16_384,
    license: 'Apache-2.0',
    notes: 'The strongest coder here, at 1 bit. Needs about 12 GB free.',
    rank: 7,
  },
]

/**
 * Look up a catalog model.
 * @param id - catalog id.
 * @returns the model, or undefined for an unknown id.
 */
export function catalogModel(id: string): CatalogModel | undefined {
  return CATALOG.find(model => model.id === id)
}

/**
 * The download URL of a model's GGUF at its pinned revision.
 * @param model - catalog entry.
 * @returns the Hugging Face resolve URL.
 */
export function modelUrl(model: CatalogModel): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file}`
}

/** One llama.cpp release asset. */
export interface RuntimeAsset {
  readonly name: string
  readonly size: number
  readonly sha256: string
  /** Human name of the compute backend. */
  readonly backend: string
  /** Whether the archive wraps its files in one top-level folder. */
  readonly nested: boolean
}

/** The llama.cpp release every install uses. */
export const LLAMA_BUILD = 'b12004'
const LLAMA_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}`

/**
 * Builds keyed by `<platform>-<arch>`, plus `-cpu` variants. The Windows
 * Vulkan build also carries the CPU backends and falls back to them when no
 * Vulkan device loads, so it is the Windows default.
 */
const RUNTIMES: Readonly<Record<string, RuntimeAsset>> = {
  'win32-x64': { name: `llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`, size: 37_497_997, sha256: '1f023b6f1ddca7809ae594c0a2f604db5652340b593f92b365fbefa7302b05b8', backend: 'Vulkan', nested: false },
  'win32-x64-cpu': { name: `llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`, size: 24_556_404, sha256: '2f78eb975c93f6d6caa3e0d2eca394368e7332008cfcafec2688806903dd83fc', backend: 'CPU', nested: false },
  'win32-arm64': { name: `llama-${LLAMA_BUILD}-bin-win-cpu-arm64.zip`, size: 13_049_820, sha256: '37ece59c077b79e8d6376ce23e4bc14f93852e43e5d6964abd6a033cf53923da', backend: 'CPU', nested: false },
  'darwin-arm64': { name: `llama-${LLAMA_BUILD}-bin-macos-arm64.tar.gz`, size: 16_493_808, sha256: 'be7e862d9313a975feb705635e20cedfe7d2f9a830e521bbdc64ca1bdb1cb207', backend: 'Metal', nested: true },
  'darwin-x64': { name: `llama-${LLAMA_BUILD}-bin-macos-x64.tar.gz`, size: 12_237_615, sha256: '4215b4d876fe072d2e6027bbe2c57837a838a45f704a4b7e38460bb572272f72', backend: 'CPU', nested: true },
  'linux-x64': { name: `llama-${LLAMA_BUILD}-bin-ubuntu-x64.tar.gz`, size: 22_861_983, sha256: '49f4af38e26791e61ebec38f570e01541b1e63328981eb56f7395fb25598a1f9', backend: 'CPU', nested: true },
  'linux-arm64': { name: `llama-${LLAMA_BUILD}-bin-ubuntu-arm64.tar.gz`, size: 18_551_822, sha256: '8d6fbb5df57e56728b9493a280e0cc4edf09f04bf2c492138cc49bbf81a5bf80', backend: 'CPU', nested: true },
}

/**
 * Pick the llama.cpp build for this machine. `GHOSTCODE_LLAMA_BACKEND=cpu`
 * forces the CPU build where one exists.
 * @returns the asset key and asset, or undefined on an unsupported platform.
 */
export function runtimeAsset(): { key: string, asset: RuntimeAsset, url: string } | undefined {
  const base = `${process.platform}-${process.arch}`
  const key = process.env['GHOSTCODE_LLAMA_BACKEND'] === 'cpu' && RUNTIMES[`${base}-cpu`] !== undefined ? `${base}-cpu` : base
  const asset = RUNTIMES[key]
  return asset === undefined ? undefined : { key, asset, url: `${LLAMA_URL}/${asset.name}` }
}
