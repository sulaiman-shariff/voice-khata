import { describe, expect, it } from 'vitest'
import { cleanRows } from './vision.js'

describe('ledger photo rows', () => {
  it('keeps named rows with a positive amount; paid means advance; unsure is kept', () => {
    expect(cleanRows([
      { name: ' Ramesh ', amount: 500 },
      { name: 'Suresh', amount: 1200.456, paid: true },
      { name: 'गीता', amount: 150, unsure: true },
      { name: '', amount: 90 },
      { name: 'Total', amount: 0 },
      { name: 'Huge', amount: 1e9 },
      'junk',
    ])).toEqual([
      { name: 'Ramesh', amount: 500, direction: 'credit' },
      { name: 'Suresh', amount: 1200.46, direction: 'payment' },
      { name: 'गीता', amount: 150, direction: 'credit', unsure: true },
    ])
    expect(cleanRows(null)).toEqual([])
  })
})
