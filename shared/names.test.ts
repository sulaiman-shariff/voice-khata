import { describe, expect, it } from 'vitest'
import { NAME_NEAR, NAME_SURE, matchName, phoneticKey, translit } from './names.js'

describe('translit', () => {
  it.each([
    ['रमेश', 'ramesh'],
    ['सुरेश', 'suresh'],
    ['गीता', 'geetaa'],
    ['लक्ष्मी', 'lakshmee'],
    ['ರಮೇಶ್', 'ramesh'],
    ['ரமேஷ்', 'ramesh'],
    ['రమేష్', 'ramesh'],
    ['রমেশ', 'ramesh'],
  ])('%s -> %s', (a, b) => expect(translit(a)).toBe(b))
})

describe('phoneticKey merges spellings across scripts', () => {
  const same: [string, string][] = [
    ['Ramesh', 'रमेश'], ['Ramesh', 'ರಮೇಶ್'], ['Ramesh', 'ரமேஷ்'], ['Ramesh', 'రమేష్'],
    ['Lakshmi', 'ಲಕ್ಷ್ಮಿ'], ['Lakshmi', 'लक्ष्मी'], ['Geeta', 'Gita'], ['Geeta', 'गीता'],
    ['Suresh', 'Sooresh'], ['Vimla', 'Wimla'], ['Sharma', 'शर्मा'], ['Priya', 'प्रिया'],
  ]
  it.each(same)('%s == %s', (a, b) => expect(phoneticKey(a)).toBe(phoneticKey(b)))
})

describe('matchName', () => {
  const people = [
    { id: 'c1', names: ['Ramesh', 'Ramesh doodhwale'] },
    { id: 'c2', names: ['Ramesh Kumar'] },
    { id: 'c3', names: ['Suresh'] },
    { id: 'c4', names: ['Geeta'] },
    { id: 'c5', names: ['Sharma ji', 'flat 302 wale'] },
  ]
  it('exact cross-script match is sure', () => {
    const [m] = matchName('रमेश', people)
    expect(m.id).toBe('c1')
    expect(m.score).toBeGreaterThanOrEqual(NAME_SURE)
  })
  it('first name hits two Rameshes, so both score high (caller must ask)', () => {
    const top = matchName('Ramesh', people).filter((m) => m.score >= NAME_NEAR).map((m) => m.id)
    expect(top).toEqual(expect.arrayContaining(['c1', 'c2']))
  })
  it('Suresh is not Ramesh', () => {
    const m = matchName('Suresh', people)
    expect(m[0].id).toBe('c3')
    expect(m.find((x) => x.id === 'c1')!.score).toBeLessThan(NAME_SURE)
  })
  it('alias resolves', () => {
    expect(matchName('doodhwale', people)[0].id).toBe('c1')
    expect(matchName('flat 302 wale', people)[0].id).toBe('c5')
  })
  it('a misheard name (हरी/खरी) is near, not sure', () => {
    const m = matchName('खरी', [{ id: 'h', names: ['Hari'] }])[0]
    expect(m.score).toBeLessThan(NAME_SURE)
  })
})
