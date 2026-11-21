"""
Turn `vercel logs --json` dumps into replayable conversations for eval/replay.ts.

    vercel logs <deployment-url> --since 1h --limit 5000 --json --no-color > dump.jsonl
    python eval/logs_to_corpus.py dump.jsonl [more.jsonl ...] > eval/corpus/raw.json

Each session becomes {sid, lang, steps, llm}: steps are what the shopkeeper did, in order
(voice text as the server read it, taps, tap answers, typed text); llm maps each text the model
read to its logged reading, so a replay gives the same model answers with no API calls.
Expected outcomes are added by hand in eval/corpus/prod.json.
"""
import json, sys

lines, seen = [], set()
for f in sys.argv[1:]:
    for raw in open(f, encoding='utf-8'):
        try:
            r = json.loads(raw)
        except ValueError:
            continue
        for x in r.get('logs') or [{'message': r.get('message', '')}]:
            m = x.get('message', '')
            if m in seen:
                continue
            seen.add(m)
            try:
                j = json.loads(m)
            except ValueError:
                continue
            if j.get('sid'):
                lines.append(j)
lines.sort(key=lambda j: j['t'])

sessions = {}
for j in lines:
    s = sessions.setdefault(j['sid'], {'sid': j['sid'], 'start': j['t'], 'lang': None, 'steps': [], 'llm': {}, 'logged': []})
    ev = j['ev']
    if ev == 'hello':
        s['lang'] = j.get('lang')
    elif ev == 'input':
        k = j.get('kind')
        if k == 'tap':
            s['steps'].append({'tap': j['action']})
        elif k == 'answer':
            s['steps'].append({'answer': j['text']})
        elif k == 'typed':
            s['steps'].append({'type': j['text']})
    elif ev == 'turn' and j.get('src') == 'voice':
        s['steps'].append({'say': j['text']})
    elif ev == 'llm':
        s['llm'][j['text']] = j['reading']
    if ev == 'turn':
        s['logged'].append({'text': j.get('text'), 'reply': j.get('reply'), 'ops': [
            {k: v for k, v in o.items() if k in ('op', 'paise', 'direction')} for o in j.get('ops') or []]})

out = [s for s in sessions.values() if any('say' in st or 'type' in st for st in s['steps'])]
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
