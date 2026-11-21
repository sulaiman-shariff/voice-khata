import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sdkDir } from './sdk.mjs'

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const jbr = 'C:/Program Files/Android/Android Studio/jbr'
if (!process.env.JAVA_HOME && existsSync(jbr)) process.env.JAVA_HOME = jbr
const sdk = sdkDir()
if (sdk) process.env.ANDROID_HOME = process.env.ANDROID_HOME || sdk

run('npm', ['run', 'cap:sync'])

const props = join('android', 'local.properties')
if (!existsSync(props)) {
  if (!sdk) { console.error('Android SDK not found. Install Android Studio or set ANDROID_HOME.'); process.exit(1) }
  const BS = String.fromCharCode(92)
  writeFileSync(props, `sdk.dir=${sdk.split(BS).join(BS + BS)}
`)
}

run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['assembleDebug'], { cwd: 'android' })
console.log('\nAPK:', resolve('android/app/build/outputs/apk/debug/app-debug.apk'))
