import { describe, it, expect } from 'vitest'
import { normalizeCountryCode } from './countryCode'

describe('normalizeCountryCode', () => {
  it('should uppercase valid ISO country codes', () => {
    expect(normalizeCountryCode('US')).toBe('US')
    expect(normalizeCountryCode('es')).toBe('ES')
    expect(normalizeCountryCode(' fr ')).toBe('FR')
    expect(normalizeCountryCode('UK')).toBe('UK')
  })

  it('should return null for codes that are not real countries', () => {
    expect(normalizeCountryCode('XXX')).toBeNull()
    expect(normalizeCountryCode('12')).toBeNull()
    expect(normalizeCountryCode('840')).toBeNull()
    expect(normalizeCountryCode('E')).toBeNull()
    expect(normalizeCountryCode('XX')).toBeNull()
  })

  it('should return null for missing values', () => {
    expect(normalizeCountryCode('')).toBeNull()
    expect(normalizeCountryCode('   ')).toBeNull()
    expect(normalizeCountryCode(null)).toBeNull()
    expect(normalizeCountryCode(undefined)).toBeNull()
  })
})
