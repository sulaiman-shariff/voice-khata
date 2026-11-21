/** PUT /api/receivables: the phone's mirror of opted-in customers who owe. See server/shop/api.ts. */
import { cors } from '../server/http.js'
import { logged } from '../server/log.js'
import { handleReceivables } from '../server/shop/api.js'

export default { fetch: cors(logged('receivables', handleReceivables)) }
