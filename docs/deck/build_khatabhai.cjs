/**
 * KhataBhai pitch deck (7 slides) -> docs/KhataBhai_Deck.pptx
 *
 * Dependencies are not part of the app; install them anywhere and point NODE_PATH there:
 *   npm install --prefix <dir> pptxgenjs react-icons sharp react react-dom
 *   NODE_PATH=<dir>/node_modules node docs/deck/build_khatabhai.cjs
 * PPTX_SKILL=<pptx skill dir> also writes the colour theme into the file (scripts/apply_theme.js).
 *
 * Look ported from the old HTML deck (docs/deck/deck.css): cream, brand red, serif headings.
 * Every number on the slides is a measured result (README.md, eval/results/).
 */
const path = require('path')
const fs = require('fs')
const pptxgen = require('pptxgenjs')
const React = require('react')
const ReactDOMServer = require('react-dom/server')
const sharp = require('sharp')
const fa = require('react-icons/fa')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'docs', 'KhataBhai_Deck.pptx')
const SHOT = (f) => path.join(ROOT, 'docs', 'screens', f)

const THEME = {
  name: 'KhataBhai',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '1F1A17', lt1: 'FFFFFF', dk2: '6B6058', lt2: 'FAF6EF',
    accent1: '8F2A1F', accent2: 'C4421F', accent3: '2F7D4F', accent4: 'E4D9C9', accent5: '3B4F8A', accent6: 'D9A441',
    hlink: '8F2A1F', folHlink: '6B6058',
  },
}
const HEX = { ink: '1F1A17', red: '8F2A1F', credit: 'C4421F', green: '2F7D4F', mute: '6B6058', line: 'E4D9C9', cream: 'FAF6EF', white: 'FFFFFF', blue: '3B4F8A', redTint: 'F6E7E2' }
const INDIC = 'Nirmala UI'
const FOOT = 'KhataBhai  ·  Team Purrfect  ·  Gnani Voice Hackathon PS2'

async function icon(Comp, color = '#FFFFFF', size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color, size }))
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return 'image/png;base64,' + png.toString('base64')
}

