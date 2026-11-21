import { ChevronRight, Globe, MessageCircle, Mic, ShieldCheck } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { LANG_NAME, LANGS, type Lang } from '../../../shared/replies.js'
import { Logo, Wordmark } from '../Logo'
import { ONBOARD, both } from '../strings'

/** Starting language for auto mode: the phone's own language when we speak it, else Hindi. */
function phoneLang(): Lang {
  try {
    const l = (navigator.languages ?? [navigator.language]).map((x) => x.slice(0, 2)).find((x) => (LANGS as readonly string[]).includes(x) && x !== 'en')
    return (l as Lang | undefined) ?? 'hi'
  } catch {
    return 'hi'
  }
}

const list = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.25 } } }
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 30 } } } as const

/** Types each sample sentence out, holds it, erases it, then the next (static under reduced motion). */
function Typewriter({ lines }: { lines: readonly string[] }) {
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  const [n, setN] = useState(0)
  const [back, setBack] = useState(false)
  useEffect(() => {
    if (reduce) { const id = setInterval(() => setI((x) => (x + 1) % lines.length), 2200); return () => clearInterval(id) }
    const full = [...lines[i]].length
    const id = setTimeout(() => {
      if (!back && n < full) setN(n + 1)
      else if (!back) setBack(true)
      else if (n > 0) setN(n - 1)
      else { setBack(false); setI((x) => (x + 1) % lines.length) }
    }, !back && n === full ? 1400 : back ? 28 : 70)
    return () => clearTimeout(id)
  }, [i, n, back, lines, reduce])
  const text = reduce ? lines[i] : [...lines[i]].slice(0, n).join('')
  return <span aria-hidden>“{text}<span className="caret" />”</span>
}

export function Onboarding({ onPick }: { onPick: (l: Lang, auto: boolean) => void }) {
  const [step, setStep] = useState<'welcome' | 'lang'>('welcome')

  if (step === 'welcome') {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col overflow-y-auto px-6 pb-8" style={{ paddingTop: 'max(3.5rem, calc(env(safe-area-inset-top) + 1.5rem))' }}>
        <motion.div variants={list} initial="hidden" animate="show" className="flex flex-1 flex-col items-center text-center">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
            <Logo size={96} className="drop-shadow-md" />
          </motion.div>
          <motion.div variants={item} className="mt-6 text-sm font-medium tracking-[0.2em] text-gold uppercase">{both(ONBOARD.welcome)}</motion.div>
          <motion.h1 variants={item} className="mt-1 text-4xl font-semibold tracking-tight">KhataBhai</motion.h1>
          <motion.p variants={item} className="mt-3 text-lg text-muted-foreground">{ONBOARD.tagline[0]}<br />{ONBOARD.tagline[1]}</motion.p>
          <motion.div variants={item} className="mt-5 h-8 text-xl text-primary"><Typewriter lines={ONBOARD.samples} /></motion.div>
          <ul className="mt-8 w-full space-y-3 text-left">
            {([[Mic, ONBOARD.f1], [ShieldCheck, ONBOARD.f2], [MessageCircle, ONBOARD.f3]] as const).map(([Icon, [title, sub]]) => (
              <motion.li variants={item} key={title} className="flex items-start gap-3 rounded-2xl bg-card p-3.5 shadow-1 ring-1 ring-foreground/6">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/8 text-primary"><Icon className="size-5" /></span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-muted-foreground">{sub}</span>
                </span>
              </motion.li>
            ))}
          </ul>
        </motion.div>
        <motion.button
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
          onClick={() => setStep('lang')} className="mt-8 flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-2 active:scale-[.98]"
        >
          {both(ONBOARD.start)}<ChevronRight className="size-5" />
        </motion.button>
        <p className="mt-3 text-center text-xs text-muted-foreground">{both(ONBOARD.ai)}</p>
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} className="mx-auto flex h-full max-w-md flex-col overflow-y-auto px-5 pb-6" style={{ paddingTop: 'max(2rem, calc(env(safe-area-inset-top) + 1rem))' }}>
      <Wordmark size={48} />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">{both(ONBOARD.choose)}</h1>
      <div className="gold-rule mt-4" />
      <button onClick={() => onPick(phoneLang(), true)}
        className="mt-5 flex items-center gap-3 rounded-2xl bg-primary px-4 py-4 text-left text-primary-foreground shadow-2 active:scale-[.98]">
        <Globe className="size-7 shrink-0" />
        <span>
          <span className="block text-xl font-bold">{both(ONBOARD.auto)}</span>
          <span className="block text-sm opacity-90">{ONBOARD.autoHint[0]}</span>
        </span>
      </button>
      <motion.div variants={list} initial="hidden" animate="show" className="mt-3 grid grid-cols-2 content-start gap-2">
        {LANGS.map((l) => (
          <motion.button variants={item} key={l} onClick={() => onPick(l, false)}
            className="h-14 rounded-xl bg-card text-lg font-semibold shadow-1 ring-1 ring-foreground/8 active:scale-[.97]">
            {LANG_NAME[l]}
          </motion.button>
        ))}
      </motion.div>
    </motion.div>
  )
}
