/**
 * KhataBhai pitch deck (8 slides) -> docs/KhataBhai_Deck.pptx
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
const FOOT = 'KhataBhai, Team Purrfect, Gnani Voice Hackathon'

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
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.4, w: 9, h: 0.52, fontSize: 26, bold: true, align: 'left', color: C.accent1, fontFace: THEME.headFontFace, valign: 'middle', margin: 0 }, text: '' } },
    ],
    slideNumber: { x: 9.1, y: 5.25, w: 0.4, h: 0.25, fontSize: 9, color: C.text2, align: 'right' },
  })
  pres.defineSlideMaster({
    title: 'KB Close',
    background: { color: HEX.red },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.4, w: 9, h: 0.52, fontSize: 26, bold: true, align: 'left', color: C.background1, fontFace: THEME.headFontFace, valign: 'middle', margin: 0 }, text: '' } },
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
  /** Split a string into runs so only the Indic words get the Indic font. */
  const INDIC_RE = /([ऀ-෿][ऀ-෿\s]*[ऀ-෿]|[ऀ-෿])/
  const runs = (str, opts) => str.split(INDIC_RE).filter(Boolean).map((t) => ({ text: t, options: INDIC_RE.test(t) ? { ...opts, fontFace: INDIC } : { ...opts } }))
  /** Small section label above a slide title. */
  const kicker = (slide, t, color = HEX.credit) => text(slide, t, { x: 0.5, y: 0.2, w: 6, h: 0.22, fontSize: 10.5, bold: true, color, objectName: 'section label' })

  // ------------------------------------------------------------------ 1. title + team
  pres.addSection({ title: 'KhataBhai' })
  {
    const s = pres.addSlide({ masterName: 'KB Title', sectionTitle: 'KhataBhai' })
    text(s, 'Gnani Voice Hackathon, Problem Statement 2', { x: 0.5, y: 0.45, w: 6.6, h: 0.3, fontSize: 13, bold: true, color: C.accent1, objectName: 'kicker' })
    text(s, 'KhataBhai', { x: 0.5, y: 0.8, w: 6.6, h: 1.05, fontSize: 60, bold: true, color: C.accent1, fontFace: THEME.headFontFace, objectName: 'product name' })
    text(s, 'Just talk. The khata writes itself.', { x: 0.5, y: 1.9, w: 6.6, h: 0.45, fontSize: 22, italic: true, fontFace: THEME.headFontFace, objectName: 'tagline' })
    text(s, 'A voice credit ledger for kirana shops, in 10 Indian languages.', { x: 0.5, y: 2.45, w: 6.6, h: 0.3, fontSize: 14, color: C.text2, objectName: 'one-liner' })
    text(s, 'Team Purrfect (team-8588FC8C5100), Atria Institute of Technology', { x: 0.5, y: 3.35, w: 6.6, h: 0.28, fontSize: 12, bold: true, color: C.text2, objectName: 'team line' })
    const team = [
      ['Sulaiman Abdulla Shariff', 'Team lead. LLM, deployment and integration'],
      ['Mahamad Zaid', 'Speech to text and text to speech'],
      ['Hajira Noorain', 'Native app'],
      ['K Mahi', 'Frontend and design'],
    ]
    // four equal cards spanning exactly the text column (0.5 in -> 7.1 in), no icons
    const colW = 6.6
    const gap = 0.16
    const cw = (colW - 3 * gap) / 4
    team.forEach(([n, r], i) => {
      const x = 0.5 + i * (cw + gap)
      // bottoms line up with the phone frame's bottom edge (0.45 + 4.5 + 0.16 = 5.11 in)
      card(s, x, 3.91, cw, 1.2, `team card ${i + 1}`)
      text(s, n, { x: x + 0.16, y: 4.06, w: cw - 0.32, h: 0.46, fontSize: 12, bold: true, color: i === 0 ? C.accent1 : C.text1, valign: 'top', objectName: `team ${i + 1} name` })
      text(s, r, { x: x + 0.16, y: 4.54, w: cw - 0.32, h: 0.48, fontSize: 10, color: C.text2, valign: 'top', objectName: `team ${i + 1} role` })
    })
    phone(s, 'kb-home.png', 7.55, 0.45, 4.5, 'title phone')
  }

  // ------------------------------------------------------------------ 2. one look
  pres.addSection({ title: 'How it works' })
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'How it works' })
    kicker(s, 'The product')
    s.addText('What it does', { placeholder: 'title' })
    text(s, 'Shop owners give credit all day while serving customers, and most of it is kept in memory. With KhataBhai they just say it, and it is written down.', { x: 0.5, y: 1.0, w: 6.4, h: 0.55, fontSize: 14, color: C.text2, objectName: 'problem line' })
    const bubbles = [
      ['रमेश का 340 उधार', 'लिख दिया।   Ramesh, ₹340 on credit', true],
      ['Suresh ne 200 jama kiye', 'लिख दिया।   Suresh, ₹200 paid', false],
      ['ರಮೇಶ್ total?', 'ರಮೇಶ್ ಅವರ ಒಟ್ಟು ಬಾಕಿ 340 ರೂಪಾಯಿ.', true],
    ]
    bubbles.forEach(([u, a, indicA], i) => {
      const y = 1.7 + i * 0.8
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y, w: 2.55, h: 0.5, rectRadius: 0.2, fill: { color: C.background1 }, line: { color: HEX.line, width: 1 }, objectName: `said ${i + 1} bubble` })
      text(s, u, { x: 0.62, y, w: 2.35, h: 0.5, fontSize: 14, valign: 'middle', fontFace: /[^\x00-\x7F]/.test(u) ? INDIC : undefined, objectName: `said ${i + 1}` })
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.25, y, w: 3.65, h: 0.5, rectRadius: 0.2, fill: { color: C.accent1 }, line: { type: 'none' }, objectName: `reply ${i + 1} bubble` })
      text(s, a, { x: 3.37, y, w: 3.45, h: 0.5, fontSize: 13, color: C.background1, valign: 'middle', fontFace: indicA ? INDIC : INDIC, objectName: `reply ${i + 1}` })
    })
    const chips = [['10', 'Indian languages, mixed with English'], ['Under a second', 'from speaking to hearing the reply']]
    const chipW = (6.4 - 0.16) / 2
    chips.forEach(([b, l], i) => {
      const x = 0.5 + i * (chipW + 0.16)
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 4.2, w: chipW, h: 0.85, rectRadius: 0.12, fill: { color: C.accent1 }, line: { type: 'none' }, objectName: `fact ${i + 1}` })
      text(s, b, { x: x + 0.2, y: 4.27, w: chipW - 0.4, h: 0.42, fontSize: 24, bold: true, color: C.background1, fontFace: THEME.headFontFace, objectName: `fact ${i + 1} number` })
      text(s, l, { x: x + 0.2, y: 4.66, w: chipW - 0.4, h: 0.32, fontSize: 11, color: C.background1, objectName: `fact ${i + 1} label` })
    })
    phone(s, 'kb-question.png', 7.6, 0.95, 4.1, 'one look phone')
  }

  // ------------------------------------------------------------------ 3. how it works
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'How it works' })
    kicker(s, 'Architecture')
    s.addText('How it works', { placeholder: 'title', align: 'left' })
    const TOP = 1.05
    const H = 2.1
    // the phone, as it really looks
    phone(s, 'kb-home.png', 0.62, TOP, 1.82, 'arch phone')
    text(s, [
      { text: 'Your phone', options: { bold: true, fontSize: 11, color: HEX.ink, breakLine: true } },
      { text: 'ledger stays here, encrypted', options: { fontSize: 9, color: HEX.mute } },
    ], { x: 0.4, y: TOP + 2.0, w: 1.45, h: 0.42, align: 'center', objectName: 'arch phone label' })
    // phone <-> server
    const arrow = (x1, x2, y, label, name, above) => {
      s.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y, w: Math.abs(x2 - x1), h: 0, flipH: x2 < x1, line: { color: HEX.red, width: 2, endArrowType: 'triangle' }, objectName: name })
      text(s, label, { x: Math.min(x1, x2) - 0.1, y: above ? y - 0.3 : y + 0.07, w: Math.abs(x2 - x1) + 0.2, h: 0.24, fontSize: 9.5, color: HEX.mute, align: 'center', objectName: `${name} label` })
    }
    arrow(1.95, 2.95, TOP + 0.7, 'your voice, live', 'voice up', true)
    arrow(2.95, 1.95, TOP + 1.35, 'reply + entry', 'reply down', false)
    // the server: three stages, in order
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.0, y: TOP, w: 2.95, h: H, rectRadius: 0.12, fill: { color: HEX.red }, line: { type: 'none' }, objectName: 'server tile' })
    text(s, [
      { text: 'KhataBhai server', options: { bold: true, fontSize: 14, color: HEX.white, fontFace: THEME.headFontFace, breakLine: true } },
      { text: 'Vercel, Mumbai region', options: { fontSize: 9.5, color: HEX.redTint } },
    ], { x: 3.2, y: TOP + 0.12, w: 2.6, h: 0.5, objectName: 'server head' })
    const stages = ['Hears when you have finished', 'Reads name, amount, credit or paid', 'Saves it, or asks one question']
    stages.forEach((t, i) => {
      const y = TOP + 0.72 + i * 0.44
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.18, y, w: 2.59, h: 0.36, rectRadius: 0.06, fill: { color: HEX.cream }, line: { type: 'none' }, objectName: `stage ${i + 1}` })
      text(s, [
        { text: `${i + 1}  `, options: { bold: true, fontSize: 10.5, color: HEX.red } },
        { text: t, options: { fontSize: 10, color: HEX.ink } },
      ], { x: 3.3, y, w: 2.45, h: 0.36, valign: 'middle', objectName: `stage ${i + 1} text` })
    })
    // three services
    const svc = [
      ['Gnani Prisma', 'speech to text, while you talk', true],
      ['Gnani Timbre', 'text to speech, a voice per language', true],
      ['Claude Haiku', 'unusual sentences only', false],
    ]
    const g = 0.11
    const sh = (H - 2 * g) / 3
    svc.forEach(([h, d, gnani], i) => {
      const y = TOP + i * (sh + g)
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.65, y, w: 2.85, h: sh, rectRadius: 0.08, fill: { color: gnani ? HEX.redTint : HEX.white }, line: { color: gnani ? HEX.red : HEX.line, width: 1 }, objectName: `service ${i + 1}` })
      text(s, [
        { text: h, options: { bold: true, fontSize: 12, color: HEX.red, breakLine: true } },
        { text: d, options: { fontSize: 9.5, color: HEX.mute } },
      ], { x: 6.8, y, w: 2.6, h: sh, valign: 'middle', objectName: `service ${i + 1} text` })
      s.addShape(pres.shapes.LINE, { x: 5.99, y: y + sh / 2, w: 0.62, h: 0, line: { color: HEX.red, width: 1.5, beginArrowType: 'triangle', endArrowType: 'triangle' }, objectName: `service ${i + 1} link` })
    })

    // one turn, start to finish
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 3.62, w: 9, h: 1.5, rectRadius: 0.1, fill: { color: HEX.white }, line: { color: HEX.line, width: 1 }, objectName: 'turn panel' })
    text(s, 'One turn, start to finish', { x: 0.7, y: 3.7, w: 4, h: 0.28, fontSize: 12.5, bold: true, color: HEX.red, fontFace: THEME.headFontFace, objectName: 'turn head' })
    const steps = [
      ['0 s', 'You stop speaking', 'any of 10 languages'],
      ['0.3 s', 'A soft tick', 'so you know it heard you'],
      ['0.8 s', 'Words understood', 'text from Gnani Prisma'],
      ['0.85 s', 'Saved and confirmed', '“लिख दिया।”'],
    ]
    const x0 = 1.45
    const step = 2.37
    const trackY = 4.42
    s.addShape(pres.shapes.LINE, { x: x0, y: trackY, w: step * (steps.length - 1), h: 0, line: { color: HEX.red, width: 3 }, objectName: 'turn track' })
    steps.forEach(([t, h, d], i) => {
      const cx = x0 + i * step
      const last = i === steps.length - 1
      const col = last ? HEX.green : HEX.red
      text(s, t, { x: cx - 0.8, y: 4.0, w: 1.6, h: 0.28, fontSize: 13, bold: true, color: col, align: 'center', fontFace: THEME.headFontFace, objectName: `step ${i + 1} time` })
      s.addShape(pres.shapes.OVAL, { x: cx - 0.12, y: trackY - 0.12, w: 0.24, h: 0.24, fill: { color: col }, line: { color: HEX.white, width: 2 }, objectName: `step ${i + 1} node` })
      text(s, h, { x: cx - 1.0, y: 4.6, w: 2.0, h: 0.24, fontSize: 11, bold: true, align: 'center', objectName: `step ${i + 1} name` })
      text(s, d, { x: cx - 1.0, y: 4.82, w: 2.0, h: 0.22, fontSize: 9.5, color: HEX.mute, align: 'center', fontFace: /[^\x00-\x7F“”]/.test(d) ? INDIC : undefined, objectName: `step ${i + 1} detail` })
    })
  }

  /** A compact card: red heading and one or two plain sentences. */
  const plainCard = (slide, x, y, w, h, head, body, name, fill = HEX.white, headSize = 12.5, bodySize = 10.5) => {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { color: HEX.line, width: 1 }, objectName: name })
    text(slide, [
      { text: head, options: { bold: true, fontSize: headSize, color: HEX.red, breakLine: true } },
      ...runs(body, { fontSize: bodySize, color: HEX.ink }),
    ], { x: x + 0.16, y: y + 0.1, w: w - 0.32, h: h - 0.16, paraSpaceAfter: 2, objectName: `${name} text` })
  }
  /** A coloured band with a column heading. */
  const band = (slide, t, x, y, w, fill, name, color = HEX.white) => {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.38, rectRadius: 0.08, fill: { color: fill }, line: { type: 'none' }, objectName: name })
    text(slide, t, { x: x + 0.16, y, w: w - 0.32, h: 0.38, fontSize: 12.5, bold: true, color, valign: 'middle', fontFace: THEME.headFontFace, objectName: `${name} text` })
  }

  /** A small heading above a group of cards. */
  const groupHead = (slide, t, x, y, w, name) =>
    text(slide, t, { x, y, w, h: 0.3, fontSize: 14, bold: true, color: HEX.ink, fontFace: THEME.headFontFace, objectName: name })

  // ------------------------------------------------------------------ 4. tech stack
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'How it works' })
    kicker(s, 'Tech stack')
    s.addText('What it is built with', { placeholder: 'title' })
    const cols = [
      ['On the phone', HEX.ink, 'The app, and the ledger, encrypted on the device.', ['React + Vite', 'AudioWorklet mic', 'Encrypted IndexedDB']],
      ['Server, in Mumbai', HEX.red, 'One live connection per shop. Reads most sentences in 0 ms.', ['Vercel (bom1)', 'WebSocket, Node.js', 'Our TypeScript parser']],
      ['Voice, from Gnani', HEX.credit, 'Hears the shopkeeper and speaks back, in 10 languages.', ['Prisma v3 STT', 'Timbre v3 TTS']],
      ['AI and backup', HEX.green, 'Only for the sentences our parser cannot read.', ['Claude Haiku', 'Neon Postgres']],
    ]
    const gap = 0.16
    const w = (9 - 3 * gap) / 4
    cols.forEach(([head, fill, role, items], c) => {
      const x = 0.5 + c * (w + gap)
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.05, w, h: 2.95, rectRadius: 0.1, fill: { color: HEX.white }, line: { color: HEX.line, width: 1 }, objectName: `stack ${c + 1}` })
      s.addShape(pres.shapes.RECTANGLE, { x, y: 1.05, w, h: 0.08, fill: { color: fill }, line: { type: 'none' }, objectName: `stack ${c + 1} bar` })
      text(s, head, { x: x + 0.2, y: 1.28, w: w - 0.4, h: 0.32, fontSize: 15, bold: true, color: fill, fontFace: THEME.headFontFace, objectName: `stack ${c + 1} head` })
      text(s, role, { x: x + 0.2, y: 1.66, w: w - 0.4, h: 0.62, fontSize: 10.5, color: HEX.mute, objectName: `stack ${c + 1} role` })
      items.forEach((t, i) => {
        const y = 2.36 + i * 0.52
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.2, y, w: w - 0.4, h: 0.42, rectRadius: 0.21, fill: { color: c === 0 ? 'EFEAE4' : HEX.redTint }, line: { type: 'none' }, objectName: `stack ${c + 1}.${i + 1}` })
        text(s, t, { x: x + 0.2, y, w: w - 0.4, h: 0.42, fontSize: 11.5, bold: true, color: HEX.ink, align: 'center', valign: 'middle', objectName: `stack ${c + 1}.${i + 1} text` })
      })
    })
    // how one sentence moves through them
    text(s, 'One sentence, through the stack', { x: 0.5, y: 4.15, w: 5, h: 0.26, fontSize: 12, bold: true, color: HEX.red, fontFace: THEME.headFontFace, objectName: 'path head' })
    const path = ['Mic on the phone', 'WebSocket to Mumbai', 'Prisma: text', 'Our parser: entry', 'Timbre: reply', 'Saved on the phone']
    const pw = 1.32
    const pg = (9 - path.length * pw) / (path.length - 1)
    path.forEach((t, i) => {
      const x = 0.5 + i * (pw + pg)
      const end = i === 0 || i === path.length - 1
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 4.5, w: pw, h: 0.44, rectRadius: 0.08, fill: { color: end ? HEX.ink : HEX.red }, line: { type: 'none' }, objectName: `path ${i + 1}` })
      text(s, t, { x: x + 0.05, y: 4.5, w: pw - 0.1, h: 0.44, fontSize: 9.5, bold: true, color: HEX.white, align: 'center', valign: 'middle', objectName: `path ${i + 1} text` })
      if (i < path.length - 1)
        s.addShape(pres.shapes.LINE, { x: x + pw + 0.02, y: 4.72, w: pg - 0.04, h: 0, line: { color: HEX.mute, width: 1.25, endArrowType: 'triangle' }, objectName: `path arrow ${i + 1}` })
    })
  }

  // ------------------------------------------------------------------ 5. understanding
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'How it works' })
    kicker(s, 'Language')
    s.addText('Understanding how shopkeepers talk', { placeholder: 'title' })
    // one sentence, two meanings: the small word decides credit or paid
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 0.98, w: 9, h: 1.3, rectRadius: 0.1, fill: { color: HEX.redTint }, line: { type: 'none' }, objectName: 'decode band' })
    text(s, 'Same words, one small change', { x: 0.7, y: 1.05, w: 4, h: 0.28, fontSize: 11, bold: true, color: HEX.red, objectName: 'decode head' })
    const rows = [
      [[['Ramesh', 'customer'], ['ko', 'to him'], ['200', 'amount'], ['diye', 'gave']], 'credit', 'You gave Ramesh credit'],
      [[['Ramesh', 'customer'], ['ne', 'by him'], ['200', 'amount'], ['diye', 'gave']], 'paid', 'Ramesh paid you'],
    ]
    rows.forEach(([words, dir, meaning], r) => {
      const y = 1.38 + r * 0.44
      let x = 0.7
      words.forEach(([wd, role], i) => {
        const key = i === 1
        const ww = i === 0 ? 1.2 : 0.95
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: ww, h: 0.36, rectRadius: 0.06, fill: { color: key ? HEX.red : HEX.white }, line: { color: key ? HEX.red : HEX.line, width: 1 }, objectName: `decode ${r + 1}.${i + 1}` })
        text(s, [
          { text: wd, options: { bold: true, fontSize: 11.5, color: key ? HEX.white : HEX.ink } },
          { text: `  ${role}`, options: { fontSize: 8.5, color: key ? HEX.redTint : HEX.mute } },
        ], { x: x + 0.08, y, w: ww - 0.1, h: 0.36, valign: 'middle', objectName: `decode ${r + 1}.${i + 1} text` })
        x += ww + 0.08
      })
      s.addShape(pres.shapes.LINE, { x: x + 0.02, y: y + 0.18, w: 0.4, h: 0, line: { color: HEX.mute, width: 1.25, endArrowType: 'triangle' }, objectName: `decode ${r + 1} arrow` })
      const pill = dir === 'credit' ? HEX.credit : HEX.green
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.5, y, w: 0.9, h: 0.36, rectRadius: 0.18, fill: { color: pill }, line: { type: 'none' }, objectName: `decode ${r + 1} result` })
      text(s, dir === 'credit' ? 'Credit' : 'Paid', { x: x + 0.5, y, w: 0.9, h: 0.36, fontSize: 11.5, bold: true, color: HEX.white, align: 'center', valign: 'middle', objectName: `decode ${r + 1} result text` })
      text(s, meaning, { x: x + 1.52, y, w: 2.3, h: 0.36, fontSize: 11, italic: true, color: HEX.ink, valign: 'middle', objectName: `decode ${r + 1} meaning` })
    })

    const top = 2.42
    groupHead(s, 'What KhataBhai works out', 0.5, top, 4.4, 'own head')
    groupHead(s, 'What we use from Gnani', 5.1, top, 4.4, 'gnani head')
    const ch = 0.74
    const y0 = top + 0.36
    const own = [
      ['The amount', 'Number words in 10 languages (“sawa sau”, “ಮುನ್ನೂರ”). If 60 and 7 sound alike, it asks.'],
      ['The customer', 'A name it has not seen before is always read back before an account is opened.'],
      ['Spoken in pieces', 'A name, a pause, then the amount: it joins them, or asks for the missing part.'],
    ]
    own.forEach(([h, b], i) => plainCard(s, 0.5, y0 + i * (ch + 0.07), 4.4, ch, h, b, `own ${i + 1}`))
    const gn = [
      ['Prisma, speech to text', 'Live text while you speak, with your customers’ names given as hints.'],
      ['Timbre, text to speech', 'A voice for each language. Short replies are kept ready and play at once.'],
      ['Claude Haiku, only when needed', 'For unusual sentences. It can only pick an amount that was actually said.'],
    ]
    gn.forEach(([h, b], i) => plainCard(s, 5.1, y0 + i * (ch + 0.07), 4.4, ch, h, b, `gnani ${i + 1}`, i < 2 ? HEX.redTint : HEX.white))
  }

  // ------------------------------------------------------------------ 6. results
  pres.addSection({ title: 'Results' })
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'Results' })
    kicker(s, 'Results')
    s.addText('How it performs', { placeholder: 'title' })
    text(s, 'Timed on the live app, servers in Mumbai, in Hindi, Kannada, Tamil and Telugu.', { x: 0.5, y: 1.0, w: 9, h: 0.3, fontSize: 12, color: C.text2, objectName: 'results intro' })
    const stats = [
      ['0.8 s', 'from when you stop speaking to hearing the reply (typical)', HEX.red],
      ['1.3 s', 'for the slowest 1 in 20 replies, quiet shop or street noise', HEX.red],
      ['0.3 s', 'until the tick that tells you it heard you', HEX.red],
      ['0 ms', 'to read a normal entry: our own parser, no AI call', HEX.red],
    ]
    const w = (9 - 3 * 0.2) / 4
    stats.forEach(([b, l, fill], i) => {
      const x = 0.5 + i * (w + 0.2)
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.45, w, h: 1.5, rectRadius: 0.12, fill: { color: fill }, line: { type: 'none' }, objectName: `stat ${i + 1}` })
      text(s, b, { x: x + 0.2, y: 1.6, w: w - 0.4, h: 0.6, fontSize: 30, bold: true, color: HEX.white, fontFace: THEME.headFontFace, objectName: `stat ${i + 1} number` })
      text(s, l, { x: x + 0.2, y: 2.24, w: w - 0.4, h: 0.65, fontSize: 11.5, color: HEX.white, objectName: `stat ${i + 1} label` })
    })
    const cw = (9 - 0.2) / 2
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 3.15, w: cw, h: 1.5, rectRadius: 0.12, fill: { color: HEX.white }, line: { color: HEX.line, width: 1 }, objectName: 'safety card' })
    text(s, [
      { text: 'It asks instead of guessing', options: { bold: true, fontSize: 15, color: HEX.green, fontFace: THEME.headFontFace, breakLine: true } },
      { text: 'When it is noisy, the amount is large or two numbers sound alike (60 and 7), KhataBhai reads the entry back and waits for a yes. The AI model can only pick an amount that was actually said.', options: { fontSize: 11.5, color: HEX.ink } },
    ], { x: 0.72, y: 3.3, w: cw - 0.44, h: 1.3, paraSpaceAfter: 6, objectName: 'safety text' })
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5 + cw + 0.2, y: 3.15, w: cw, h: 1.5, rectRadius: 0.12, fill: { color: HEX.redTint }, line: { type: 'none' }, objectName: 'noise card' })
    text(s, [
      { text: 'Built for a noisy counter', options: { bold: true, fontSize: 15, color: HEX.red, fontFace: THEME.headFontFace, breakLine: true } },
      { text: 'The server measures the shop’s background noise and how loud each sentence is above it. Below 11 dB, every entry is read back before it is saved. Talk aimed at a customer is ignored, not written.', options: { fontSize: 11.5, color: HEX.ink } },
    ], { x: 0.5 + cw + 0.42, y: 3.3, w: cw - 0.44, h: 1.3, paraSpaceAfter: 6, objectName: 'noise text' })
  }

  // ------------------------------------------------------------------ 7. network + privacy
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'Results' })
    kicker(s, 'Reliability and privacy')
    s.addText('Bad networks and privacy', { placeholder: 'title' })
    band(s, 'When the network drops', 0.5, 1.0, 4.4, HEX.red, 'net band')
    band(s, 'Where the data lives', 5.1, 1.0, 4.4, HEX.ink, 'privacy band')
    const ch = 0.9
    const y0 = 1.5
    const net = [
      ['Nothing is lost quietly', 'Each saved entry carries a number the phone confirms. If the link breaks first, the entry is sent again and KhataBhai says so.'],
      ['A dead link is found fast', 'The phone checks the line every 4 s and reconnects after 9 s of silence, also when it switches between Wi-Fi and mobile data.'],
      ['Keeps what you said', 'Speech from the gap is replayed, and an open question like “सही है?” can still be answered.'],
    ]
    net.forEach(([h, b], i) => plainCard(s, 0.5, y0 + i * (ch + 0.08), 4.4, ch, h, b, `net ${i + 1}`, HEX.white, 12.5, 10.5))
    const priv = [
      ['On the shopkeeper’s phone', 'The ledger is encrypted (AES-GCM-256) with a key per customer. Deleting the key erases that customer for good.'],
      ['Changes can be traced', 'Entries are linked in a SHA-256 chain. A correction is a new entry; nothing is silently deleted.'],
      ['Customers are respected', 'It says it is an AI, never rates customers, and sends reminders only to adults who agreed. Backups are locked with a PIN first.'],
    ]
    priv.forEach(([h, b], i) => plainCard(s, 5.1, y0 + i * (ch + 0.08), 4.4, ch, h, b, `privacy ${i + 1}`, HEX.white, 12.5, 10.5))
    // what happens to one entry when the link drops
    const fy = 4.42
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: fy, w: 9, h: 0.68, rectRadius: 0.1, fill: { color: HEX.redTint }, line: { type: 'none' }, objectName: 'drop flow band' })
    const flow = [
      ['Entry #12 sent', HEX.white, HEX.ink],
      ['Link drops', HEX.credit, HEX.white],
      ['Back within 9 s', HEX.white, HEX.ink],
      ['#12 sent again', HEX.white, HEX.ink],
      ['Phone confirms #12', HEX.green, HEX.white],
    ]
    const fw = 1.42
    const fg = (9 - 0.4 - flow.length * fw) / (flow.length - 1)
    flow.forEach(([t, fill, color], i) => {
      const x = 0.7 + i * (fw + fg)
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: fy + 0.16, w: fw, h: 0.36, rectRadius: 0.18, fill: { color: fill }, line: { color: fill === HEX.white ? HEX.line : fill, width: 1 }, objectName: `drop step ${i + 1}` })
      text(s, t, { x, y: fy + 0.16, w: fw, h: 0.36, fontSize: 10.5, bold: true, color, align: 'center', valign: 'middle', objectName: `drop step ${i + 1} text` })
      if (i < flow.length - 1)
        s.addShape(pres.shapes.LINE, { x: x + fw + 0.05, y: fy + 0.34, w: fg - 0.1, h: 0, line: { color: HEX.red, width: 1.5, endArrowType: 'triangle' }, objectName: `drop arrow ${i + 1}` })
    })
  }

  // ------------------------------------------------------------------ 8. next + thank you
  pres.addSection({ title: 'Next' })
  {
    const s = pres.addSlide({ masterName: 'KB Close', sectionTitle: 'Next' })
    kicker(s, 'Roadmap', HEX.redTint)
    s.addText('What we are building next', { placeholder: 'title' })
    const next = [
      ['Faster answers', 'Gemini on Google Cloud in Mumbai for unusual sentences, once it is as careful as today.'],
      ['WhatsApp notifications', 'Payment reminders and account statements for customers who agree.'],
      ['Native app', 'An Android app that works offline and handles the microphone better.'],
      ['Payments', 'UPI payment links. When a customer pays, the entry is settled on its own.'],
    ]
    const w = (9 - 3 * 0.2) / 4
    next.forEach(([h, b], i) => {
      const x = 0.5 + i * (w + 0.2)
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.15, w, h: 1.75, rectRadius: 0.12, fill: { color: HEX.cream }, line: { type: 'none' }, objectName: `next ${i + 1} card` })
      text(s, String(i + 1).padStart(2, '0'), { x: x + 0.2, y: 1.28, w: 0.6, h: 0.3, fontSize: 11, bold: true, color: HEX.mute, objectName: `next ${i + 1} number` })
      text(s, [
        { text: h, options: { bold: true, fontSize: 14.5, color: HEX.red, fontFace: THEME.headFontFace, breakLine: true } },
        { text: b, options: { fontSize: 11.5, color: HEX.ink } },
      ], { x: x + 0.2, y: 1.58, w: w - 0.4, h: 1.25, paraSpaceAfter: 6, objectName: `next ${i + 1} text` })
    })
    text(s, 'Thank you', { x: 0.5, y: 4.05, w: 5, h: 0.7, fontSize: 36, bold: true, color: C.background1, fontFace: THEME.headFontFace, objectName: 'thanks' })
    text(s, [{ text: 'Try it at ', options: { color: C.background1 } }, { text: 'voice-khata-delta.vercel.app', options: { color: C.background1, bold: true, hyperlink: { url: 'https://voice-khata-delta.vercel.app' } } }], { x: 5.0, y: 4.2, w: 4.5, h: 0.35, fontSize: 14, align: 'right', objectName: 'live link' })
    text(s, 'Team Purrfect, Atria Institute of Technology', { x: 5.0, y: 4.55, w: 4.5, h: 0.3, fontSize: 11, color: C.background1, align: 'right', objectName: 'team close' })
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
