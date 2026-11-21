/**
 * Matching a heard name to a customer. Getting this wrong writes money to the wrong person, so the
 * cases are about sure vs near vs ambiguous, not about the transliteration itself.
 */
import { describe, expect, it } from 'vitest'
import { NAME_NEAR, NAME_SURE, matchName, phoneticKey } from './names.js'

it.each([
  ['Ramesh', 'रमेश'], ['Ramesh', 'ರಮೇಶ್'], ['Ramesh', 'ரமேஷ்'], ['Ramesh', 'రమేష్'],
  ['Lakshmi', 'ಲಕ್ಷ್ಮಿ'], ['Geeta', 'Gita'], ['Vimla', 'Wimla'],
])('%s and %s are the same name', (a, b) => expect(phoneticKey(a)).toBe(phoneticKey(b)))

describe('matchName', () => {
  const people = [
    { id: 'c1', names: ['Ramesh', 'Ramesh doodhwale'] },
    { id: 'c2', names: ['Ramesh Kumar'] },
    { id: 'c3', names: ['Suresh'] },
    { id: 'c5', names: ['Sharma ji', 'flat 302 wale'] },
  ]

  it('the same name in another script is a sure match', () => {
    const [m] = matchName('रमेश', people)
    expect(m.id).toBe('c1')
    expect(m.score).toBeGreaterThanOrEqual(NAME_SURE)
  })

  it('a first name shared by two customers puts both in reach (the caller must ask which)', () => {
    expect(matchName('Ramesh', people).filter((m) => m.score >= NAME_NEAR).map((m) => m.id)).toEqual(expect.arrayContaining(['c1', 'c2']))
  })

  it('a rhyming name is not a sure match (Suresh is not Ramesh)', () => {
    const m = matchName('Suresh', people)
    expect(m[0].id).toBe('c3')
    expect(m.find((x) => x.id === 'c1')!.score).toBeLessThan(NAME_SURE)
  })

  it('an alias finds its customer', () => {
    expect(matchName('flat 302 wale', people)[0].id).toBe('c5')
  })

  it('a mishearing (खरी for Hari) is near at best, never sure', () => {
    expect(matchName('खरी', [{ id: 'h', names: ['Hari'] }])[0].score).toBeLessThan(NAME_SURE)
  })
})
