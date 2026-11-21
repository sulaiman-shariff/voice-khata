/**
 * Synthetic busy-counter sessions. Background chatter (addressed:false) must never wake the
 * agent or save an entry; "KhataBhai ..." lines (addressed:true) must produce `expect`.
 */
export type ToolCall = { name: string; args: Record<string, unknown> }
export type Line = {
  text: string
  lang: 'hi-IN' | 'kn-IN' | 'en-IN'
  addressed: boolean
  expect?: ToolCall[]
}
export type Scene = { id: string; lines: Line[] }

type L = Line['lang']
const bg = (lang: L, text: string): Line => ({ text, lang, addressed: false })
const kb = (lang: L, text: string, expect: ToolCall[]): Line => ({ text, lang, addressed: true, expect })
const add = (name: string, amount: number, direction: 'credit' | 'payment' = 'credit'): ToolCall => ({
  name: 'add_entries',
  args: { entries: [{ name, amount, direction }] },
})
const show = (name: string): ToolCall => ({ name: 'show_customer', args: { name } })
const bal = (name: string): ToolCall => ({ name: 'query_balance', args: { name } })
const settle = (name: string): ToolCall => ({ name: 'settle', args: { name } })
const nfm: ToolCall = { name: 'not_for_me', args: {} }

export const SCENES: Scene[] = [
  { id: 's01_hi_basic_add', lines: [
    bg('hi-IN', 'भैया दो किलो चीनी और एक पैकेट चाय पत्ती देना'),
    bg('hi-IN', 'चीनी चालीस रुपये किलो है, चाय पत्ती एक सौ बीस की'),
    kb('hi-IN', 'खाताभाई, रमेश के खाते में तीन सौ रुपये उधार लिखो', [add('Ramesh', 300)]),
    bg('hi-IN', 'ठीक है भैया, कल पैसे दे दूँगा'),
  ] },
  { id: 's02_en_basic_add', lines: [
    bg('en-IN', 'Give me one litre of oil and two packets of biscuits please'),
    bg('en-IN', 'The oil is one hundred and eighty rupees today'),
    kb('en-IN', 'KhataBhai, add five hundred rupees credit for Suresh', [add('Suresh', 500)]),
    bg('en-IN', 'Thank you, I will pay on Saturday'),
  ] },
  { id: 's03_kn_basic_add', lines: [
    bg('kn-IN', 'ಅಣ್ಣ ಎರಡು ಕಿಲೋ ಅಕ್ಕಿ ಕೊಡಿ'),
    bg('kn-IN', 'ಅಕ್ಕಿ ಕಿಲೋಗೆ ಅರವತ್ತು ರೂಪಾಯಿ'),
    kb('kn-IN', 'ಖಾತಾಭಾಯ್, ಮಂಜುನಾಥ್ ಗೆ ಇನ್ನೂರು ರೂಪಾಯಿ ಸಾಲ ಬರೆಯಿರಿ', [add('Manjunath', 200)]),
    bg('kn-IN', 'ಸರಿ ಅಣ್ಣ, ನಾಳೆ ಕೊಡ್ತೀನಿ'),
  ] },
  { id: 's04_khata_alone_hi', lines: [
    bg('hi-IN', 'मेरा खाता कितना हो गया है भैया'),
    bg('hi-IN', 'खाता तो अगले हफ्ते साफ कर दूँगा'),
    bg('hi-IN', 'इस महीने का खाता बहुत भारी है'),
    bg('hi-IN', 'अच्छा चलो, फिर मिलते हैं'),
  ] },
  { id: 's05_khata_alone_en', lines: [
    bg('en-IN', 'Uncle, how much is my khata now?'),
    bg('en-IN', 'Do not write it in the khata, I will pay cash'),
    bg('en-IN', 'My khata is too long, I should clear it'),
    bg('en-IN', 'Okay bye, see you tomorrow'),
  ] },
  { id: 's06_khata_alone_kn', lines: [
    bg('kn-IN', 'ನನ್ನ ಖಾತಾ ಎಷ್ಟು ಆಗಿದೆ ಅಣ್ಣ'),
    bg('kn-IN', 'ಖಾತಾ ಮುಂದಿನ ವಾರ ಕ್ಲಿಯರ್ ಮಾಡ್ತೀನಿ'),
    bg('kn-IN', 'ಅಂಗಡಿ ಖಾತಾ ಪುಸ್ತಕ ಎಲ್ಲಿದೆ'),
  ] },
  { id: 's07_numbers_chatter_hi', lines: [
    bg('hi-IN', 'आटा दो सौ पचास का, दाल एक सौ अस्सी की, तेल तीन सौ का'),
    bg('hi-IN', 'कुल सात सौ तीस रुपये हुए'),
    bg('hi-IN', 'पाँच सौ अभी देता हूँ, बाकी दो सौ तीस बाद में'),
    bg('hi-IN', 'ठीक है, चलेगा'),
    bg('hi-IN', 'कल सुबह दूध भी भिजवा देना'),
  ] },
  { id: 's08_numbers_chatter_en', lines: [
    bg('en-IN', 'Rice is sixty, dal is one twenty, oil is one eighty'),
    bg('en-IN', 'Total comes to three hundred and sixty rupees'),
    bg('en-IN', 'I gave you five hundred, so return one forty'),
    bg('en-IN', 'Here is your change, hundred and forty'),
  ] },
  { id: 's09_numbers_chatter_kn', lines: [
    bg('kn-IN', 'ಬೇಳೆ ನೂರಾ ಇಪ್ಪತ್ತು, ಎಣ್ಣೆ ನೂರಾ ಎಂಬತ್ತು'),
    bg('kn-IN', 'ಒಟ್ಟು ಮುನ್ನೂರು ರೂಪಾಯಿ ಆಯ್ತು'),
    bg('kn-IN', 'ಐನೂರು ನೋಟು ಇದೆ, ಚಿಲ್ಲರೆ ಇದೆಯಾ'),
  ] },
  { id: 's10_mixed_add_hi_en', lines: [
    bg('hi-IN', 'भैया ये वाला साबुन कितने का है'),
    bg('hi-IN', 'पैंतीस रुपये का, two for sixty'),
    kb('hi-IN', 'खाताभाई, Priya ke naam pe four hundred rupees likh do', [add('Priya', 400)]),
    bg('hi-IN', 'बहुत बहुत धन्यवाद'),
  ] },
  { id: 's11_mixed_add_kn_en', lines: [
    bg('kn-IN', 'ಅಣ್ಣ ಈ ಸೋಪು ಎಷ್ಟು'),
    kb('kn-IN', 'KhataBhai, Lakshmi ge ಮುನ್ನೂರು ರೂಪಾಯಿ credit ಹಾಕಿ', [add('Lakshmi', 300)]),
    bg('kn-IN', 'ಸರಿ, ಥ್ಯಾಂಕ್ಯೂ'),
  ] },
  { id: 's12_repayment_hi', lines: [
    bg('hi-IN', 'भैया पिछले हफ्ते का पैसा लाया हूँ'),
    kb('hi-IN', 'खाताभाई, रमेश ने दो सौ रुपये वापस दिए', [add('Ramesh', 200, 'payment')]),
    bg('hi-IN', 'बाकी अगले महीने दूँगा'),
  ] },
  { id: 's13_repayment_en', lines: [
    bg('en-IN', 'I brought the money from last week'),
    kb('en-IN', 'KhataBhai, Suresh paid back three hundred rupees', [add('Suresh', 300, 'payment')]),
    bg('en-IN', 'The rest I will give on Monday'),
  ] },
  { id: 's14_show_customer_hi', lines: [
    bg('hi-IN', 'देखना ज़रा, कितना बकाया है'),
    kb('hi-IN', 'खाताभाई, रमेश का खाता दिखाओ', [show('Ramesh')]),
    bg('hi-IN', 'अच्छा, इतना हो गया'),
  ] },
  { id: 's15_show_customer_en', lines: [
    bg('en-IN', 'Let me check what is pending'),
    kb('en-IN', 'KhataBhai, show Suresh', [show('Suresh')]),
    bg('en-IN', 'Oh, that much already'),
  ] },
  { id: 's16_balance_kn', lines: [
    bg('kn-IN', 'ಎಷ್ಟು ಬಾಕಿ ಇದೆ ನೋಡಿ'),
    kb('kn-IN', 'ಖಾತಾಭಾಯ್, ಮಂಜುನಾಥ್ ಬಾಕಿ ಎಷ್ಟು', [bal('Manjunath')]),
    bg('kn-IN', 'ಓಹ್, ಅಷ್ಟೇನಾ'),
  ] },
  { id: 's17_balance_hi', lines: [
    bg('hi-IN', 'पता नहीं कितना बचा है'),
    kb('hi-IN', 'खाताभाई, प्रिया का कितना बाकी है', [bal('Priya')]),
    bg('hi-IN', 'ठीक है, मैं कल दे दूँगा'),
  ] },
  { id: 's18_balance_en', lines: [
    kb('en-IN', 'KhataBhai, how much does Lakshmi owe', [bal('Lakshmi')]),
    bg('en-IN', 'She said she will come in the evening'),
  ] },
  { id: 's19_settle_hi', lines: [
    bg('hi-IN', 'लो भैया, पूरा हिसाब चुका दिया'),
    kb('hi-IN', 'खाताभाई, रमेश का हिसाब बराबर करो', [settle('Ramesh')]),
    bg('hi-IN', 'चलो अब चैन मिला'),
  ] },
  { id: 's20_settle_en', lines: [
    bg('en-IN', 'Here, the full amount, all clear now'),
    kb('en-IN', 'KhataBhai, settle Suresh', [settle('Suresh')]),
    bg('en-IN', 'Good, no more dues'),
  ] },
  { id: 's21_settle_kn', lines: [
    bg('kn-IN', 'ತಗೊಳ್ಳಿ, ಪೂರ್ತಿ ಹಣ ಕೊಟ್ಟಿದ್ದೀನಿ'),
    kb('kn-IN', 'ಖಾತಾಭಾಯ್, ಲಕ್ಷ್ಮಿ ಲೆಕ್ಕ ಕ್ಲಿಯರ್ ಮಾಡಿ', [settle('Lakshmi')]),
  ] },
  { id: 's22_multi_entry_hi', lines: [
    bg('hi-IN', 'आज बहुत भीड़ है दुकान पर'),
    kb('hi-IN', 'खाताभाई, रमेश के सौ रुपये और सुरेश के दो सौ रुपये उधार लिखो', [
      { name: 'add_entries', args: { entries: [
        { name: 'Ramesh', amount: 100, direction: 'credit' },
        { name: 'Suresh', amount: 200, direction: 'credit' },
      ] } },
    ]),
    bg('hi-IN', 'अगला कौन है'),
  ] },
  { id: 's23_multi_entry_en', lines: [
    bg('en-IN', 'It is very crowded today'),
    kb('en-IN', 'KhataBhai, put fifty rupees for Priya and seventy for Lakshmi on credit', [
      { name: 'add_entries', args: { entries: [
        { name: 'Priya', amount: 50, direction: 'credit' },
        { name: 'Lakshmi', amount: 70, direction: 'credit' },
      ] } },
    ]),
    bg('en-IN', 'Next please'),
  ] },
  // Review Focus 2: credit talk that is NOT addressed to the app must save nothing
  { id: 's24_credit_talk_unaddressed_hi', lines: [
    bg('hi-IN', 'भैया रमेश के नाम पर दो सौ रुपये उधार लिख लो'),
    bg('hi-IN', 'हाँ हाँ, लिख दो उसके खाते में'),
    bg('hi-IN', 'सुरेश ने भी तीन सौ का सामान उधार लिया था'),
    bg('hi-IN', 'देखते हैं कौन पहले चुकाता है'),
  ] },
  { id: 's25_credit_talk_unaddressed_en', lines: [
    bg('en-IN', 'Please write five hundred rupees on credit for Suresh'),
    bg('en-IN', 'Yes put it in his khata, he is a regular'),
    bg('en-IN', 'Priya also took three hundred worth on credit last week'),
    bg('en-IN', 'I will remind her tomorrow'),
  ] },
  { id: 's26_credit_talk_unaddressed_kn', lines: [
    bg('kn-IN', 'ಮಂಜುನಾಥ್ ಗೆ ಇನ್ನೂರು ರೂಪಾಯಿ ಸಾಲ ಬರೆದುಕೊಳ್ಳಿ'),
    bg('kn-IN', 'ಹೌದು, ಅವರ ಖಾತೆಗೆ ಹಾಕಿ'),
    bg('kn-IN', 'ಲಕ್ಷ್ಮಿ ಕೂಡ ಸಾಲ ತಗೊಂಡಿದ್ರು'),
  ] },
  { id: 's27_near_miss_wake_hi', lines: [
    bg('hi-IN', 'खाता भाई साहब का बहुत पुराना है'),
    bg('hi-IN', 'भाई, खाता खोलना है नया'),
    bg('hi-IN', 'तुम्हारे भाई का खाता मैंने देखा था'),
    bg('hi-IN', 'अच्छा ठीक है'),
  ] },
  { id: 's28_near_miss_wake_en', lines: [
    bg('en-IN', 'Brother, the khata bhai-sahab keeps is very old'),
    bg('en-IN', 'My bhai wants to open a new khata'),
    bg('en-IN', 'Khata, bhai, ledger, all the same thing to him'),
  ] },
  { id: 's29_not_for_me_after_wake_en', lines: [
    kb('en-IN', 'KhataBhai, wait, I am talking to someone else', [nfm]),
    bg('en-IN', 'Yes madam, one kilo of sugar, coming'),
  ] },
  { id: 's30_not_for_me_after_wake_hi', lines: [
    kb('hi-IN', 'खाताभाई, रुको, मैं किसी और से बात कर रहा हूँ', [nfm]),
    bg('hi-IN', 'हाँ बहन जी, एक किलो चीनी, अभी देता हूँ'),
  ] },
  { id: 's31_busy_mix_1', lines: [
    bg('hi-IN', 'भैया एक सर्फ का पैकेट और दो साबुन'),
    bg('en-IN', 'How much for the detergent?'),
    bg('hi-IN', 'एक सौ दस रुपये'),
    kb('hi-IN', 'खाताभाई, सुरेश के एक सौ दस रुपये उधार लिखो', [add('Suresh', 110)]),
    bg('en-IN', 'Thank you uncle'),
    bg('hi-IN', 'अगली बार पैसे दे देना'),
  ] },
  { id: 's32_busy_mix_2', lines: [
    bg('kn-IN', 'ಅಣ್ಣ ಒಂದು ಲೀಟರ್ ಹಾಲು ಕೊಡಿ'),
    bg('kn-IN', 'ಹಾಲು ಐವತ್ತು ರೂಪಾಯಿ'),
    bg('en-IN', 'Do you have change for two hundred?'),
    kb('kn-IN', 'ಖಾತಾಭಾಯ್, ಲಕ್ಷ್ಮಿ ಐವತ್ತು ರೂಪಾಯಿ ಕೊಟ್ಟರು', [add('Lakshmi', 50, 'payment')]),
    bg('kn-IN', 'ಧನ್ಯವಾದ'),
  ] },
  { id: 's33_busy_mix_3', lines: [
    bg('en-IN', 'Is the new batch of rice here?'),
    bg('hi-IN', 'हाँ आज ही आया है, साठ रुपये किलो'),
    kb('en-IN', 'KhataBhai, show Priya', [show('Priya')]),
    bg('hi-IN', 'अच्छा, बाद में देखता हूँ'),
    kb('hi-IN', 'खाताभाई, प्रिया का हिसाब बराबर करो', [settle('Priya')]),
    bg('en-IN', 'Great, thank you'),
  ] },
  { id: 's34_two_requests_hi', lines: [
    kb('hi-IN', 'खाताभाई, रमेश का कितना बाकी है', [bal('Ramesh')]),
    bg('hi-IN', 'अरे वाह, कम हो गया'),
    kb('hi-IN', 'खाताभाई, रमेश ने पचास रुपये दिए', [add('Ramesh', 50, 'payment')]),
  ] },
  { id: 's35_two_requests_en', lines: [
    kb('en-IN', 'KhataBhai, how much does Suresh owe', [bal('Suresh')]),
    bg('en-IN', 'That is a lot, remind him'),
    kb('en-IN', 'KhataBhai, Suresh paid two hundred', [add('Suresh', 200, 'payment')]),
  ] },
  { id: 's36_phone_call_chatter', lines: [
    bg('hi-IN', 'हैलो हाँ, मैं दुकान पर हूँ'),
    bg('hi-IN', 'हाँ पाँच सौ रुपये का माल भेज दिया है'),
    bg('hi-IN', 'नहीं नहीं, उधार नहीं चलेगा इस बार, नकद चाहिए'),
    bg('en-IN', 'Okay, okay, I will call you back'),
  ] },
  { id: 's37_prices_only_kn', lines: [
    bg('kn-IN', 'ಸಕ್ಕರೆ ನಲವತ್ತೈದು ರೂಪಾಯಿ'),
    bg('kn-IN', 'ಬೇಳೆ ತೊಂಬತ್ತು, ಅಕ್ಕಿ ಐವತ್ತೆಂಟು'),
    bg('kn-IN', 'ಎಲ್ಲಾ ಸೇರಿ ಇನ್ನೂರ ತೊಂಬತ್ತು'),
    bg('kn-IN', 'ಚಿಲ್ಲರೆ ಇಲ್ಲ, ನಾಳೆ ಕೊಡ್ತೀನಿ'),
  ] },
  { id: 's38_mixed_code_switch', lines: [
    bg('hi-IN', 'Bhaiya ek packet Maggi dena aur ek Parle-G'),
    bg('hi-IN', 'Maggi fourteen rupees, Parle-G ten rupees'),
    kb('hi-IN', 'KhataBhai, Priya ka twenty four rupees udhaar likho', [add('Priya', 24)]),
    bg('hi-IN', 'Thanks bhaiya, kal milte hain'),
  ] },
  { id: 's39_long_background', lines: [
    bg('hi-IN', 'आज सब्ज़ी के दाम बहुत बढ़ गए हैं'),
    bg('hi-IN', 'टमाटर अस्सी रुपये किलो, प्याज़ चालीस'),
    bg('en-IN', 'Did you watch the cricket match yesterday?'),
    bg('en-IN', 'Yes, we scored two hundred and fifty runs'),
    bg('kn-IN', 'ಮಳೆ ಬರುತ್ತೆ ಅನ್ಸುತ್ತೆ, ಕೊಡೆ ತಗೊಂಡು ಹೋಗಿ'),
    bg('hi-IN', 'खाता खोलने के लिए आधार कार्ड चाहिए क्या'),
    bg('en-IN', 'No no, just your name and phone number'),
    bg('hi-IN', 'अच्छा ठीक है, कल लाता हूँ'),
  ] },
  // the real wake word inside chatter that is not an instruction: nothing may be written
  { id: 's41_wakeword_chatter_hi', lines: [
    bg('hi-IN', 'अरे बोलो खाताभाई वाले भैया को कल आना'),
    bg('hi-IN', 'तीन सौ रुपये माँग रहा था, पाँच सौ का नोट है उसके पास'),
    bg('hi-IN', 'खाताभाई ऐप बहुत अच्छा है, पड़ोस वाली दुकान पर भी लगा है'),
    bg('hi-IN', 'चीनी चालीस की, चाय पत्ती एक सौ बीस की'),
  ] },
  { id: 's42_wakeword_chatter_en', lines: [
    bg('en-IN', 'Tell the KhataBhai guy to come tomorrow, three hundred rupees he was asking'),
    bg('en-IN', 'My cousin also uses KhataBhai in his shop, he says it is good'),
    bg('en-IN', 'Sugar is forty five, dal is one twenty'),
    bg('en-IN', 'Do not forget, two hundred for the milk man'),
  ] },
  { id: 's43_wakeword_chatter_kn', lines: [
    bg('kn-IN', 'ಖಾತಾಭಾಯ್ ಹೇಳುವವರಿಗೆ ನಾಳೆ ಬರಲು ಹೇಳಿ'),
    bg('kn-IN', 'ಮುನ್ನೂರು ರೂಪಾಯಿ ಕೇಳ್ತಿದ್ರು, ಐನೂರು ನೋಟು ಇದೆ'),
    bg('kn-IN', 'ಖಾತಾಭಾಯ್ ಆಪ್ ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ ಅಂತ ಹೇಳಿದ್ರು'),
    bg('kn-IN', 'ಅಕ್ಕಿ ಅರವತ್ತು, ಬೇಳೆ ನೂರಾ ಇಪ್ಪತ್ತು'),
  ] },
  { id: 's44_wakeword_chatter_mixed', lines: [
    bg('hi-IN', 'Bhaiya, KhataBhai wala uncle kal aayega, do hundred lega'),
    bg('en-IN', 'Is KhataBhai working on your phone too?'),
    bg('hi-IN', 'हाँ, पर अभी रुको, पहले ग्राहक को निपटा लूँ, एक सौ साठ रुपये हुए'),
    bg('kn-IN', 'ಸರಿ ಅಣ್ಣ, ನಾನು ಆಮೇಲೆ ಬರ್ತೀನಿ'),
  ] },
  { id: 's40_long_with_two_wakes', lines: [
    bg('en-IN', 'Uncle, is the shop open on Sunday?'),
    bg('en-IN', 'Yes, till two in the afternoon'),
    bg('hi-IN', 'दूध का पैकेट छब्बीस रुपये का हो गया'),
    kb('hi-IN', 'खाताभाई, रमेश के छब्बीस रुपये उधार लिखो', [add('Ramesh', 26)]),
    bg('kn-IN', 'ಅಣ್ಣ ಇಲ್ಲಿ ಬನ್ನಿ ಒಂದು ನಿಮಿಷ'),
    bg('hi-IN', 'खाता नहीं, मैं नकद दूँगा'),
    kb('en-IN', 'KhataBhai, how much does Ramesh owe', [bal('Ramesh')]),
    bg('en-IN', 'Alright, thanks'),
  ] },
]
