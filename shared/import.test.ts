import { describe, expect, it } from 'vitest'
import { parseImport } from './import.js'

describe('parseImport (old khata, typed or read aloud)', () => {
  it('one "name amount" per line, credit by default', () => {
    expect(parseImport('Ramesh 500\nSuresh Kumar - ₹1,200\n\nगीता 150')).toEqual([
      { name: 'Ramesh', amount: 500, direction: 'credit' },
      { name: 'Suresh Kumar', amount: 1200, direction: 'credit' },
      { name: 'गीता', amount: 150, direction: 'credit' },
    ])
  })
  it('a paid word makes it an advance', () => {
    expect(parseImport('Mohan 300 jama')).toEqual([{ name: 'Mohan', amount: 300, direction: 'payment' }])
  })
  it('read aloud: several pairs in one breath, number words too', () => {
    expect(parseImport('Ramesh paanch sau Suresh 300 jama Geeta dedh sau')).toEqual([
      { name: 'Ramesh', amount: 500, direction: 'credit' },
      { name: 'Suresh', amount: 300, direction: 'payment' },
      { name: 'Geeta', amount: 150, direction: 'credit' },
    ])
  })
  it('amount first, then the name', () => {
    expect(parseImport('500 Geeta')).toEqual([{ name: 'Geeta', amount: 500, direction: 'credit' }])
  })
  it('ignores lines with no amount or no name', () => {
    expect(parseImport('page 2 total\nRamesh\n400')).toEqual([])
  })
})
