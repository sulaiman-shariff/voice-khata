import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { sdkDir } from './sdk.mjs'

const sdk = sdkDir()
const adb = sdk && join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
if (!adb || !existsSync(adb)) { console.error('adb not found. Install Android Studio (SDK platform-tools) or set ANDROID_HOME.'); process.exit(1) }
const r = spawnSync(adb, ['install', '-r', 'android/app/build/outputs/apk/debug/app-debug.apk'], { stdio: 'inherit' })
process.exit(r.status ?? 1)
