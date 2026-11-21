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
  /** Split a string into runs so only the Indic words get the Indic font. */
  const INDIC_RE = /([ऀ-෿][ऀ-෿\s]*[ऀ-෿]|[ऀ-෿])/
  const runs = (str, opts) => str.split(INDIC_RE).filter(Boolean).map((t) => ({ text: t, options: INDIC_RE.test(t) ? { ...opts, fontFace: INDIC } : { ...opts } }))

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
    s.addText('How it works', { placeholder: 'title' })
    const TOP = 1.1
    const H = 2.0
    // the phone: a dark tile
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: TOP, w: 2.0, h: H, rectRadius: 0.14, fill: { color: HEX.ink }, line: { type: 'none' }, objectName: 'phone tile' })
    text(s, [
      { text: 'Your phone', options: { bold: true, fontSize: 15, color: HEX.white, fontFace: THEME.headFontFace, breakLine: true } },
      { text: ' ', options: { fontSize: 6, breakLine: true } },
      { text: 'You speak, tap or type', options: { fontSize: 11, color: HEX.line, breakLine: true } },
      { text: 'The reply is spoken back', options: { fontSize: 11, color: HEX.line, breakLine: true } },
      { text: 'The ledger stays here, encrypted', options: { fontSize: 11, color: HEX.line } },
    ], { x: 0.68, y: TOP + 0.18, w: 1.66, h: H - 0.3, objectName: 'phone text' })
    // phone <-> server: one arrow each way, labelled
    const oneWay = (x1, x2, y, label, name, labelAbove) => {
      s.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y, w: Math.abs(x2 - x1), h: 0, flipH: x2 < x1, line: { color: HEX.red, width: 2, endArrowType: 'triangle' }, objectName: name })
      text(s, label, { x: Math.min(x1, x2) - 0.05, y: labelAbove ? y - 0.3 : y + 0.06, w: Math.abs(x2 - x1) + 0.1, h: 0.24, fontSize: 9.5, color: C.text2, align: 'center', objectName: `${name} label` })
    }
    oneWay(2.55, 3.3, TOP + 0.75, 'your voice', 'voice up', true)
    oneWay(3.3, 2.55, TOP + 1.25, 'reply + entry', 'reply down', false)
    // the server: the brand-red tile in the middle
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.35, y: TOP, w: 2.5, h: H, rectRadius: 0.14, fill: { color: HEX.red }, line: { type: 'none' }, objectName: 'server tile' })
    text(s, [
      { text: 'KhataBhai server', options: { bold: true, fontSize: 15, color: HEX.white, fontFace: THEME.headFontFace, breakLine: true } },
      { text: 'runs in Mumbai', options: { fontSize: 10, color: HEX.redTint, breakLine: true } },
      { text: ' ', options: { fontSize: 6, breakLine: true } },
      { text: 'Knows when you have finished', options: { fontSize: 11, color: HEX.white, breakLine: true } },
      { text: 'Finds the name and amount', options: { fontSize: 11, color: HEX.white, breakLine: true } },
      { text: 'Asks when it is not sure', options: { fontSize: 11, color: HEX.white } },
    ], { x: 3.53, y: TOP + 0.18, w: 2.16, h: H - 0.3, objectName: 'server text' })
    // three services, equal tiles filling the same height as the server tile
    const svcH = (H - 2 * 0.12) / 3
    const svc = [
      ['Gnani Prisma', 'turns speech into text', true],
      ['Gnani Timbre', 'speaks the reply', true],
      ['Claude Haiku', 'only for unusual sentences', false],
    ]
    svc.forEach(([h, d, gnani], i) => {
      const y = TOP + i * (svcH + 0.12)
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.6, y, w: 2.9, h: svcH, rectRadius: 0.1, fill: { color: gnani ? HEX.redTint : HEX.white }, line: { color: gnani ? HEX.red : HEX.line, width: 1 }, objectName: `service ${i + 1}` })
      text(s, [
        { text: h, options: { bold: true, fontSize: 12.5, color: HEX.red, breakLine: true } },
        { text: d, options: { fontSize: 10.5, color: HEX.mute } },
      ], { x: 6.76, y, w: 2.6, h: svcH, valign: 'middle', objectName: `service ${i + 1} text` })
      s.addShape(pres.shapes.LINE, { x: 5.9, y: y + svcH / 2, w: 0.65, h: 0, line: { color: HEX.red, width: 1.5, beginArrowType: 'triangle', endArrowType: 'triangle' }, objectName: `service ${i + 1} link` })
    })

    // one turn: a single track with five steps and their times
    text(s, 'One turn', { x: 0.5, y: 3.36, w: 2, h: 0.26, fontSize: 13, bold: true, color: HEX.red, fontFace: THEME.headFontFace, objectName: 'turn kicker' })
    const steps = [
      ['0 s', 'You speak', 'in any of 10 languages'],
      ['0.3 s', 'A soft tick', 'so you know it heard you'],
      ['0.8 s', 'Words understood', 'text from Gnani Prisma'],
      ['0.85 s', 'Saved and confirmed', '“लिख दिया।”'],
    ]
    const x0 = 1.4
    const step = 2.4
    const trackY = 4.12
    s.addShape(pres.shapes.LINE, { x: x0, y: trackY, w: step * (steps.length - 1), h: 0, line: { color: HEX.line, width: 3 }, objectName: 'turn track' })
    steps.forEach(([t, h, d], i) => {
      const cx = x0 + i * step
      const last = i === steps.length - 1
      text(s, t, { x: cx - 0.8, y: 3.66, w: 1.6, h: 0.24, fontSize: 11, bold: true, color: last ? HEX.green : HEX.red, align: 'center', objectName: `step ${i + 1} time` })
      s.addShape(pres.shapes.OVAL, { x: cx - 0.13, y: trackY - 0.13, w: 0.26, h: 0.26, fill: { color: last ? HEX.green : HEX.red }, line: { color: HEX.cream, width: 2 }, objectName: `step ${i + 1} node` })
      text(s, h, { x: cx - 0.9, y: 4.32, w: 1.8, h: 0.26, fontSize: 12, bold: true, align: 'center', objectName: `step ${i + 1} name` })
      text(s, d, { x: cx - 0.9, y: 4.58, w: 1.8, h: 0.26, fontSize: 10, color: C.text2, align: 'center', fontFace: /[^\x00-\x7F“”]/.test(d) ? INDIC : undefined, objectName: `step ${i + 1} detail` })
    })
  }

  /** A plain card: heading and one or two sentences. No icons. */
  const plainCard = (slide, x, y, w, h, head, body, name, fill = HEX.white) => {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: fill }, line: { color: HEX.line, width: 1 }, objectName: name })
    text(slide, [
      { text: head, options: { bold: true, fontSize: 13.5, color: HEX.red, breakLine: true } },
      ...runs(body, { fontSize: 11.5, color: HEX.ink }),
    ], { x: x + 0.2, y: y + 0.16, w: w - 0.4, h: h - 0.26, paraSpaceAfter: 4, objectName: `${name} text` })
  }
  /** A small heading above a group of cards. */
  const groupHead = (slide, t, x, y, w, name) =>
    text(slide, t, { x, y, w, h: 0.3, fontSize: 15, bold: true, color: HEX.ink, fontFace: THEME.headFontFace, objectName: name })

  // ------------------------------------------------------------------ 4. understanding
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'How it works' })
    s.addText('Understanding how shopkeepers talk', { placeholder: 'title' })
    groupHead(s, 'What KhataBhai works out', 0.5, 1.0, 4.4, 'own head')
    const own = [
      ['The amount', 'Number words in all 10 languages, like “sawa sau” or “ಮುನ್ನೂರ”. If 60 and 7 sound alike, it asks which one.'],
      ['Credit or paid', 'From how the sentence is said: “Ramesh ko” means credit, “Ramesh ne diye” means he paid.'],
      ['The customer', '“ಸುರೇಶ್ ಹೆಸರಿಂದ” (in Suresh’s name) goes to Suresh instead of opening a new account.'],
    ]
    own.forEach(([h, b], i) => plainCard(s, 0.5, 1.4 + i * 1.18, 4.4, 1.06, h, b, `own ${i + 1}`))
    groupHead(s, 'What we use from Gnani', 5.1, 1.0, 4.4, 'gnani head')
    const gn = [
      ['Gnani Prisma, speech to text', 'Live text while you speak, customer names as hints, and a second listen when you switch language.'],
      ['Gnani Timbre, text to speech', 'A suitable voice for each language. Short replies are kept ready so they play at once.'],
      ['Claude Haiku, only when needed', 'For unusual sentences. It can only pick an amount that was actually said.'],
    ]
    gn.forEach(([h, b], i) => plainCard(s, 5.1, 1.4 + i * 1.18, 4.4, 1.06, h, b, `gnani ${i + 1}`, i < 2 ? HEX.redTint : HEX.white))
  }

  // ------------------------------------------------------------------ 5. results
  pres.addSection({ title: 'Results' })
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'Results' })
    s.addText('How it performs', { placeholder: 'title' })
    text(s, 'Measured on the live app (servers in Mumbai) with recorded test sentences in Hindi, Kannada, Tamil and Telugu.', { x: 0.5, y: 1.0, w: 9, h: 0.3, fontSize: 12, color: C.text2, objectName: 'results intro' })
    const stats = [
      ['0.8 s', 'from when you stop speaking to hearing the reply', HEX.red],
      ['0.3 s', 'until the tick that tells you it heard you', HEX.red],
      ['60 of 60', 'amounts written correctly in a quiet shop', HEX.red],
      ['56 of 60', 'amounts written correctly with street noise', HEX.red],
    ]
    const w = (9 - 3 * 0.2) / 4
    stats.forEach(([b, l, fill], i) => {
      const x = 0.5 + i * (w + 0.2)
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.5, w, h: 1.55, rectRadius: 0.12, fill: { color: fill }, line: { type: 'none' }, objectName: `stat ${i + 1}` })
      text(s, b, { x: x + 0.2, y: 1.66, w: w - 0.4, h: 0.6, fontSize: 30, bold: true, color: HEX.white, fontFace: THEME.headFontFace, objectName: `stat ${i + 1} number` })
      text(s, l, { x: x + 0.2, y: 2.3, w: w - 0.4, h: 0.65, fontSize: 11.5, color: HEX.white, objectName: `stat ${i + 1} label` })
    })
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 3.3, w: 9, h: 1.25, rectRadius: 0.12, fill: { color: HEX.white }, line: { color: HEX.line, width: 1 }, objectName: 'safety card' })
    text(s, [
      { text: 'No wrong amount was saved', options: { bold: true, fontSize: 15, color: HEX.green, fontFace: THEME.headFontFace, breakLine: true } },
      { text: 'When it is noisy, the amount is large or the sentence is unclear, KhataBhai reads the entry back and waits for a yes. In the 4 noisy misses it asked again instead of saving.', options: { fontSize: 12, color: HEX.ink } },
    ], { x: 0.75, y: 3.46, w: 8.5, h: 0.95, paraSpaceAfter: 6, objectName: 'safety text' })
  }

  // ------------------------------------------------------------------ 6. network + privacy
  {
    const s = pres.addSlide({ masterName: 'KB Content', sectionTitle: 'Results' })
    s.addText('Bad networks and privacy', { placeholder: 'title' })
    groupHead(s, 'When the network drops', 0.5, 1.0, 4.4, 'net head')
    const net = [
      ['Nothing is lost quietly', 'If the connection breaks mid-entry, KhataBhai saves it after reconnecting and says so.'],
      ['Reconnects on its own', 'Notices a dead connection within seconds, including when the phone switches between Wi-Fi and mobile data.'],
      ['Keeps what you said', 'Speech from the gap is replayed, and an open question like “सही है?” can still be answered.'],
    ]
    net.forEach(([h, b], i) => plainCard(s, 0.5, 1.4 + i * 1.18, 4.4, 1.06, h, b, `net ${i + 1}`))
    groupHead(s, 'Where the data lives', 5.1, 1.0, 4.4, 'privacy head')
    const priv = [
      ['On the shopkeeper’s phone', 'The ledger is encrypted on the phone, with a separate key for each customer.'],
      ['Changes can be traced', 'Every entry and correction is chained, so tampering shows. Nothing is ever silently deleted.'],
      ['Customers are respected', 'It says it is an AI, never rates customers, and sends reminders only to those who agreed.'],
    ]
    priv.forEach(([h, b], i) => plainCard(s, 5.1, 1.4 + i * 1.18, 4.4, 1.06, h, b, `privacy ${i + 1}`))
  }

  // ------------------------------------------------------------------ 7. next + thank you
  pres.addSection({ title: 'Next' })
  {
    const s = pres.addSlide({ masterName: 'KB Close', sectionTitle: 'Next' })
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
      text(s, [
        { text: h, options: { bold: true, fontSize: 14.5, color: HEX.red, fontFace: THEME.headFontFace, breakLine: true } },
        { text: b, options: { fontSize: 11.5, color: HEX.ink } },
      ], { x: x + 0.2, y: 1.32, w: w - 0.4, h: 1.45, paraSpaceAfter: 6, objectName: `next ${i + 1} text` })
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
