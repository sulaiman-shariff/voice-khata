import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const sdkDir = () => {
  const c = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk')]
  return c.find((d) => d && existsSync(d))
}
