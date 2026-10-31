/** Personal data (Aadhaar, PAN, UPI, phone, email, cards) never reaches a cloud model. */
import { describe, expect, it } from 'vitest'
import { luhnValid, redactText, verhoeffValid } from '../src/egress.ts'

describe('personal data redaction', () => {
  it('redacts a patient row', () => {
    const row = 'Asha Rao,2341 2341 2346,ABCPR1234K,+91 98765 43210,asha.rao@okhdfcbank,asha@clinic.in,4111 1111 1111 1111'
    const result = redactText(row)
    expect(result.text).toBe('Asha Rao,[REDACTED:aadhaar],[REDACTED:pan],[REDACTED:phone],[REDACTED:upi-id],[REDACTED:email],[REDACTED:card-number]')
    expect(new Set(result.found)).toEqual(new Set(['aadhaar', 'pan', 'phone', 'upi-id', 'email', 'card-number']))
  })

  it('leaves ordinary numbers in code alone', () => {
    const code = 'const id = 234123412340; app.listen(8080); const ts = 1730000000000; // v1.2.3'
    expect(redactText(code)).toEqual({ text: code, found: [] })
  })

  it('keeps placeholder emails', () => {
    expect(redactText('mail dev@example.com').found).toEqual([])
  })

  it('checks Aadhaar and card checksums', () => {
    expect(verhoeffValid('234123412346')).toBe(true)
    expect(verhoeffValid('234123412340')).toBe(false)
    expect(luhnValid('4111111111111111')).toBe(true)
    expect(luhnValid('4111111111111112')).toBe(false)
  })
})