async function main() {
  const pres = new pptxgen()
  pres.layout = 'LAYOUT_16x9' // 10 x 5.625 in
  pres.title = 'KhataBhai'
  pres.company = 'Team Purrfect'
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace }
  const C = pres.SchemeColor

  // ------------------------------------------------------------------ layouts
  const edge = { rect: { x: 0, y: 0, w: 0.09, h: 5.625, fill: { color: C.accent1 }, line: { type: 'none' } } }
  const footer = { text: { text: FOOT, options: { x: 0.5, y: 5.27, w: 7, h: 0.25, fontSize: 9, color: C.text2, margin: 0 } } }
  pres.defineSlideMaster({
    title: 'KB Title',
    background: { color: HEX.cream },
    objects: [edge],
  })
  pres.defineSlideMaster({
    title: 'KB Content',
    background: { color: HEX.cream },
    objects: [
      edge, footer,
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, bold: true, color: C.accent1, fontFace: THEME.headFontFace, valign: 'middle', margin: 0 }, text: '' } },
    ],
    slideNumber: { x: 9.1, y: 5.25, w: 0.4, h: 0.25, fontSize: 9, color: C.text2, align: 'right' },
  })
  pres.defineSlideMaster({
    title: 'KB Close',
    background: { color: HEX.red },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, bold: true, color: C.background1, fontFace: THEME.headFontFace, valign: 'middle', margin: 0 }, text: '' } },
    ],
  })

  const ic = {
    mic: await icon(fa.FaMicrophone), bolt: await icon(fa.FaBolt), lang: await icon(fa.FaLanguage), lock: await icon(fa.FaLock),
    rupee: await icon(fa.FaRupeeSign), user: await icon(fa.FaUserCheck), arrows: await icon(fa.FaExchangeAlt), brain: await icon(fa.FaBrain),
    wave: await icon(fa.FaWaveSquare), speak: await icon(fa.FaVolumeUp), wifi: await icon(fa.FaWifi), redo: await icon(fa.FaRedo),
    question: await icon(fa.FaQuestionCircle), link: await icon(fa.FaLink), shield: await icon(fa.FaShieldAlt), robot: await icon(fa.FaRobot),
    hand: await icon(fa.FaHandshake), whatsapp: await icon(fa.FaWhatsapp, '#8F2A1F'), mobile: await icon(fa.FaMobileAlt, '#8F2A1F'),
    upi: await icon(fa.FaRupeeSign, '#8F2A1F'), gem: await icon(fa.FaTachometerAlt, '#8F2A1F'), check: await icon(fa.FaCheck),
  }

  /** Icon in a filled circle (the deck's motif). */
  const dot = (slide, img, x, y, d = 0.42, fill = C.accent1, name = 'icon') => {
    slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { type: 'none' }, objectName: `${name} circle` })
    const p = d * 0.25
    slide.addImage({ data: img, x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p, objectName: `${name} glyph` })
  }
  /** White rounded card with the warm border. */
  const card = (slide, x, y, w, h, name, fill = C.background1) =>
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: HEX.line, width: 1 }, objectName: name })
  /** App screenshot in a dark phone frame. */
  const phone = (slide, file, x, y, h, name) => {
    const w = h * (1170 / 2532) + 0.16
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: h + 0.16, rectRadius: 0.22, fill: { color: '1F1A17' }, line: { type: 'none' }, objectName: `${name} frame`, shadow: { type: 'outer', color: '3C1E14', opacity: 0.25, blur: 10, offset: 4, angle: 90 } })
    slide.addImage({ path: SHOT(file), x: x + 0.08, y: y + 0.08, w: w - 0.16, h, rounding: false, objectName: `${name} screen` })
  }
  const text = (slide, t, o) => slide.addText(t, { isTextBox: true, margin: 0, color: C.text1, fontSize: 14, valign: 'top', ...o })

  // ------------------------------------------------------------------ 1. title + team
  pres.addSection({ title: 'KhataBhai' })
  {
    const s = pres.addSlide({ masterName: 'KB Title', sectionTitle: 'KhataBhai' })
    text(s, 'GNANI VOICE HACKATHON  ·  PROBLEM STATEMENT 2', { x: 0.5, y: 0.45, w: 6.6, h: 0.3, fontSize: 12, bold: true, color: C.accent1, charSpacing: 2, objectName: 'kicker' })
    text(s, 'KhataBhai', { x: 0.5, y: 0.8, w: 6.6, h: 1.05, fontSize: 60, bold: true, color: C.accent1, fontFace: THEME.headFontFace, objectName: 'product name' })
    text(s, 'Just talk. The khata writes itself.', { x: 0.5, y: 1.85, w: 6.6, h: 0.45, fontSize: 22, italic: true, fontFace: THEME.headFontFace, objectName: 'tagline' })
    text(s, 'A voice credit ledger for kirana shops, in 10 Indian languages.', { x: 0.5, y: 2.35, w: 6.6, h: 0.3, fontSize: 14, color: C.text2, objectName: 'one-liner' })
    text(s, 'Team Purrfect  ·  team-8588FC8C5100  ·  Atria Institute of Technology', { x: 0.5, y: 2.85, w: 6.6, h: 0.28, fontSize: 12, bold: true, color: C.text2, objectName: 'team line' })
    const team = [
      ['Sulaiman Abdulla Shariff', 'Team Lead · LLM, deployment, integration'],
      ['Mahamad Zaid', 'Speech-to-text + text-to-speech'],
      ['Hajira Noorain', 'Native app'],
      ['K Mahi', 'Frontend + design'],
    ]
    team.forEach(([n, r], i) => {
      const x = 0.5 + i * 1.66
      card(s, x, 3.3, 1.54, 1.55, `team card ${i + 1}`)
      dot(s, ic.user, x + 0.14, 3.44, 0.36, i === 0 ? C.accent1 : C.accent2, `team ${i + 1}`)
      text(s, n, { x: x + 0.14, y: 3.88, w: 1.28, h: 0.45, fontSize: 12, bold: true, objectName: `team ${i + 1} name` })
      text(s, r, { x: x + 0.14, y: 4.33, w: 1.28, h: 0.45, fontSize: 10, color: C.text2, objectName: `team ${i + 1} role` })
    })
    phone(s, 'saved.png', 7.55, 0.45, 4.5, 'title phone')
  }

  // ------------------------------------------------------------------ 2. one look
  pres.addSection({ title: 'How it works' })
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'How it works' })
    s.addText('KhataBhai in one look', { placeholder: 'title' })
    text(s, 'Kirana owners give credit all day, mid-sale, with busy hands, and the record lives in memory. KhataBhai writes it down from speech.', { x: 0.5, y: 1.0, w: 6.4, h: 0.55, fontSize: 14, color: C.text2, objectName: 'problem line' })
    const bubbles = [
      ['रमेश का 340 उधार', 'लिख दिया।  ✓ Ramesh  ₹340 credit', true],
      ['Suresh ne 200 jama kiye', 'लिख दिया।  ✓ Suresh  ₹200 paid', false],
      ['ರಮೇಶ್ total?', 'ರಮೇಶ್ ಅವರ ಒಟ್ಟು ಬಾಕಿ 340 ರೂಪಾಯಿ.', true],
    ]
    bubbles.forEach(([u, a, indicA], i) => {
      const y = 1.7 + i * 0.8
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y, w: 2.55, h: 0.5, rectRadius: 0.2, fill: { color: C.background1 }, line: { color: HEX.line, width: 1 }, objectName: `said ${i + 1} bubble` })
      text(s, u, { x: 0.62, y, w: 2.35, h: 0.5, fontSize: 14, valign: 'middle', fontFace: /[^\x00-\x7F]/.test(u) ? INDIC : undefined, objectName: `said ${i + 1}` })
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.25, y, w: 3.65, h: 0.5, rectRadius: 0.2, fill: { color: C.accent1 }, line: { type: 'none' }, objectName: `reply ${i + 1} bubble` })
      text(s, a, { x: 3.37, y, w: 3.45, h: 0.5, fontSize: 13, color: C.background1, valign: 'middle', fontFace: indicA ? INDIC : INDIC, objectName: `reply ${i + 1}` })
    })
    const chips = [['10', 'Indian languages, mixed with English'], ['~0.8 s', 'from speaking to the reply'], ['0', 'ledgers stored in the cloud']]
    chips.forEach(([b, l], i) => {
      const x = 0.5 + i * 2.17
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 4.2, w: 2.05, h: 0.85, rectRadius: 0.12, fill: { color: C.accent1 }, line: { type: 'none' }, objectName: `fact ${i + 1}` })
      text(s, b, { x: x + 0.15, y: 4.27, w: 1.8, h: 0.42, fontSize: 24, bold: true, color: C.background1, fontFace: THEME.headFontFace, objectName: `fact ${i + 1} number` })
      text(s, l, { x: x + 0.15, y: 4.66, w: 1.8, h: 0.32, fontSize: 10, color: C.background1, objectName: `fact ${i + 1} label` })
    })
    phone(s, 'question.png', 7.6, 0.95, 4.1, 'one look phone')
  }

  // ------------------------------------------------------------------ 3. how it works
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'How it works' })
    s.addText('How it works', { placeholder: 'title' })
    const box = (x, y, w, h, head, body, name, strong = false) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: strong ? HEX.redTint : C.background1 }, line: { color: strong ? HEX.red : HEX.line, width: strong ? 1.5 : 1 }, objectName: name })
      text(s, [{ text: head, options: { bold: true, fontSize: 13, color: C.accent1, breakLine: true } }, { text: body, options: { fontSize: 10.5, color: C.text2 } }], { x: x + 0.12, y: y + 0.08, w: w - 0.24, h: h - 0.12, objectName: `${name} text` })
    }
    box(0.5, 1.05, 2.1, 1.9, 'Phone (PWA)', 'Mic in, reply out (AudioWorklets). Ledger encrypted in IndexedDB. Works by voice, tap or typing.', 'phone box')
    box(3.15, 1.05, 2.5, 1.9, 'Voice function · Mumbai', 'Vercel bom1. End-of-turn, parsing in 0 ms, dialogue, read-backs, reconnect and resume.', 'server box')
    box(6.2, 1.0, 3.3, 0.62, 'Gnani Prisma v3 · speech-to-text', 'realtime partials · REST re-read', 'prisma box', true)
    box(6.2, 1.7, 3.3, 0.62, 'Gnani Timbre v3 · text-to-speech', 'voice per language · cached phrases', 'timbre box', true)
    box(6.2, 2.4, 3.3, 0.55, 'Claude Haiku · hard turns only', '', 'llm box')
    const arrow = (x, y, w, name) => s.addShape(pres.shapes.LINE, { x, y, w, h: 0, line: { color: HEX.red, width: 2, beginArrowType: 'triangle', endArrowType: 'triangle' }, objectName: name })
    arrow(2.65, 2.0, 0.45, 'phone to server')
    arrow(5.7, 1.31, 0.45, 'server to prisma')
    arrow(5.7, 2.01, 0.45, 'server to timbre')
    arrow(5.7, 2.67, 0.45, 'server to llm')
    text(s, 'WebSocket · 16 kHz audio up, replies + ledger changes down', { x: 0.5, y: 3.02, w: 5.2, h: 0.25, fontSize: 10, italic: true, color: C.text2, objectName: 'socket note' })
    // turn timeline
    const steps = [['Speak', 'any of 10 languages', ic.mic], ['Tick', '~0.3 s after you stop', ic.check], ['Transcript', 'Prisma, ~0.8 s', ic.wave], ['Understood', 'parsed in 0 ms', ic.brain], ['Saved + said', '“लिख दिया।”', ic.speak]]
    steps.forEach(([h, d, img], i) => {
      const x = 0.5 + i * 1.83
      dot(s, img, x, 3.55, 0.46, i === 4 ? C.accent3 : C.accent1, `step ${i + 1}`)
      text(s, h, { x: x + 0.56, y: 3.53, w: 1.2, h: 0.25, fontSize: 12, bold: true, objectName: `step ${i + 1} name` })
      text(s, d, { x: x + 0.56, y: 3.78, w: 1.25, h: 0.45, fontSize: 10, color: C.text2, fontFace: /[^\x00-\x7F“”]/.test(d) ? INDIC : undefined, objectName: `step ${i + 1} detail` })
      if (i < steps.length - 1) s.addShape(pres.shapes.LINE, { x: x + 1.55, y: 3.78, w: 0.22, h: 0, line: { color: HEX.line, width: 1.5, endArrowType: 'triangle' }, objectName: `step ${i + 1} arrow` })
    })
    text(s, 'Unsure, noisy or a large amount? It reads the entry back and asks first; it never saves a guess.', { x: 0.5, y: 4.55, w: 9, h: 0.3, fontSize: 12, bold: true, color: C.accent1, objectName: 'safety line' })
  }

  // ------------------------------------------------------------------ 4. understanding + Gnani
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'How it works' })
    s.addText('Understanding Indian ledger talk', { placeholder: 'title' })
    card(s, 0.5, 1.05, 4.4, 3.95, 'parser card')
    text(s, 'Our parser', { x: 0.7, y: 1.17, w: 4, h: 0.3, fontSize: 15, bold: true, color: C.accent1, fontFace: THEME.headFontFace, objectName: 'parser head' })
    const rows = [
      [ic.rupee, 'Amounts in 10 languages', 'teens, sawa · dedh · ಮುನ್ನೂರ, lakh; asks “60 ya 7?” on look-alikes'],
      [ic.arrows, 'Credit or payment from grammar', 'ne / ko, verb person, Dravidian case endings'],
      [ic.user, 'Names, guarded', '“ಸುರೇಶ್ ಹೆಸರಿಂದ” → Suresh, never a new account by mistake'],
      [ic.robot, 'LLM only when needed', 'Claude Haiku; it can never invent an amount it did not hear'],
    ]
    rows.forEach(([img, h, d], i) => {
      const y = 1.6 + i * 0.84
      dot(s, img, 0.7, y, 0.42, C.accent1, `parser ${i + 1}`)
      text(s, h, { x: 1.25, y: y - 0.02, w: 3.5, h: 0.28, fontSize: 13, bold: true, objectName: `parser ${i + 1} head` })
      text(s, d, { x: 1.25, y: y + 0.26, w: 3.5, h: 0.45, fontSize: 10.5, color: C.text2, fontFace: INDIC, objectName: `parser ${i + 1} detail` })
    })
    card(s, 5.1, 1.05, 4.4, 3.95, 'gnani card', HEX.redTint)
    text(s, 'Built deep on Gnani', { x: 5.3, y: 1.17, w: 4, h: 0.3, fontSize: 15, bold: true, color: C.accent1, fontFace: THEME.headFontFace, objectName: 'gnani head' })
    const g = [
      [ic.wave, 'Prisma v3 speech-to-text', 'live partials · customer names as keyterms · early commit · REST re-read when you switch language · replay after a drop'],
      [ic.speak, 'Timbre v3 text-to-speech', 'recommended voice per language · <pauses> in lists · cached short replies · faster speech option'],
      [ic.question, 'Probed, not assumed', 'every behaviour checked live against the API, from language lists to replay speed'],
    ]
    g.forEach(([img, h, d], i) => {
      const y = 1.6 + i * 1.1
      dot(s, img, 5.3, y, 0.42, C.accent1, `gnani ${i + 1}`)
      text(s, h, { x: 5.85, y: y - 0.02, w: 3.5, h: 0.28, fontSize: 13, bold: true, objectName: `gnani ${i + 1} head` })
      text(s, d, { x: 5.85, y: y + 0.26, w: 3.5, h: 0.7, fontSize: 10.5, color: C.text2, objectName: `gnani ${i + 1} detail` })
    })
  }

  // ------------------------------------------------------------------ 5. results
  pres.addSection({ title: 'Results' })
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'Results' })
    s.addText('Fast and exact', { placeholder: 'title' })
    const stats = [['843 ms', 'first reply audio (p50) on Vercel Mumbai'], ['~320 ms', 'until the “heard you” tick'], ['60 / 60', 'amounts exact, quiet shop'], ['0', 'silent wrong saves, quiet or street noise']]
    stats.forEach(([b, l], i) => {
      const y = 1.05 + i * 0.98
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y, w: 3.3, h: 0.86, rectRadius: 0.12, fill: { color: i === 3 ? C.accent3 : C.accent1 }, line: { type: 'none' }, objectName: `stat ${i + 1}` })
      text(s, b, { x: 0.68, y: y + 0.06, w: 3, h: 0.45, fontSize: 26, bold: true, color: C.background1, fontFace: THEME.headFontFace, objectName: `stat ${i + 1} number` })
      text(s, l, { x: 0.68, y: y + 0.5, w: 3, h: 0.3, fontSize: 10.5, color: C.background1, objectName: `stat ${i + 1} label` })
    })
    card(s, 4.1, 1.05, 5.4, 3.82, 'chart card')
    s.addChart(pres.charts.BAR, [
      { name: 'Before', labels: ['p50', 'p95'], values: [912, 1682] },
      { name: 'KhataBhai now', labels: ['p50', 'p95'], values: [843, 1263] },
    ], {
      x: 4.25, y: 1.15, w: 5.1, h: 3.3, barDir: 'col', barGapWidthPct: 60,
      chartColors: [HEX.line, HEX.red],
      showTitle: true, title: 'First reply audio after you stop speaking (ms)', titleFontSize: 12, titleColor: HEX.ink, titleFontFace: '+mn-lt',
      showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 11, dataLabelColor: HEX.ink, dataLabelFontFace: '+mn-lt',
      showLegend: true, legendPos: 'b', legendFontSize: 11, legendColor: HEX.mute, legendFontFace: '+mn-lt',
      catAxisLabelColor: HEX.mute, catAxisLabelFontSize: 12, catAxisLabelFontFace: '+mn-lt',
      valAxisHidden: true, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
      objectName: 'latency chart',
    })
    text(s, 'Production vs. preview, same suite: 4 languages, quiet + 5 dB street noise (56 / 60 exact in noise)', { x: 4.25, y: 4.5, w: 5.1, h: 0.3, fontSize: 9.5, color: C.text2, objectName: 'chart caption' })
  }

  // ------------------------------------------------------------------ 6. reliable + private
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'Results' })
    s.addText('Reliable on bad networks, private by design', { placeholder: 'title' })
    const col = (x, head, items, name) => {
      card(s, x, 1.05, 4.4, 3.95, `${name} card`)
      text(s, head, { x: x + 0.2, y: 1.17, w: 4, h: 0.3, fontSize: 15, bold: true, color: C.accent1, fontFace: THEME.headFontFace, objectName: `${name} head` })
      items.forEach(([img, h, d], i) => {
        const y = 1.6 + i * 0.84
        dot(s, img, x + 0.2, y, 0.42, C.accent1, `${name} ${i + 1}`)
        text(s, h, { x: x + 0.75, y: y - 0.02, w: 3.5, h: 0.28, fontSize: 13, bold: true, objectName: `${name} ${i + 1} head` })
        text(s, d, { x: x + 0.75, y: y + 0.26, w: 3.5, h: 0.45, fontSize: 10.5, color: C.text2, fontFace: INDIC, objectName: `${name} ${i + 1} detail` })
      })
    }
    col(0.5, 'When the network drops', [
      [ic.redo, 'No entry lost silently', 'a turn cut off is re-sent: “नेटवर्क टूट गया था, फिर से लिख रहा हूँ।”'],
      [ic.wifi, 'Dead link found in ~9 s', 'heartbeat + instant check on Wi-Fi ↔ mobile switches'],
      [ic.mic, 'Speech kept', 'last seconds buffered, replayed at 3× after reconnect'],
      [ic.question, 'Open question kept', '“सही है?” still answered after a drop · 6 / 6 chaos tests'],
    ], 'network')
    col(5.1, 'Your ledger, your phone', [
      [ic.lock, 'Ledger only on the phone', 'AES-GCM, a key per customer; forgetting one shreds it'],
      [ic.shield, 'Tamper-evident', 'SHA-256 hash chain over every entry and change'],
      [ic.robot, 'Honest AI', 'says it is an AI on the first turn; never scores a customer'],
      [ic.hand, 'Consent first', 'reminders only for adults who opted in'],
    ], 'privacy')
  }

  // ------------------------------------------------------------------ 7. next + thank you
  pres.addSection({ title: 'Next' })
  {
    const s = pres.addSlide({ masterName: 'KB Close', sectionTitle: 'Next' })
    s.addText('What’s next', { placeholder: 'title' })
    const next = [
      [ic.gem, 'Faster LLM', 'Gemini on Vertex AI Mumbai: ~650 ms vs ~1.1 s for hard turns, after a guard against confident guesses'],
      [ic.whatsapp, 'WhatsApp notifications', 'reminders and statements to customers who opted in'],
      [ic.mobile, 'Native app', 'Android first, offline-first, better mic control · in progress (Hajira)'],
      [ic.upi, 'Payment integration', 'UPI collect links; a paid link settles the entry by itself'],
    ]
    next.forEach(([img, h, d], i) => {
      const x = 0.5 + i * 2.27
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.1, w: 2.12, h: 2.55, rectRadius: 0.14, fill: { color: HEX.cream }, line: { type: 'none' }, objectName: `next ${i + 1} card` })
      s.addShape(pres.shapes.OVAL, { x: x + 0.18, y: 1.28, w: 0.5, h: 0.5, fill: { color: HEX.white }, line: { color: HEX.line, width: 1 }, objectName: `next ${i + 1} circle` })
      s.addImage({ data: img, x: x + 0.3, y: 1.4, w: 0.26, h: 0.26, objectName: `next ${i + 1} glyph` })
      text(s, h, { x: x + 0.18, y: 1.9, w: 1.8, h: 0.55, fontSize: 14, bold: true, color: C.accent1, valign: 'bottom', objectName: `next ${i + 1} head` })
      text(s, d, { x: x + 0.18, y: 2.55, w: 1.8, h: 1.0, fontSize: 11, color: C.text1, objectName: `next ${i + 1} detail` })
    })
    text(s, 'Thank you', { x: 0.5, y: 4.15, w: 5, h: 0.6, fontSize: 34, bold: true, color: C.background1, fontFace: THEME.headFontFace, objectName: 'thanks' })
    text(s, [{ text: 'Try it: ', options: { color: C.background1 } }, { text: 'voice-khata-delta.vercel.app', options: { color: C.background1, bold: true, hyperlink: { url: 'https://voice-khata-delta.vercel.app' } } }], { x: 5.2, y: 4.3, w: 4.3, h: 0.35, fontSize: 14, align: 'right', objectName: 'live link' })
    text(s, 'Team Purrfect  ·  Gnani Voice Hackathon PS2', { x: 5.2, y: 4.65, w: 4.3, h: 0.3, fontSize: 11, color: C.background1, align: 'right', objectName: 'team close' })
  }

  await pres.writeFile({ fileName: OUT })
  if (process.env.PPTX_SKILL) {
    const { applyTheme } = require(path.join(process.env.PPTX_SKILL, 'scripts', 'apply_theme.js'))
    await applyTheme(OUT, THEME)
  }
  console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
