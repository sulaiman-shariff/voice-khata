"""Generates eval/scenarios.json (kept as a script so the phrasing is easy to edit)."""
import json
from pathlib import Path

R, S, M = "c_ramesh", "c_suresh", "c_mohan"
def E(cid, paise, d, promise=False): return {"cid": cid, "paise": paise, "direction": d, "promise": promise}
def T(text, **expect): return {"say": text, "expect": expect}
def sc(id, kind, *turns): return {"id": id, "kind": kind, "turns": list(turns)}

def build(L):
    return [
        sc("credit", "credit", T(L["credit"], entries=[E(R, 34000, "credit")])),
        sc("pay_marker", "payment via case marker", T(L["pay_marker"], entries=[E(S, 10000, "payment")])),
        sc("pay_verb", "payment verb", T(L["pay_verb"], entries=[E(M, 50000, "payment")])),
        sc("new_customer", "new customer", T(L["new_customer"], entries=[E("new", 7000, "credit")])),
        sc("dedh_sau", "dedh sau / 150", T(L["dedh_sau"], entries=[E(R, 15000, "credit")])),
        sc("sawa_sau", "sawa sau / 125", T(L["sawa_sau"], entries=[E(S, 12500, "credit")])),
        sc("scale_1200", "1200 (elided/compound scale)", T(L["scale_1200"], entries=[E(M, 120000, "credit")])),
        sc("correct_amount", "correction of amount", T(L["c1"], entries=[E(R, 20000, "credit")]), T(L["c1_fix"], amend={"paise": 30000})),
        sc("query", "balance query", T(L["query"], said=["500"])),
        sc("missing_dir", "missing direction then one word", T(L["missing_dir"], pending="direction"), T(L["dir_word"], entries=[E(R, 40000, "credit")])),
        sc("promise", "promise to pay tomorrow", T(L["promise"], entries=[E(S, 20000, "payment", True)])),
        sc("two_entries", "two entries in one sentence", T(L["two"], entries=[E(R, 10000, "credit"), E(S, 5000, "payment")])),
        sc("confusable_60", "60 vs 7 confusable", T(L["conf60"], entries=[E(M, 6000, "payment")])),
        sc("give_credit", "shopkeeper gave -> credit", T(L["give"], entries=[E(R, 30000, "credit")])),
        sc("correct_dir", "correction of direction", T(L["d1"], entries=[E(S, 10000, "credit")]), T(L["d1_fix"], amend={"direction": "payment"})),
    ]

def cust(names):
    out = []
    for (cid, nm, al, bal) in names:
        out.append({"cid": cid, "name": nm, "aliases": al, "balancePaise": bal})
    return out

