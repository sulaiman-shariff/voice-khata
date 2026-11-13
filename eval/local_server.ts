/** Run the voice function locally: npx tsx --env-file=.env eval/local_server.ts  (ws://localhost:8787) */
import server from '../api/voice.js'

server.listen(8787, () => console.log('voice function on ws://localhost:8787'))
