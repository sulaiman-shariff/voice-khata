/** Run the voice function locally: npx tsx --env-file=.env eval/local_server.ts  (ws://localhost:8787, or PORT) */
import server from '../api/voice.js'

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => console.log(`voice function on ws://localhost:${port}`))
