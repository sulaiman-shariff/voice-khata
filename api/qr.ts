/** POST /api/qr {cid, paise, name?} a counter QR; GET/DELETE /api/qr?id= its status / close it. See server/pay/qr.ts. */
import { cors } from '../server/http.js'
import { logged } from '../server/log.js'
import { handleQr } from '../server/pay/qr.js'

export default { fetch: cors(logged('qr', (req) => handleQr(req))) }
