/** `laya` namespace dictionaries (the composer brain button). */

/** English copy; the key-set source of truth for this package. */
export const en = {
  'button.aria.notInstalled': 'Laya decision engine, not installed',
  'button.aria.off': 'Turn on Laya decisions',
  'button.aria.on': 'Turn off Laya decisions',
  'button.aria.busy': 'Laya is busy',
  'tooltip.off': 'Laya decisions are off. Click to turn on.',
  'tooltip.on': 'Laya decisions are on. Click to turn off.',
  'tooltip.installing': 'Installing Laya',
  'tooltip.starting': 'Starting Laya',
  'tooltip.error': 'Laya error: {message}',
  'label.on': 'Laya',
  'popover.title': 'Laya decision engine',
  'popover.body': 'A small local model that checks whether a task is really done and whether commands succeeded. About 700 MB, runs on this device.',
  'popover.install': 'Install Laya',
  'popover.cancel': 'Not now',
  'popover.retry': 'Try again',
} satisfies Record<string, string>

/** Copy key of this namespace. */
export type LayaKey = keyof typeof en

/** Other locales reuse the English copy until translated. */
export const zh: Record<LayaKey, string> = en
export const ja: Record<LayaKey, string> = en
export const es: Record<LayaKey, string> = en
export const fr: Record<LayaKey, string> = en
export const de: Record<LayaKey, string> = en
export const ru: Record<LayaKey, string> = en
export const pt: Record<LayaKey, string> = en
