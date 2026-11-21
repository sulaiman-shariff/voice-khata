/**
 * Phone numbers as WhatsApp (and Vonage, and Razorpay) want them: country code + number, digits only.
 * The shopkeeper types numbers however they like ("98450 12345", "+91-98450-12345", "098450 12345");
 * a bare 10-digit Indian mobile gets 91 in front.
 */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null
  let d = raw.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1) // trunk prefix
  if (d.length === 10) d = `91${d}`
  if (d.length < 11 || d.length > 15) return null
  return d
}

/** Same number shown to a person: +91 98450 12345 (Indian), or +<digits>. */
export function displayPhone(digits: string): string {
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  return `+${digits}`
}
