/**
 * Laya decision benchmark. Starts the installed Laya sidecar, asks it the two
 * questions GhostCode asks during a turn, and scores the answers against
 * hand-labelled cases. Compares Laya with the exit-code rules the privacy guard
 * uses, and with a naive baseline.
 *
 * Run from `harness/`: node --import tsx/esm packages/extensions/laya/bench/laya-bench.ts [out.json]
 */

import { writeFileSync } from 'node:fs'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { askNoul } from '../src/client.ts'
import { DONE_QUESTION, stopState, SUCCESS_QUESTION } from '../src/hooks.ts'
import { LayaSidecar } from '../src/sidecar.ts'
import { judgeCommand } from '../../local-models/src/guard.ts'

/** Thresholds GhostCode ships with (dsh-laya Config defaults). */
const COMMAND_THRESHOLD = 0.3
const STOP_THRESHOLD = 0.5

interface CommandCase { readonly name: string, readonly command: string, readonly output: string, readonly succeeded: boolean }
interface StopCase { readonly name: string, readonly request: string, readonly reply: string, readonly done: boolean }

const COMMANDS: readonly CommandCase[] = [
  { name: 'vite build ok', command: 'npm run build', succeeded: true, output: 'vite v6.0.3 building for production...\n✓ 34 modules transformed.\ndist/index.html  0.46 kB\ndist/assets/index-4f2a.js  142.10 kB\n✓ built in 812ms\n[exit code: 0]' },
  { name: 'tsc type error', command: 'npx tsc --noEmit', succeeded: false, output: "src/app.ts(14,7): error TS2322: Type 'string' is not assignable to type 'number'.\nFound 1 error in src/app.ts:14\n[exit code: 2]" },
  { name: 'jest all pass', command: 'npm test', succeeded: true, output: 'PASS  src/cart.test.js\nPASS  src/price.test.js\nTest Suites: 2 passed, 2 total\nTests:       11 passed, 11 total\nTime:        1.84 s\n[exit code: 0]' },
  { name: 'jest one failing', command: 'npm test', succeeded: false, output: 'FAIL  src/cart.test.js\n  ● cart › applies discount\n    expect(received).toBe(expected)\n    Expected: 90\n    Received: 100\nTests:       1 failed, 10 passed, 11 total\n[exit code: 1]' },
  { name: 'pip install ok', command: 'pip install requests', succeeded: true, output: 'Collecting requests\n  Using cached requests-2.32.3-py3-none-any.whl\nInstalling collected packages: requests\nSuccessfully installed requests-2.32.3\n[exit code: 0]' },
  { name: 'python traceback', command: 'python app.py', succeeded: false, output: 'Traceback (most recent call last):\n  File "app.py", line 3, in <module>\n    import flask\nModuleNotFoundError: No module named \'flask\'\n[exit code: 1]' },
  { name: 'node script output', command: 'node scripts/report.js', succeeded: true, output: 'Read 1,204 rows from sales.csv\nTotal revenue: 48,310.75\nWrote report.json\n[exit code: 0]' },
  { name: 'missing npm script', command: 'npm run dev', succeeded: false, output: 'npm ERR! Missing script: "dev"\nnpm ERR!\nnpm ERR! To see a list of scripts, run:\nnpm ERR!   npm run\n[exit code: 1]' },
  { name: 'git commit ok', command: 'git commit -m "Add hero section"', succeeded: true, output: '[main 3f2c1ab] Add hero section\n 3 files changed, 142 insertions(+), 8 deletions(-)\n[exit code: 0]' },
  { name: 'eslint errors', command: 'npx eslint src', succeeded: false, output: "src/index.js\n  12:5  error  'total' is assigned a value but never used  no-unused-vars\n  20:1  error  Unexpected console statement              no-console\n✖ 2 problems (2 errors, 0 warnings)\n[exit code: 1]" },
  { name: 'pwsh listing', command: 'Get-ChildItem -Name', succeeded: true, output: 'index.html\nscript.js\nstyles.css\n[exit code: 0]' },
  { name: 'pwsh not recognized', command: 'pnpm build', succeeded: false, output: "pnpm : The term 'pnpm' is not recognized as the name of a cmdlet, function, script file, or operable program.\n[exit code: 1]" },
  { name: 'port in use', command: 'node server.js', succeeded: false, output: 'node:events:497\n      throw er; // Unhandled \'error\' event\nError: listen EADDRINUSE: address already in use :::3000\n[exit code: 1]' },
  { name: 'syntax check ok', command: 'node --check script.js', succeeded: true, output: '[exit code: 0]' },
  // No exit-code marker: the guard falls back to failure words, and Laya breaks the tie.
  { name: 'server ready, no exit code', command: 'npx serve .', succeeded: true, output: '   Serving!\n   - Local:    http://localhost:3000\n   - Network:  http://192.168.1.20:3000\n   Copied local address to clipboard!' },
  { name: 'deprecation warning only', command: 'npm install', succeeded: true, output: 'npm warn deprecated inflight@1.0.6: This module is not supported\nadded 214 packages, and audited 215 packages in 9s\nfound 0 vulnerabilities' },
  { name: 'curl connection refused', command: 'curl http://localhost:8080/health', succeeded: false, output: 'curl: (7) Failed to connect to localhost port 8080 after 2 ms: Couldn\'t connect to server' },
  { name: 'cannot find module', command: 'node build.mjs', succeeded: false, output: "node:internal/modules/esm/resolve:265\nError [ERR_MODULE_NOT_FOUND]: Cannot find package 'sharp' imported from build.mjs" },
  { name: 'permission denied', command: 'bash deploy.sh', succeeded: false, output: 'bash: ./deploy.sh: Permission denied' },
  { name: 'tests pass, no exit code', command: 'pytest -q', succeeded: true, output: '..........                                                    [100%]\n10 passed in 0.42s' },
]

