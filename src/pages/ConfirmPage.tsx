import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

interface LinkData {
  shop: string
  paise: number
  direction: 'credit' | 'payment'
  day: string
  lang: string
  status: 'pending' | 'confirmed' | 'disputed'
}

interface Strings {
  credit: string
  payment: string
  question: string
  yes: string
  no: string
  thanksYes: string
  thanksNo: string
  done: string
  expired: string
  error: string
  loading: string
}

const T: Record<string, Strings> = {
  en: {
    credit: 'Credit (udhaar)', payment: 'Payment (jama)', question: 'Is this correct?',
    yes: 'Yes, it is correct', no: 'No, it is wrong',
    thanksYes: 'Thank you. Marked as correct.', thanksNo: 'Thank you. The shopkeeper will see that you said it is wrong.',
    done: 'You have already answered this.', expired: 'This link has expired.', error: 'Something went wrong. Please try again.', loading: 'Loading...',
  },
  hi: {
    credit: 'उधार', payment: 'जमा', question: 'क्या यह सही है?',
    yes: 'हाँ, सही है', no: 'नहीं, गलत है',
    thanksYes: 'धन्यवाद। सही के रूप में दर्ज हो गया।', thanksNo: 'धन्यवाद। दुकानदार को पता चल जाएगा कि आपने इसे गलत बताया।',
    done: 'आप इसका जवाब पहले ही दे चुके हैं।', expired: 'यह लिंक समाप्त हो चुका है।', error: 'कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।', loading: 'लोड हो रहा है...',
  },
  kn: {
    credit: 'ಉದ್ರಿ', payment: 'ಜಮಾ', question: 'ಇದು ಸರಿಯೇ?',
    yes: 'ಹೌದು, ಸರಿ', no: 'ಇಲ್ಲ, ತಪ್ಪು',
    thanksYes: 'ಧನ್ಯವಾದ. ಸರಿ ಎಂದು ದಾಖಲಾಗಿದೆ.', thanksNo: 'ಧನ್ಯವಾದ. ನೀವು ತಪ್ಪು ಎಂದಿರುವುದು ಅಂಗಡಿಯವರಿಗೆ ತಿಳಿಯುತ್ತದೆ.',
    done: 'ನೀವು ಈಗಾಗಲೇ ಉತ್ತರಿಸಿದ್ದೀರಿ.', expired: 'ಈ ಲಿಂಕ್ ಅವಧಿ ಮುಗಿದಿದೆ.', error: 'ಏನೋ ತಪ್ಪಾಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.', loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ...',
  },
  ta: {
    credit: 'கடன்', payment: 'செலுத்தியது', question: 'இது சரியா?',
    yes: 'ஆம், சரி', no: 'இல்லை, தவறு',
    thanksYes: 'நன்றி. சரி என்று பதிவானது.', thanksNo: 'நன்றி. இது தவறு என்று நீங்கள் சொன்னது கடைக்காரருக்குத் தெரியும்.',
    done: 'நீங்கள் ஏற்கனவே பதிலளித்துவிட்டீர்கள்.', expired: 'இந்த இணைப்பு காலாவதியானது.', error: 'ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்.', loading: 'ஏற்றுகிறது...',
  },
  te: {
    credit: 'అప్పు', payment: 'జమ', question: 'ఇది సరైనదేనా?',
    yes: 'అవును, సరైనదే', no: 'కాదు, తప్పు',
    thanksYes: 'ధన్యవాదాలు. సరైనదిగా నమోదైంది.', thanksNo: 'ధన్యవాదాలు. మీరు తప్పు అన్నది షాపు యజమానికి తెలుస్తుంది.',
    done: 'మీరు ఇప్పటికే సమాధానం ఇచ్చారు.', expired: 'ఈ లింక్ గడువు ముగిసింది.', error: 'ఏదో తప్పు జరిగింది. మళ్లీ ప్రయత్నించండి.', loading: 'లోడ్ అవుతోంది...',
  },
  ml: {
    credit: 'കടം', payment: 'അടച്ചത്', question: 'ഇത് ശരിയാണോ?',
    yes: 'അതെ, ശരിയാണ്', no: 'അല്ല, തെറ്റാണ്',
    thanksYes: 'നന്ദി. ശരിയാണെന്ന് രേഖപ്പെടുത്തി.', thanksNo: 'നന്ദി. ഇത് തെറ്റാണെന്ന് നിങ്ങൾ പറഞ്ഞത് കടയുടമ അറിയും.',
    done: 'നിങ്ങൾ ഇതിന് ഇതിനകം മറുപടി നൽകി.', expired: 'ഈ ലിങ്കിന്റെ കാലാവധി കഴിഞ്ഞു.', error: 'എന്തോ തകരാർ സംഭവിച്ചു. ദയവായി വീണ്ടും ശ്രമിക്കുക.', loading: 'ലോഡ് ചെയ്യുന്നു...',
  },
  mr: {
    credit: 'उधार', payment: 'जमा', question: 'हे बरोबर आहे का?',
    yes: 'होय, बरोबर आहे', no: 'नाही, चुकीचे आहे',
    thanksYes: 'धन्यवाद. बरोबर म्हणून नोंदवले.', thanksNo: 'धन्यवाद. तुम्ही हे चुकीचे म्हटल्याचे दुकानदाराला कळेल.',
    done: 'तुम्ही यावर आधीच उत्तर दिले आहे.', expired: 'ही लिंक कालबाह्य झाली आहे.', error: 'काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा.', loading: 'लोड होत आहे...',
  },
  bn: {
    credit: 'বাকি', payment: 'জমা', question: 'এটা কি ঠিক?',
    yes: 'হ্যাঁ, ঠিক আছে', no: 'না, ভুল',
    thanksYes: 'ধন্যবাদ। ঠিক হিসেবে নথিভুক্ত হয়েছে।', thanksNo: 'ধন্যবাদ। আপনি এটাকে ভুল বলেছেন, দোকানদার তা জানতে পারবেন।',
    done: 'আপনি এর উত্তর আগেই দিয়েছেন।', expired: 'এই লিংকের মেয়াদ শেষ হয়ে গেছে।', error: 'কিছু একটা সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।', loading: 'লোড হচ্ছে...',
  },
  gu: {
    credit: 'ઉધાર', payment: 'જમા', question: 'શું આ સાચું છે?',
    yes: 'હા, સાચું છે', no: 'ના, ખોટું છે',
    thanksYes: 'આભાર. સાચા તરીકે નોંધાયું.', thanksNo: 'આભાર. તમે આને ખોટું કહ્યું તે દુકાનદારને ખબર પડશે.',
    done: 'તમે આનો જવાબ પહેલાં જ આપી દીધો છે.', expired: 'આ લિંકની મુદત પૂરી થઈ ગઈ છે.', error: 'કંઈક ગડબડ થઈ. કૃપા કરીને ફરી પ્રયાસ કરો.', loading: 'લોડ થઈ રહ્યું છે...',
  },
  pa: {
    credit: 'ਉਧਾਰ', payment: 'ਜਮ੍ਹਾ', question: 'ਕੀ ਇਹ ਸਹੀ ਹੈ?',
    yes: 'ਹਾਂ, ਸਹੀ ਹੈ', no: 'ਨਹੀਂ, ਗਲਤ ਹੈ',
    thanksYes: 'ਧੰਨਵਾਦ। ਸਹੀ ਵਜੋਂ ਦਰਜ ਹੋ ਗਿਆ।', thanksNo: 'ਧੰਨਵਾਦ। ਦੁਕਾਨਦਾਰ ਨੂੰ ਪਤਾ ਲੱਗ ਜਾਵੇਗਾ ਕਿ ਤੁਸੀਂ ਇਸਨੂੰ ਗਲਤ ਦੱਸਿਆ ਹੈ।',
    done: 'ਤੁਸੀਂ ਇਸਦਾ ਜਵਾਬ ਪਹਿਲਾਂ ਹੀ ਦੇ ਚੁੱਕੇ ਹੋ।', expired: 'ਇਸ ਲਿੰਕ ਦੀ ਮਿਆਦ ਪੁੱਗ ਚੁੱਕੀ ਹੈ।', error: 'ਕੁਝ ਗੜਬੜ ਹੋ ਗਈ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।', loading: 'ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ...',
  },
}

