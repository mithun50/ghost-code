// Generate patients.csv: 100 rows of SYNTHETIC clinic records for the private-data demo.
// Every value is made up. Aadhaar numbers pass the Verhoeff checksum and card numbers pass Luhn
// so GhostCode's redaction treats them as real; names are random combinations, not real people.
// Run: node demo/clinic/generate.mjs  (deterministic, same file every time)
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let seed = 20261031
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = list => list[Math.floor(rand() * list.length)]
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
const digits = n => Array.from({ length: n }, () => int(0, 9)).join('')

const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
const INV = [0,4,3,2,1,5,6,7,8,9]
function aadhaar() {
  const body = String(int(2, 9)) + digits(10)
  let c = 0
  ;[...body].reverse().forEach((d, i) => { c = D[c][P[(i + 1) % 8][Number(d)]] })
  const full = body + INV[c]
  return `${full.slice(0, 4)} ${full.slice(4, 8)} ${full.slice(8)}`
}
function card() {
  const body = '4' + digits(14)
  let sum = 0
  ;[...body].reverse().forEach((ch, i) => { let d = Number(ch); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9 } sum += d })
  const full = body + String((10 - (sum % 10)) % 10)
  return full.match(/.{4}/g).join(' ')
}
const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const pan = surname => `${pick([...L])}${pick([...L])}${pick([...L])}P${surname[0]}${digits(4)}${pick([...L])}`

const FIRST_F = ['Asha', 'Priya', 'Lakshmi', 'Meera', 'Kavya', 'Divya', 'Anjali', 'Sneha', 'Pooja', 'Nandini', 'Rekha', 'Shruti']
const FIRST_M = ['Arjun', 'Rahul', 'Vikram', 'Suresh', 'Karthik', 'Rohan', 'Manoj', 'Ravi', 'Aditya', 'Naveen', 'Ganesh', 'Sanjay']
const LAST = ['Rao', 'Sharma', 'Iyer', 'Reddy', 'Nair', 'Gowda', 'Patel', 'Menon', 'Kulkarni', 'Shetty', 'Joshi', 'Hegde']
const CITIES = ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Tumakuru']
const BANKS = ['okhdfcbank', 'oksbi', 'okicici', 'ybl', 'paytm']
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']

// Built-in patterns for the model to find:
// 1. Type 2 diabetes clusters in patients over 50, most of them in Bengaluru.
// 2. Dengue and viral fever spike in the monsoon months, June to August.
// 3. Cardiology bills are the highest; most cardiology patients pay by card with insurance.
// 4. Repeat visitors: a few patients appear 2 or 3 times (same Aadhaar).
function diagnosisFor(age, month, city) {
  const monsoon = ['2026-06', '2026-07', '2026-08'].includes(month)
  if (monsoon && rand() < 0.55) return pick(['Dengue', 'Viral fever', 'Viral fever'])
  if (age > 50 && rand() < (city === 'Bengaluru' ? 0.6 : 0.3)) return 'Type 2 diabetes'
  if (age > 45 && rand() < 0.25) return 'Hypertension'
  if (age > 55 && rand() < 0.2) return 'Coronary artery disease'
  return pick(['Migraine', 'Asthma', 'Gastritis', 'Back pain', 'Thyroid disorder', 'Allergic rhinitis'])
}
const DEPT = {
  'Type 2 diabetes': 'Endocrinology', 'Thyroid disorder': 'Endocrinology', Hypertension: 'Cardiology',
  'Coronary artery disease': 'Cardiology', Dengue: 'General Medicine', 'Viral fever': 'General Medicine',
  Migraine: 'Neurology', Asthma: 'Pulmonology', 'Allergic rhinitis': 'Pulmonology', Gastritis: 'Gastroenterology', 'Back pain': 'Orthopedics',
}
const BILL = { Cardiology: [6000, 42000], Endocrinology: [1500, 6000], 'General Medicine': [800, 4500], Neurology: [2000, 8000],
  Pulmonology: [1200, 5000], Gastroenterology: [1500, 6500], Orthopedics: [1800, 9000] }

const people = []
for (let i = 0; i < 82; i++) {
  const gender = rand() < 0.5 ? 'F' : 'M'
  const first = pick(gender === 'F' ? FIRST_F : FIRST_M)
  const last = pick(LAST)
  const handle = `${first}.${last}${int(1, 99)}`.toLowerCase()
  people.push({
    name: `${first} ${last}`, gender, age: int(18, 82), city: rand() < 0.45 ? 'Bengaluru' : pick(CITIES),
    aadhaar: aadhaar(), pan: pan(last), phone: `+91 ${pick(['9', '8', '7'])}${digits(4)} ${digits(5)}`,
    email: `${handle}@mailbox.in`, upi: `${handle}@${pick(BANKS)}`, card: card(),
  })
}
const visits = people.map(p => p)
while (visits.length < 100) visits.push(pick(people.slice(0, 12)))

const rows = visits.map((p, i) => {
  const month = pick(MONTHS)
  const diagnosis = diagnosisFor(p.age, month, p.city)
  const dept = DEPT[diagnosis]
  const [lo, hi] = BILL[dept]
  const bill = Math.round(int(lo, hi) / 50) * 50
  const insured = dept === 'Cardiology' ? rand() < 0.8 : rand() < 0.35
  const method = dept === 'Cardiology' && rand() < 0.75 ? 'Card' : pick(['UPI', 'UPI', 'Cash', 'Card'])
  const sugar = diagnosis === 'Type 2 diabetes' ? int(160, 290) : int(80, 130)
  const systolic = diagnosis === 'Hypertension' || diagnosis === 'Coronary artery disease' ? int(145, 175) : int(105, 135)
  return [
    `NL-${String(1001 + i)}`, p.name, p.age, p.gender, p.city, p.aadhaar, p.pan, p.phone, p.email,
    `${month}-${String(int(1, 28)).padStart(2, '0')}`, dept, diagnosis, `${systolic}/${int(70, 95)}`, sugar,
    bill, method, method === 'UPI' ? p.upi : method === 'Card' ? p.card : '', insured ? 'Yes' : 'No',
  ]
})

const header = ['visit_id', 'name', 'age', 'gender', 'city', 'aadhaar', 'pan', 'phone', 'email', 'visit_date', 'department',
  'diagnosis', 'blood_pressure', 'fasting_sugar_mg_dl', 'bill_inr', 'payment_method', 'payment_ref', 'insured']
const csv = [header, ...rows].map(r => r.map(v => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n') + '\n'
const out = join(dirname(fileURLToPath(import.meta.url)), 'patients.csv')
writeFileSync(out, csv)
console.log(`wrote ${String(rows.length)} rows to ${out}`)