const STOPS: readonly StopCase[] = [
  { name: 'site built and checked', done: true, request: 'Build a landing page with index.html, styles.css and script.js, then check the JS.', reply: 'Created index.html, styles.css and script.js. node --check script.js passed with no errors. Open index.html in a browser to view it.' },
  { name: 'only planned', done: false, request: 'Build a landing page with index.html, styles.css and script.js, then check the JS.', reply: 'Sure. I will start by creating index.html with a hero section, then add the styles and the script.' },
  { name: 'bug fixed, tests green', done: true, request: 'Fix the failing discount test in cart.test.js.', reply: 'The discount was applied after tax. I moved it before tax in cart.js. npm test now shows 11 passed, 0 failed.' },
  { name: 'fix written, not run', done: false, request: 'Fix the failing discount test and make sure all tests pass.', reply: 'I changed the discount order in cart.js. You can run npm test to confirm it works.' },
  { name: 'stopped on error', done: false, request: 'Install the dependencies and start the dev server.', reply: 'npm install failed with ERESOLVE could not resolve dependency tree. I have not started the server.' },
  { name: 'question answered', done: true, request: 'What does the --jinja flag do in llama-server?', reply: 'It renders prompts with the model\'s own Jinja chat template, which tool calling needs.' },
  { name: 'half the files', done: false, request: 'Create a PWA: index.html, app.js, manifest.json and a service worker.', reply: 'I created index.html and app.js. Next I will add manifest.json and sw.js.' },
  { name: 'PWA complete', done: true, request: 'Create a PWA: index.html, app.js, manifest.json and a service worker.', reply: 'Created index.html, app.js, manifest.json and sw.js. The service worker caches the app shell and is registered from app.js, so the app works offline.' },
  { name: 'asks permission instead', done: false, request: 'Rename every .jpeg file in photos/ to .jpg.', reply: 'There are 42 .jpeg files in photos/. Do you want me to rename them?' },
  { name: 'rename done', done: true, request: 'Rename every .jpeg file in photos/ to .jpg.', reply: 'Renamed 42 files in photos/ from .jpeg to .jpg. No other files were changed.' },
  { name: 'refactor claimed, nothing shown', done: false, request: 'Split utils.js into date.js and format.js and update the imports.', reply: 'Got it, that is a good idea for keeping things organized.' },
  { name: 'refactor done', done: true, request: 'Split utils.js into date.js and format.js and update the imports.', reply: 'Moved the date helpers to date.js and the formatters to format.js, updated the 6 imports, and npm run build passes.' },
]

interface Row { readonly name: string, readonly truth: boolean, readonly probability: number | undefined, readonly laya: boolean | undefined, readonly rule?: boolean, readonly latencyMs: number }

function score(rows: readonly Row[], pick: (row: Row) => boolean | undefined): { correct: number, answered: number } {
  let correct = 0, answered = 0
  for (const row of rows) {
    const verdict = pick(row)
    if (verdict === undefined) continue
    answered++
    if (verdict === row.truth) correct++
  }
  return { correct, answered }
}

const pct = (part: number, whole: number): string => whole === 0 ? '-' : `${String(Math.round((part / whole) * 100))}%`

const sidecar = new LayaSidecar(dshHomePath('laya'), { info: () => {}, warn: (m: string) => { console.error(m) } })
if (!sidecar.installed()) throw new Error('Laya is not installed; click Install Laya in GhostCode first')
const started = Date.now()
await sidecar.start()
if (sidecar.state !== 'on' || sidecar.endpoint === undefined) throw new Error(`Laya did not start: ${sidecar.error ?? sidecar.state}`)
const startMs = Date.now() - started
const endpoint = sidecar.endpoint

