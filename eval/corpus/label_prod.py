"""
Hand labels for the 21 Nov production sessions: what the shopkeeper meant. Run after
eval/logs_to_corpus.py to write eval/corpus/prod.json, the input of eval/replay.ts.

    python eval/corpus/label_prod.py raw.json > eval/corpus/prod.json

saves:  entries that should be written (name, rupees, credit|payment); each counts once
allow:  entries that are fine if written (the user tapped them, or the intent is unclear)
names:  canonical name -> spellings that count as that person (an account under any other
        name is a junk account)
customers: the ledger at the start of the session
"""
import json, sys

DEMO = ['Ramesh', 'Suresh', 'Mohan', 'Geeta']
N = {
    'Ramesh': ['Ramesh', 'रमेश', 'ರಮೇಶ್'], 'Suresh': ['Suresh', 'सुरेश', 'ಸುರೇಶ್'], 'Mohan': ['Mohan', 'मोहन', 'ಮೋಹನ್'],
    'Geeta': ['Geeta'], 'Mahi': ['Mahi', 'Mahe', 'ಮಾಹಿ'], 'Suleiman': ['Suleiman', 'Suleman', 'Sulaiman', 'ಸುಲೇಮಾನ್'],
}
def L(customers=DEMO, saves=(), allow=(), names=None):
    return {'customers': list(customers), 'saves': [list(x) for x in saves], 'allow': [list(x) for x in allow],
            'names': {k: N[k] for k in (names or list(customers))}}

LABELS = {
    'j4x7jtii': L(saves=[('Suresh', 100, 'payment')]),
    'cp9e1xi1': L(saves=[('Ramesh', 340, 'credit')]),
    '0z6vzk2q': L(saves=[('Mohan', 500, 'payment')]),
    '30t2wv6n': L(saves=[('Ramesh', 340, 'credit')]),
    '0t1ovdlh': L(saves=[('Suresh', 100, 'payment')]),
    'wzptvris': L(saves=[('Mohan', 500, 'payment')]),
    '9nvvae4m': L(saves=[('Suleiman', 300, 'payment'), ('Mahi', 400, 'payment')], names=DEMO + ['Mahi', 'Suleiman']),
    '9ar6jfi7': L(),  # talk about the app: nothing to write
    '52fvkgk7': L(saves=[('Ramesh', 340, 'credit')]),
    'ukk23ylv': L(saves=[('Suresh', 100, 'payment')]),
    'zhzsswb6': L(saves=[('Mohan', 500, 'payment')]),
    # "Sureshdu 300 rupees sala" = Suresh's 300 on credit; the retry was tapped "jama"
    '3r60qqqj': L(saves=[('Suresh', 300, 'credit')], allow=[('Suresh', 300, 'payment')]),
    'qqlfvsdq': L(saves=[('Suresh', 300, 'credit')], allow=[('Suresh', 300, 'payment')]),
    '0p6186uz': L(saves=[('Suresh', 300, 'credit')]),
    'atgkth5i': L(saves=[('Ramesh', 340, 'credit')]),
    'myte9dnr': L(saves=[('Ramesh', 340, 'credit')]),
    'yk2gcwjq': L(saves=[('Mohan', 500, 'payment')]),
    '561ou4gc': L(saves=[('Suresh', 100, 'payment')]),
    't894zw7r': L(saves=[('Suresh', 100, 'payment')]),
    '4rwr87yl': L(saves=[('Mohan', 500, 'payment')]),
    # "in Mahi's name", "write 300", udhaar; then Suleiman's account, write 300, credit
    '9l8xtcf6': L(saves=[('Mahi', 300, 'credit'), ('Suleiman', 300, 'credit')], names=DEMO + ['Mahi', 'Suleiman']),
    'keoyd742': L(),
    # "Mahi took 300", read back as "Your": the user said no every time
    'y49qpwl8': L(allow=[('Mahi', 300, 'credit')], names=DEMO + ['Mahi']),
    'usovg3e1': L(saves=[('Mahi', 300, 'credit')], allow=[('Mahi', 300, 'payment')], names=DEMO + ['Mahi']),
    'txrvbzxy': L(customers=DEMO + ['Mahi']),
    '6r4fgcd4': L(customers=DEMO + ['Mahi'], allow=[('Mahi', 300, 'credit')]),
    '35er5y2z': L(customers=DEMO + ['Mahi'], saves=[('Mahi', 300, 'credit'), ('Suleiman', 400, 'credit')], names=DEMO + ['Mahi', 'Suleiman']),
    'fzhgj2jc': L(customers=DEMO + ['Mahi', 'Suleiman'],
                  saves=[('Suleiman', 300, 'credit'), ('Suleiman', 300, 'payment'), ('Suleiman', 300, 'payment'),
                         ('Suleiman', 200, 'credit'), ('Suleiman', 300, 'payment')],
                  allow=[('Suleiman', 100, 'credit'), ('Suleiman', 200, 'credit')]),
}

raw = json.load(open(sys.argv[1], encoding='utf-8'))
out = []
for s in raw:
    lab = LABELS.get(s['sid'])
    if lab is None:
        print(f"unlabelled session {s['sid']}", file=sys.stderr)
        continue
    out.append({'sid': s['sid'], 'lang': s['lang'] or 'hi', 'steps': s['steps'], 'llm': s['llm'], **lab})
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