export function formatRupees(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })
}

type View = { k: 'loading' } | { k: 'expired' } | { k: 'error' } | { k: 'ready'; d: LinkData } | { k: 'answered'; d: LinkData; ans: 'confirmed' | 'disputed'; fresh: boolean }

export default function ConfirmPage({ token }: { token: string }) {
  const [view, setView] = useState<View>({ k: 'loading' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let off = false
    fetch(api(`/api/confirm?token=${encodeURIComponent(token)}`))
      .then(async (r) => {
        if (off) return
        if (r.status === 410 || r.status === 404) return setView({ k: 'expired' })
        if (!r.ok) return setView({ k: 'error' })
        const d = (await r.json()) as LinkData
        if (off) return
        setView(d.status === 'pending' ? { k: 'ready', d } : { k: 'answered', d, ans: d.status, fresh: false })
      })
      .catch(() => !off && setView({ k: 'error' }))
    return () => {
      off = true
    }
  }, [token])

  const lang = view.k === 'ready' || view.k === 'answered' ? view.d.lang : navigator.language.slice(0, 2)
  const t = T[lang] ?? T.en

  async function answer(d: LinkData, ans: 'confirmed' | 'disputed') {
    setBusy(true)
    setErr(false)
    try {
      const r = await fetch(api('/api/confirm'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, answer: ans }) })
      if (r.ok) setView({ k: 'answered', d, ans, fresh: true })
      else if (r.status === 409) setView({ k: 'answered', d, ans: ((await r.json()) as LinkData).status === 'disputed' ? 'disputed' : 'confirmed', fresh: false })
      else if (r.status === 410) setView({ k: 'expired' })
      else setErr(true)
    } catch {
      setErr(true)
    } finally {
      setBusy(false)
    }
  }

  const msg = (s: string) => <p className="text-center text-lg text-muted-foreground">{s}</p>

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-8">
      {view.k === 'loading' && msg(t.loading)}
      {view.k === 'expired' && msg(t.expired)}
      {view.k === 'error' && msg(t.error)}
      {(view.k === 'ready' || view.k === 'answered') && (
        <>
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold">{view.d.shop}</h1>
            <p className="text-5xl font-bold tracking-tight">{formatRupees(view.d.paise)}</p>
            <p className="text-lg">{view.d.direction === 'credit' ? t.credit : t.payment}</p>
            <p className="text-sm text-muted-foreground">
              {new Date(view.d.day + 'T00:00:00').toLocaleDateString(lang === 'en' ? 'en-IN' : `${T[lang] ? lang : 'en'}-IN`, { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          {view.k === 'ready' ? (
            <div className="flex flex-col gap-3">
              <p className="text-center text-xl font-medium">{t.question}</p>
              <Button size="lg" className="h-16 text-lg" disabled={busy} onClick={() => answer(view.d, 'confirmed')}>{t.yes}</Button>
              <Button size="lg" variant="outline" className="h-16 text-lg" disabled={busy} onClick={() => answer(view.d, 'disputed')}>{t.no}</Button>
              {err && <p className="text-center text-sm text-destructive">{t.error}</p>}
            </div>
          ) : (
            <p className="rounded-xl bg-muted p-4 text-center text-lg">
              {view.fresh ? (view.ans === 'confirmed' ? t.thanksYes : t.thanksNo) : t.done}
            </p>
          )}
        </>
      )}
    </main>
  )
}
