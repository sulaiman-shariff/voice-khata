import { describe, expect, it } from 'vitest'
import { createLogger, hashIp } from './log.js'

function capture(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
  const lines: { level: string; obj: Record<string, unknown> }[] = []
  const L = createLogger({ sid: 's1' }, { level, sink: (lv, line) => lines.push({ level: lv, obj: JSON.parse(line) }) })
  return { L, lines }
}

describe('server logger', () => {
  it('writes one JSON object per line with event, level, time and context', () => {
    const { L, lines } = capture()
    L.info('turn', { text: 'रमेश का 340 उधार', turn: 3 })
    expect(lines).toHaveLength(1)
    expect(lines[0].obj).toMatchObject({ lvl: 'info', ev: 'turn', sid: 's1', text: 'रमेश का 340 उधार', turn: 3 })
    expect(typeof lines[0].obj.t).toBe('string')
  })

  it('drops lines below the configured level', () => {
    const { L, lines } = capture('info')
    L.debug('partial', { text: 'x' })
    L.warn('stt_closed', { code: 1006 })
    expect(lines.map((l) => l.obj.ev)).toEqual(['stt_closed'])
  })

  it('masks secret-looking fields at any depth', () => {
    const { L, lines } = capture()
    L.info('cfg', { apiKey: 'sk-123', nested: { authorization: 'Bearer x', token: 't', ok: 1 } })
    expect(lines[0].obj).toMatchObject({ apiKey: '***', nested: { authorization: '***', token: '***', ok: 1 } })
  })

  it('caps long strings, summarises buffers and reduces errors to their message', () => {
    const { L, lines } = capture()
    L.error('x', { long: 'a'.repeat(5000), pcm: Buffer.alloc(640), error: new Error('boom') })
    const o = lines[0].obj
    expect((o.long as string).length).toBeLessThan(1100)
    expect(o.pcm).toBe('<640 bytes>')
    expect(o.error).toBe('boom')
  })

  it('child loggers add their fields', () => {
    const { L, lines } = capture()
    L.child({ part: 'tts' }).warn('tts_socket_closed', { code: 1006 })
    expect(lines[0].obj).toMatchObject({ sid: 's1', part: 'tts', ev: 'tts_socket_closed' })
  })

  it('hashes IP addresses to a short stable id', () => {
    expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'))
    expect(hashIp('1.2.3.4')).not.toBe(hashIp('1.2.3.5'))
    expect(hashIp('1.2.3.4')).not.toContain('1.2.3.4')
  })
})
