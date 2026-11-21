/** POST /api/shop/register {name, lang} -> {shopId, secret}. See server/shop/api.ts. */
import { cors } from '../../server/http.js'
import { logged } from '../../server/log.js'
import { handleRegister } from '../../server/shop/api.js'

export default { fetch: cors(logged('shop', (req) => handleRegister(req, (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()))) }