try {
  // One warm-up call so the first measured latency is not the model load.
  await askNoul(endpoint, 'warm up', SUCCESS_QUESTION, 30_000)
  const commandRows: Row[] = []
  for (const c of COMMANDS) {
    const outcome = await askNoul(endpoint, `Command:\n${c.command}\n\nOutput:\n${c.output}`, SUCCESS_QUESTION, 30_000)
    const p = outcome.probability
    commandRows.push({
      name: c.name, truth: c.succeeded, probability: p, latencyMs: outcome.latencyMs,
      laya: p === undefined ? undefined : p >= COMMAND_THRESHOLD,
      rule: judgeCommand(false, c.output).passed,
    })
  }
  const stopRows: Row[] = []
  for (const s of STOPS) {
    const outcome = await askNoul(endpoint, stopState(s.request, s.reply), DONE_QUESTION, 30_000)
    const p = outcome.probability
    stopRows.push({ name: s.name, truth: s.done, probability: p, latencyMs: outcome.latencyMs, laya: p === undefined ? undefined : p >= STOP_THRESHOLD })
  }

  const hasExitCode = (name: string): boolean => /\[exit code: -?\d+\]/.test(COMMANDS.find(c => c.name === name)?.output ?? '')
  const cmdLaya = score(commandRows, r => r.laya)
  const cmdRule = score(commandRows, r => r.rule)
  // What GhostCode does: the exit code decides; Laya only decides when there is none.
  const cmdShipped = score(commandRows, r => hasExitCode(r.name) ? r.rule : (r.laya ?? r.rule))
  const cmdAlwaysPass = score(commandRows, () => true)
  const noExit = commandRows.filter(r => !hasExitCode(r.name))
  const noExitLaya = score(noExit, r => r.laya)
  const noExitRule = score(noExit, r => r.rule)
  const stopLaya = score(stopRows, r => r.laya)
  const stopAlways = score(stopRows, () => true)
  const caught = stopRows.filter(r => !r.truth && r.laya === false).length
  const notDone = stopRows.filter(r => !r.truth).length
  const falseNudges = stopRows.filter(r => r.truth && r.laya === false).length
  const latencies = [...commandRows, ...stopRows].map(r => r.latencyMs).sort((a, b) => a - b)
  const median = latencies[Math.floor(latencies.length / 2)] ?? 0

  const result = {
    laya: { startMs, medianLatencyMs: median, maxLatencyMs: latencies.at(-1) ?? 0, commandThreshold: COMMAND_THRESHOLD, stopThreshold: STOP_THRESHOLD },
    commands: {
      cases: commandRows.length,
      layaAlone: cmdLaya, exitCodeRules: cmdRule, shipped: cmdShipped, alwaysPass: cmdAlwaysPass,
      noExitCode: { cases: noExit.length, laya: noExitLaya, rules: noExitRule },
    },
    stops: { cases: stopRows.length, layaAlone: stopLaya, alwaysStop: stopAlways, notDoneCaught: caught, notDone, falseNudges },
    rows: { commands: commandRows, stops: stopRows },
  }
  const out = process.argv[2]
  if (out !== undefined) writeFileSync(out, JSON.stringify(result, null, 2))

  console.log(`Laya started in ${String(startMs)} ms; median decision ${String(median)} ms, max ${String(latencies.at(-1) ?? 0)} ms`)
  console.log(`\nCommand success (${String(commandRows.length)} cases)`)
  console.log(`  Laya alone        ${pct(cmdLaya.correct, cmdLaya.answered)} (${String(cmdLaya.correct)}/${String(cmdLaya.answered)})`)
  console.log(`  Exit-code rules   ${pct(cmdRule.correct, cmdRule.answered)} (${String(cmdRule.correct)}/${String(cmdRule.answered)})`)
  console.log(`  Shipped combo     ${pct(cmdShipped.correct, cmdShipped.answered)} (${String(cmdShipped.correct)}/${String(cmdShipped.answered)})`)
  console.log(`  Always "passed"   ${pct(cmdAlwaysPass.correct, cmdAlwaysPass.answered)}`)
  console.log(`  No exit code (${String(noExit.length)}): Laya ${pct(noExitLaya.correct, noExitLaya.answered)}, rules ${pct(noExitRule.correct, noExitRule.answered)}`)
  console.log(`\nTask done? (${String(stopRows.length)} cases)`)
  console.log(`  Laya alone        ${pct(stopLaya.correct, stopLaya.answered)} (${String(stopLaya.correct)}/${String(stopLaya.answered)})`)
  console.log(`  Always "done"     ${pct(stopAlways.correct, stopAlways.answered)} (what the loop does without Laya)`)
  console.log(`  Unfinished turns caught ${String(caught)}/${String(notDone)}, finished turns wrongly nudged ${String(falseNudges)}`)
  console.log('\nPer case:')
  for (const r of [...commandRows, ...stopRows]) {
    console.log(`  ${r.laya === r.truth ? 'ok ' : 'MISS'} p=${r.probability === undefined ? '-' : r.probability.toFixed(2)} ${String(r.latencyMs).padStart(4)}ms  ${r.name}`)
  }
} finally {
  sidecar.stop()
}
