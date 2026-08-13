const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

// ponytail: Intl instead of a hardcoded ISO-3166 table; it returns the input back when the
// region is unknown. Accepts 'ZZ' ("Unknown Region"), swap in an explicit list if that matters.
export function normalizeCountryCode(code?: string | null): string | null {
  const upper = code?.trim().toUpperCase()
  if (!upper || !/^[A-Z]{2}$/.test(upper)) return null
  return regionNames.of(upper) === upper ? null : upper
}
