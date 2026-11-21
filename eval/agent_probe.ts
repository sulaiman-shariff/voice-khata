/** Live probe of the agent call: 5 sentences, prints the tool calls and ms. Needs GOOGLE_VERTEX_KEY + VERTEX_PROJECT. */
import { decide, type AgentContext } from '../server/agent/agent.js'

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })
const tools = [
  { name: 'add_entries', description: 'Record money given (gave) or taken (got) for customers.', input_schema: obj({
    entries: { type: 'array', items: obj({ name: { type: 'string' }, paise: { type: 'integer' }, direction: { type: 'string', enum: ['gave', 'got'] } }, ['name', 'paise', 'direction']) } }, ['entries']) },
  { name: 'show_customer', description: 'Open a customer page.', input_schema: obj({ name: { type: 'string' } }, ['name']) },
  { name: 'query_balance', description: 'Say how much a customer owes or is owed.', input_schema: obj({ name: { type: 'string' } }, ['name']) },
  { name: 'not_for_me', description: 'The speech was not addressed to the app.', input_schema: obj({}) },
  { name: 'unclear', description: 'The words cannot be trusted; ask the shopkeeper to repeat.', input_schema: obj({}) },
]

const base: AgentContext = { lang: 'hi', heard: [], history: [], screen: 'home', customers: ['Ramesh', 'Suresh', 'Meena'], recent: ['Ramesh'], pending: null }
const h = (...t: [string, string][]) => t.map(([locale, text]) => ({ locale, text }))
const cases: [string, AgentContext][] = [
  ['simple add', { ...base, heard: h(['hi-IN', 'रमेश को दो सौ रुपये दिए'], ['en-IN', 'Ramesh ko do sau rupaye diye']) }],
  ['two things', { ...base, heard: h(['hi-IN', 'सुरेश से पांच सौ मिले और मीना का हिसाब बताओ']) }],
  ['aside', { ...base, heard: h(['hi-IN', 'भैया यह तीन किलो चीनी ले लो'], ['en-IN', 'bhaiya yeh teen kilo chini le lo']) }],
  ['garbled', { ...base, heard: h(['hi-IN', 'ज़ क्ष त्र'], ['en-IN', 'zed kay']) }],
  ['pending yes', { ...base, heard: h(['hi-IN', 'हाँ']), pending: { kind: 'confirm', name: 'Ramesh', paise: 20000, direction: 'gave' } }],
]

for (let round = 0; round < 2; round++) {
  console.log(round === 0 ? '--- cold round' : '--- warm round')
  for (const [label, ctx] of cases) {
    try {
      const r = await decide(ctx, tools)
      console.log(`${label.padEnd(12)} ${Math.round(r.ms)} ms  ${JSON.stringify(r.calls)}`)
    } catch (e) {
      console.log(`${label.padEnd(12)} ERROR ${(e as Error).message}`)
    }
  }
}
