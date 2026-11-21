import { Network } from '@capacitor/network'
import { useEffect, useState } from 'react'
import { isNative } from '@/lib/native'

/** Is the device online? Native: Capacitor Network plugin; web: navigator.onLine + online/offline events. */
export function useOnline(): boolean {
  const [on, setOn] = useState(() => navigator.onLine)
  useEffect(() => {
    let dead = false
    if (isNative) {
      const h = Network.addListener('networkStatusChange', (s) => setOn(s.connected))
      Network.getStatus().then((s) => { if (!dead) setOn(s.connected) }).catch(() => {})
      return () => { dead = true; void h.then((x) => x.remove()).catch(() => {}) }
    }
    const up = () => setOn(true), down = () => setOn(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    setOn(navigator.onLine)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return on
}
