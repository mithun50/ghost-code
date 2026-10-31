# Demo: private patient data, analysed on the laptop

`patients.csv` holds 100 visits to a fictional clinic. Each row has a name, Aadhaar, PAN, phone, email, UPI ID or card number, diagnosis, vitals and bill.

**Every value is synthetic.** The data comes from `generate.mjs`, which uses a fixed seed. Aadhaar numbers pass the Verhoeff checksum and card numbers pass Luhn, so they look real to a checker, but none belongs to a person. Run `node demo/clinic/generate.mjs` to rebuild the same file.

## The point

A clinic, a law firm or an accountant cannot paste this file into a cloud chatbot. GhostCode reads it with the local model, and nothing leaves the machine. If the session ever moves to a cloud model, every private field is replaced before the request is sent.

## Steps

1. Pick `GhostCode Local / Qwen3.5 2B`. The shield says `On device`. Optionally turn Wi-Fi off.
2. Set the workspace to this folder (`demo/clinic`) and send:

   > Run node analyse.mjs in this folder. It reads patients.csv, which holds private patient records, and prints only totals. Then summarise the patterns in five short bullet points with the numbers. Do not open patients.csv yourself.

3. The agent runs `analyse.mjs` in the terminal tool and summarises the totals. On the demo laptop this took about 100 seconds and every number matched the table below.
4. Open the shield. The panel shows 0 cloud requests and 0 bytes sent.

`analyse.mjs` is part of this demo kit: it only aggregates, so the model never sees a single identifier, even locally. A 2B model writing the whole analysis from scratch took over 10 minutes in testing and still had a bug, so the reliable live demo is "run and explain". With a larger local model or an escalated cloud model, ask it to write the script itself.

## Patterns in the data (to check the answer)

| Pattern | Value in patients.csv |
|---|---|
| Most common diagnosis | Type 2 diabetes, 22 of 100 visits |
| Diabetes and age | All 22 diabetes visits are patients over 50; 16 of them are in Bengaluru |
| Monsoon illness | All 18 dengue and viral fever visits fall in June, July and August |
| Most expensive department | Cardiology, average bill ₹23,007; the next highest is Orthopedics at ₹5,688 |
| Cardiology payments | 11 of 14 cardiology visits paid by card; 12 of 14 were insured |
| Payment methods | UPI 47, Card 28, Cash 25 |
| Repeat patients | 9 patients visited more than once; the most visits by one patient is 4 |

## What a cloud model would see

Shown with the same function GhostCode applies before any cloud request (`redactText` in `harness/packages/extensions/local-models/src/egress.ts`):

```text
NL-1001,Priya Reddy,69,F,Bengaluru,[REDACTED:aadhaar],[REDACTED:pan],[REDACTED:phone],[REDACTED:email],2026-09-24,Endocrinology,Type 2 diabetes,133/86,284,4450,UPI,[REDACTED:upi-id],Yes
```

Over the whole file the redaction removed 100 Aadhaar numbers, 100 PANs, 100 phone numbers, 100 emails, 47 UPI IDs and 28 card numbers. The medical fields stay, so a cloud model could still help with the analysis without learning who the patients are.

Names are not redacted: a name alone is hard to tell apart from ordinary words. The local-first default is what protects them.
