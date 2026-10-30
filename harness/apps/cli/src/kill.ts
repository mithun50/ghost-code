/**
 * `ghostcode kill`: stop every GhostCode process on this machine. That is the
 * web or desktop Host, its pnpm launchers, the local llama.cpp model server
 * and the Laya sidecar. The calling shell and its parents are never touched.
 * @module @deepseek-ai/dsh/kill
 */

import { execFileSync, spawnSync } from 'node:child_process'

interface ProcessRow {
  readonly pid: number
  readonly parent: number
  readonly name: string
  readonly command: string
}

/** What each GhostCode process looks like on a command line. */
const TARGETS: ReadonlyArray<{ label: string, test: (row: ProcessRow) => boolean }> = [
  { label: 'local model server', test: row => /llama-server/i.test(row.name) || /llama-server(\.exe)?["\s]/i.test(row.command) && /local-models/i.test(row.command) },
  { label: 'Laya sidecar', test: row => /laya[.-]serve/i.test(row.command) },
  {
    label: 'GhostCode host',
    test: row => /node|pnpm|npx/i.test(row.name)
      && (/apps[\\/]cli[\\/](src|lib)[\\/]bin\.(ts|js)/i.test(row.command)
        || /(ghostcode|\bghost)\s+(web|tui|desktop|--profile)/i.test(row.command)
        || /[\\/]@deepseek-ai[\\/]dsh[\\/].*bin/i.test(row.command)),
  },
]

function listProcesses(): ProcessRow[] {
  if (process.platform === 'win32') {
    const json = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
    const parsed = JSON.parse(json) as Array<{ ProcessId: number, ParentProcessId: number, Name: string | null, CommandLine: string | null }>
    return parsed.map(row => ({ pid: row.ProcessId, parent: row.ParentProcessId, name: row.Name ?? '', command: row.CommandLine ?? '' }))
  }
  const out = execFileSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return out.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    return match === null ? [] : [{ pid: Number(match[1]), parent: Number(match[2]), name: match[3] ?? '', command: match[4] ?? '' }]
  })
}

/** This process and every ancestor, so the shell running `ghostcode kill` survives. */
function protectedPids(rows: readonly ProcessRow[]): Set<number> {
  const byPid = new Map(rows.map(row => [row.pid, row]))
  const keep = new Set<number>()
  let pid: number | undefined = process.pid
  while (pid !== undefined && pid > 0 && !keep.has(pid)) {
    keep.add(pid)
    pid = byPid.get(pid)?.parent
  }
  return keep
}

function kill(pid: number): boolean {
  if (process.platform === 'win32') {
    return spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).status === 0
  }
  try { process.kill(pid, 'SIGTERM'); return true } catch { return false }
}

/**
 * Stop every GhostCode process except the caller's own chain.
 * @returns the exit code: 0 when nothing is left running.
 */
export function runKill(): number {
  const rows = listProcesses()
  const keep = protectedPids(rows)
  const found = rows.flatMap((row) => {
    if (keep.has(row.pid)) return []
    const target = TARGETS.find(candidate => candidate.test(row))
    return target === undefined ? [] : [{ row, label: target.label }]
  })
  if (found.length === 0) {
    console.log('ghostcode kill: nothing was running.')
    return 0
  }
  // Model server and Laya first, so the Host does not restart them while it shuts down.
  found.sort((a, b) => TARGETS.findIndex(t => t.label === a.label) - TARGETS.findIndex(t => t.label === b.label))
  let failed = 0
  for (const { row, label } of found) {
    const ok = kill(row.pid)
    if (!ok && rows.some(other => other.pid === row.pid)) failed++
    console.log(`${ok ? 'stopped' : 'already gone'}: ${label} (pid ${String(row.pid)})`)
  }
  const left = listProcesses().filter(row => !keep.has(row.pid) && TARGETS.some(target => target.test(row)))
  if (left.length > 0) {
    for (const row of left) console.log(`still running: pid ${String(row.pid)} ${row.name}`)
    return 1
  }
  console.log(`ghostcode kill: stopped ${String(found.length - failed)} process${found.length - failed === 1 ? '' : 'es'}. Nothing GhostCode is running now.`)
  return 0
}