LANGS = {
 "hi": dict(dirc="उधार।", dirp="जमा।", locale="hi-IN", yes="हाँ।", no="नहीं।",
   customers=cust([(R,"रमेश",["Ramesh"],0),(S,"सुरेश",["Suresh"],50000),(M,"मोहन",["Mohan"],0)]),
   L=dict(credit="रमेश का तीन सौ चालीस रुपये उधार लिख दो।", pay_marker="सुरेश ने सौ रुपये दिए।", pay_verb="मोहन ने पाँच सौ रुपये वापस किए।",
     new_customer="गीता का सत्तर रुपये उधार लिखो।", dedh_sau="रमेश का डेढ़ सौ उधार।", sawa_sau="सुरेश का सवा सौ रुपये उधार।",
     scale_1200="मोहन का बारह सौ रुपये उधार।", c1="रमेश का दो सौ रुपये उधार।", c1_fix="नहीं, तीन सौ।",
     query="सुरेश का कितना बाकी है?", missing_dir="रमेश चार सौ।", dir_word="उधार।",
     promise="सुरेश कल दो सौ रुपये देगा।", two="रमेश का सौ रुपये उधार और सुरेश ने पचास रुपये जमा किए।",
     conf60="मोहन ने साठ रुपये दिए।", give="रमेश को तीन सौ रुपये दिए।", d1="सुरेश का सौ रुपये उधार।", d1_fix="नहीं, जमा।")),
 "kn": dict(dirc="ಸಾಲ.", dirp="ಜಮಾ.", locale="kn-IN", yes="ಹೌದು.", no="ಇಲ್ಲ.",
   customers=cust([(R,"ರಮೇಶ್",["Ramesh"],0),(S,"ಸುರೇಶ್",["Suresh"],50000),(M,"ಮೋಹನ್",["Mohan"],0)]),
   L=dict(credit="ರಮೇಶ್ ಅವರ ಮುನ್ನೂರ ನಲವತ್ತು ರೂಪಾಯಿ ಸಾಲ ಬರೆಯಿರಿ.", pay_marker="ಸುರೇಶ್ ನೂರು ರೂಪಾಯಿ ಕೊಟ್ಟರು.", pay_verb="ಮೋಹನ್ ಐನೂರು ರೂಪಾಯಿ ಕಟ್ಟಿದರು.",
     new_customer="ಗೀತಾ ಅವರ ಎಪ್ಪತ್ತು ರೂಪಾಯಿ ಸಾಲ.", dedh_sau="ರಮೇಶ್ ಅವರ ನೂರೈವತ್ತು ರೂಪಾಯಿ ಸಾಲ.", sawa_sau="ಸುರೇಶ್ ಅವರ ನೂರ ಇಪ್ಪತ್ತೈದು ರೂಪಾಯಿ ಸಾಲ.",
     scale_1200="ಮೋಹನ್ ಅವರ ಒಂದು ಸಾವಿರದ ಇನ್ನೂರು ರೂಪಾಯಿ ಸಾಲ.", c1="ರಮೇಶ್ ಅವರ ಇನ್ನೂರು ರೂಪಾಯಿ ಸಾಲ.", c1_fix="ಇಲ್ಲ, ಮುನ್ನೂರು.",
     query="ಸುರೇಶ್ ಅವರ ಬಾಕಿ ಎಷ್ಟು?", missing_dir="ರಮೇಶ್ ನಾನೂರು ರೂಪಾಯಿ.", dir_word="ಸಾಲ.",
     promise="ಸುರೇಶ್ ನಾಳೆ ಇನ್ನೂರು ರೂಪಾಯಿ ಕೊಡ್ತಾರೆ.", two="ರಮೇಶ್ ಅವರ ನೂರು ರೂಪಾಯಿ ಸಾಲ ಮತ್ತು ಸುರೇಶ್ ಐವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟರು.",
     conf60="ಮೋಹನ್ ಅರವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟರು.", give="ರಮೇಶ್‌ಗೆ ಮುನ್ನೂರು ರೂಪಾಯಿ ಕೊಟ್ಟೆ.", d1="ಸುರೇಶ್ ಅವರ ನೂರು ರೂಪಾಯಿ ಸಾಲ.", d1_fix="ಇಲ್ಲ, ಜಮಾ.")),
 "ta": dict(dirc="கடன்.", dirp="வரவு.", locale="ta-IN", yes="ஆமா.", no="இல்லை.",
   customers=cust([(R,"ரமேஷ்",["Ramesh"],0),(S,"சுரேஷ்",["Suresh"],50000),(M,"மோகன்",["Mohan"],0)]),
   L=dict(credit="ரமேஷுக்கு முன்னூற்று நாற்பது ரூபாய் கடன் எழுதுங்கள்.", pay_marker="சுரேஷ் நூறு ரூபாய் கட்டினார்.", pay_verb="மோகன் ஐநூறு ரூபாய் கொடுத்தார்.",
     new_customer="கீதாவுக்கு எழுபது ரூபாய் கடன்.", dedh_sau="ரமேஷ் நூற்று ஐம்பது ரூபாய் கடன்.", sawa_sau="சுரேஷ் நூற்று இருபத்தைந்து ரூபாய் கடன்.",
     scale_1200="மோகன் ஆயிரத்து இருநூறு ரூபாய் கடன்.", c1="ரமேஷ் இருநூறு ரூபாய் கடன்.", c1_fix="இல்லை, முன்னூறு.",
     query="சுரேஷுக்கு எவ்வளவு பாக்கி?", missing_dir="ரமேஷ் நானூறு ரூபாய்.", dir_word="கடன்.",
     promise="சுரேஷ் நாளைக்கு இருநூறு ரூபாய் கொடுப்பார்.", two="ரமேஷ் நூறு ரூபாய் கடன் மற்றும் சுரேஷ் ஐம்பது ரூபாய் கட்டினார்.",
     conf60="மோகன் அறுபது ரூபாய் கட்டினார்.", give="ரமேஷுக்கு முன்னூறு ரூபாய் கொடுத்தேன்.", d1="சுரேஷ் நூறு ரூபாய் கடன்.", d1_fix="இல்லை, வரவு.")),
 "te": dict(dirc="అప్పు.", dirp="జమ.", locale="te-IN", yes="అవును.", no="కాదు.",
   customers=cust([(R,"రమేష్",["Ramesh"],0),(S,"సురేష్",["Suresh"],50000),(M,"మోహన్",["Mohan"],0)]),
   L=dict(credit="రమేష్ కి మూడు వందల నలభై రూపాయలు అప్పు రాయండి.", pay_marker="సురేష్ వంద రూపాయలు కట్టాడు.", pay_verb="మోహన్ ఐదు వందల రూపాయలు ఇచ్చాడు.",
     new_customer="గీత డెబ్బై రూపాయలు అప్పు.", dedh_sau="రమేష్ నూట యాభై రూపాయలు అప్పు.", sawa_sau="సురేష్ నూట ఇరవై ఐదు రూపాయలు అప్పు.",
     scale_1200="మోహన్ వెయ్యి రెండు వందల రూపాయలు అప్పు.", c1="రమేష్ రెండు వందల రూపాయలు అప్పు.", c1_fix="కాదు, మూడు వందలు.",
     query="సురేష్ కి ఎంత బాకీ ఉంది?", missing_dir="రమేష్ నాలుగు వందలు.", dir_word="అప్పు.",
     promise="సురేష్ రేపు రెండు వందల రూపాయలు ఇస్తాడు.", two="రమేష్ వంద రూపాయలు అప్పు మరియు సురేష్ యాభై రూపాయలు ఇచ్చాడు.",
     conf60="మోహన్ అరవై రూపాయలు కట్టాడు.", give="రమేష్ కి మూడు వందల రూపాయలు ఇచ్చాను.", d1="సురేష్ వంద రూపాయలు అప్పు.", d1_fix="కాదు, జమ.")),
}
out = {"shopName": "Sharma Kirana", "langs": {}}
for k, v in LANGS.items():
    out["langs"][k] = {"locale": v["locale"], "yes": v["yes"], "dirCredit": v["dirc"], "dirPayment": v["dirp"], "no": v["no"], "customers": v["customers"], "scenarios": build(v["L"])}
Path(__file__).with_name("scenarios.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("ok", sum(len(l["scenarios"]) for l in out["langs"].values()))
