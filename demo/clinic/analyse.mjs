// Aggregate patients.csv on this machine and print only totals, never a name or an identifier.
// Run: node analyse.mjs
import { readFileSync } from 'node:fs'

const [head, ...lines] = readFileSync(new URL('./patients.csv', import.meta.url), 'utf8').trim().split(/\r?\n/)
const cols = head.split(',')
const rows = lines.map((line) => {
  const cells = line.match(/("[^"]*"|[^,]*)(,|$)/g).map(cell => cell.replace(/,$/, '').replace(/^"|"$/g, ''))
  return Object.fromEntries(cols.map((name, i) => [name, cells[i]]))
})

const count = (key) => {
  const out = {}
  for (const row of rows) out[key(row)] = (out[key(row)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}
const print = (title, value) => console.log(`\n${title}\n${JSON.stringify(value, null, 1)}`)

console.log(`Visits: ${String(rows.length)}`)
print('Visits per diagnosis', count(r => r.diagnosis))

const bills = {}
for (const row of rows) (bills[row.department] ??= []).push(Number(row.bill_inr))
print('Average bill per department (INR)', Object.fromEntries(Object.entries(bills)
  .map(([dept, list]) => [dept, Math.round(list.reduce((a, b) => a + b, 0) / list.length)])
  .sort((a, b) => b[1] - a[1])))

const diabetes = rows.filter(r => r.diagnosis === 'Type 2 diabetes')
print('Type 2 diabetes', {
  visits: diabetes.length,
  over50: diabetes.filter(r => Number(r.age) > 50).length,
  inBengaluru: diabetes.filter(r => r.city === 'Bengaluru').length,
})

const fever = rows.filter(r => /Dengue|Viral/.test(r.diagnosis))
const monsoon = fever.filter(r => ['06', '07', '08'].includes(r.visit_date.slice(5, 7))).length
print('Dengue and viral fever', { totalVisits: fever.length, inJuneJulyAugust: monsoon, inOtherMonths: fever.length - monsoon })
print('Payment methods', count(r => r.payment_method))

const cardio = rows.filter(r => r.department === 'Cardiology')
print('Cardiology', { visits: cardio.length, paidByCard: cardio.filter(r => r.payment_method === 'Card').length, insured: cardio.filter(r => r.insured === 'Yes').length })

const perPatient = Object.values(count(r => r.aadhaar))
print('Patients', { uniquePatients: perPatient.length, patientsWithRepeatVisits: perPatient.filter(n => n > 1).length, mostVisitsByOnePatient: Math.max(...perPatient) })
