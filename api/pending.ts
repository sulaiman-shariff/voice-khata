/** GET /api/pending (payments and replies from customers), POST /api/pending {ids} (added to the khata). */
import { cors } from '../server/http.js'
import { logged } from '../server/log.js'
import { handlePending } from '../server/shop/api.js'

export default { fetch: cors(logged('pending', handlePending)) }
