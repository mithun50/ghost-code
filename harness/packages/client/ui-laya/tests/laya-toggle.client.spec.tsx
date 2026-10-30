// @vitest-environment jsdom
/** Brain button over a mocked Laya Remote: install popover, toggle, error copy. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LayaToggle, type LayaOperations, type LayaView } from '../src/client/LayaToggle.tsx'
import { en, type LayaKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: LayaKey, params?: Record<string, string>): string =>
  en[key].replace(/\{(\w+)\}/g, (_, name: string) => params?.[name] ?? '')

function ops(initial: LayaView): LayaOperations & Record<keyof LayaOperations, ReturnType<typeof vi.fn>> {
  return {
    status: vi.fn(() => Promise.resolve(initial)),
    install: vi.fn(() => Promise.resolve<LayaView>({ state: 'installing', phase: 'Downloading' })),
    enable: vi.fn(() => Promise.resolve<LayaView>({ state: 'on' })),
    disable: vi.fn(() => Promise.resolve<LayaView>({ state: 'off' })),
  }
}

describe('LayaToggle', () => {
  it('offers install from a popover when Laya is missing', async () => {
    const remote = ops({ state: 'not-installed' })
    render(<LayaToggle ops={remote} t={t} />)
    const button = await screen.findByRole('button', { name: en['button.aria.notInstalled'] })
    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: en['popover.title'] })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['popover.install'] }))
    expect(remote.install).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: en['button.aria.busy'] })).toBeTruthy()
  })

  it('turns decisions on and off', async () => {
    const remote = ops({ state: 'off' })
    render(<LayaToggle ops={remote} t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: en['button.aria.off'] }))
    expect(remote.enable).toHaveBeenCalledOnce()
    const on = await screen.findByRole('button', { name: en['button.aria.on'] })
    expect(on.textContent).toContain(en['label.on'])
    fireEvent.click(on)
    expect(remote.disable).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: en['button.aria.off'] })).toBeTruthy()
  })

  it('shows a progress bar with megabytes while the model downloads', async () => {
    const remote = ops({ state: 'installing', phase: 'Downloading the Laya model', progress: { done: 421_000_000, total: 846_195_574 } })
    render(<LayaToggle ops={remote} t={t} />)
    const bar = await screen.findByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('49')
    expect(screen.getByText('Downloading the Laya model')).toBeTruthy()
    expect(screen.getByText('401 of 807 MB (49%)')).toBeTruthy()
  })

  it('shows a moving bar while a step has no known size', async () => {
    const remote = ops({ state: 'starting', phase: 'Loading the Laya model' })
    render(<LayaToggle ops={remote} t={t} />)
    const bar = await screen.findByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    expect(screen.getByText(en['tooltip.starting'])).toBeTruthy()
  })

  it('shows the latest decision while Laya is on', async () => {
    const remote = { ...ops({ state: 'on' }), decisions: vi.fn(() => Promise.resolve([{ time: 1, hook: 'turn-stopping', question: 'done?', probability: 0.9, latencyMs: 300, action: 'stop' }])) }
    render(<LayaToggle ops={remote} t={t} />)
    expect(await screen.findByText('Laya: task done (90%, 300 ms)')).toBeTruthy()
  })

  it('names Laya in every state and shows failures with a retry', async () => {
    const remote = ops({ state: 'error', error: 'uv not found' })
    render(<LayaToggle ops={remote} t={t} />)
    const button = await screen.findByRole('button', { name: /laya error: uv not found/i })
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: en['popover.retry'] }))
    // Retry reruns install, which skips finished steps and then starts Laya.
    expect(remote.install).toHaveBeenCalledOnce()
    for (const key of ['button.aria.notInstalled', 'button.aria.off', 'button.aria.on', 'button.aria.busy', 'tooltip.error'] as const) {
      expect(en[key]).toMatch(/laya/i)
    }
    expect(Object.values(en).join(' ')).not.toMatch(/[–—]/)
  })
})
