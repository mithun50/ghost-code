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
  'popover.body': 'A small local model that checks whether a task is really done and whether commands succeeded. About 1.5 GB to download, runs on this device.',
  'popover.install': 'Install Laya',
  'popover.cancel': 'Not now',
  'popover.retry': 'Try again',
  'guard.label.local': 'On device',
  'guard.label.cloud': 'Cloud',
  'guard.label.private': 'Private',
  'guard.label.offline': 'Offline, local',
  'guard.offline': 'No internet. Every step runs on this machine, and nothing waits to reconnect to the cloud.',
  'guard.aria': 'Privacy shield: {label}',
  'guard.tip': 'Never leak, verify before escalating. Click to see what stayed on this machine.',
  'guard.title': 'Never leak, verify before escalating',
  'guard.subtitle': 'GhostCode runs locally first. Nothing leaves this machine without being cleaned, and the cloud is used only when checks prove the local answer failed.',
  'guard.route': 'Where the next request goes',
  'guard.onDevice': 'On this device',
  'guard.inCloud': 'Cloud',
  'guard.freeRam': '{gb} GB RAM free right now',
  'guard.hint1': '1. What may leave the machine',
  'guard.kept': '{secrets} secrets redacted, {files} secret files withheld, {reads} secret-file reads blocked.',
  'guard.sent': '{count} cloud requests, {size} sent in total. Every one is logged below.',
  'guard.privacyMode': 'Privacy mode: block every cloud request',
  'guard.hint2': '2. Escalate only on evidence',
  'guard.evidence': 'Checks: {passed} passed, {failed} failed. {streak} failed in a row; the cloud is used after {limit}.',
  'guard.escalated': 'Escalated on evidence. The session returns to the local model when a check passes.',
  'guard.notEscalated': 'Staying local. Hard-looking questions never escalate on their own.',
  'guard.pass': 'pass',
  'guard.fail': 'fail',
  'guard.hint3': '3. Running out of resources mid-task',
  'guard.recoveries': '{count} local recoveries: smaller model, restarted server, or a paused task. Never a silent move to the cloud.',
  'guard.laya': 'Laya decision engine',
  'guard.layaOn': 'Active',
  'guard.layaOff': 'Off',
  'guard.layaActive': 'Laya is checking this session',
  'guard.layaLast': 'Last: "{question}" {answer}, {action}, {ms} ms.',
  'guard.log': 'Egress log',
  'guard.log.cloud': 'Sent {size} to {target}: {secrets} secrets redacted, {files} files withheld.',
  'guard.log.blockedRequest': 'Blocked a cloud request (privacy mode).',
  'guard.log.blockedRead': 'Blocked reading {file} while a cloud model was active.',
  'decision.label': 'Laya: {verdict} ({percent}%, {ms} ms)',
  'decision.title': 'Last Laya decision. Question: {question}',
  'decision.stop': 'task done',
  'decision.continue': 'checking again',
  'decision.flag-failure': 'command failed',
  'decision.pass': 'command ok',
  'decision.abstain': 'unsure',
  'progress.bytes': '{done} of {total} MB ({percent}%)',
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
