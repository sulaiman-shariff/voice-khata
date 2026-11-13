# Test audio sources and licenses

No real customer recordings, no team recordings, no cloned voices.

| Source | What we use | License | Where |
|---|---|---|---|
| Gnani Timbre v3.0 stock voices (Avinash, Lakshmi, Prakash, Riyaa) | Synthetic shopkeeper utterances | Generated with our Gnani API key; stock voices only | `wss://api.vachana.ai/api/v1/tts` |
| DEMAND: Diverse Environments Multichannel Acoustic Noise Database (Thiemann, Ito, Vincent, 2013) | `STRAFFIC` (busy street), `PCAFETER` (cafeteria babble), `SPSQUARE` (public square), channel 1, 16 kHz | CC BY 4.0 | https://zenodo.org/records/1227121, MD5-verified against Zenodo checksums |
| AI4Bharat IndicVoices (Hindi validation split) | "Indic babble": 4 real Hindi speakers overlapped to simulate customers chatting at the counter | CC BY 4.0 (gated; terms accepted by the team) | https://huggingface.co/datasets/ai4bharat/IndicVoices |

Wikimedia Commons was searched for Indian market ambience, and no suitable freely licensed recording was found. The iNoise Indian Noise Database was excluded because its license is not stated.
