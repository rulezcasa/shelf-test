// Placeholder data shaped like the backend models (app/src/models.py).
// Replace with API calls once the backend is wired up.

export type Variant = {
  variant_id: string
  source_file: string
  product_name: string
  price: number
  currency: string
  pricing_model: string
  key_features: string[]
  warranty: string
  return_policy: string
  shipping: string
  social_proof: string
  promotions: string | null
  citations: Record<string, { page: number; quote: string }>
}

export type Persona = {
  id: string
  label: string
  age_band: string
  income_band: string
  shopping_style: string
  location_type: string
  household: string
  price_sensitivity: string
  bio: string
}

export type Decision = {
  persona_id: string
  variant_id: string
  p_buy: number
  buy_confidence: number
  skip_reason: string
  skip_reason_probs: Record<string, number>
}

export const SKIP_REASONS = [
  'price',
  'missing_feature',
  'quality_trust',
  'shipping_returns',
  'unclear_value',
  'not_target_user',
] as const

export const SEGMENT_DIMENSIONS = [
  'age_band',
  'income_band',
  'shopping_style',
  'location_type',
  'household',
] as const

export const VARIANTS: Variant[] = [
  {
    variant_id: 'A',
    source_file: 'sample_A.pdf',
    product_name: 'AeroBlend Pro Blender',
    price: 129,
    currency: 'USD',
    pricing_model: 'one-time',
    key_features: ['1200W motor', '6 speed settings', '64 oz BPA-free jar', 'Self-clean mode'],
    warranty: '1-year limited warranty',
    return_policy: '30-day free returns',
    shipping: 'Free 2-day shipping',
    social_proof: '4.6★ from 2,340 reviews',
    promotions: null,
    citations: {
      price: { page: 1, quote: 'Only $129 — everything included.' },
      return_policy: { page: 2, quote: 'Not happy? Return within 30 days, free of charge.' },
      warranty: { page: 2, quote: 'Covered by our 1-year limited warranty.' },
    },
  },
  {
    variant_id: 'B',
    source_file: 'sample_B.pdf',
    product_name: 'AeroBlend Pro Blender',
    price: 99,
    currency: 'USD',
    pricing_model: 'one-time',
    key_features: [
      '1400W motor',
      '10 speed settings',
      '64 oz BPA-free jar',
      'Self-clean mode',
      '2 travel cups',
      'Smoothie presets',
    ],
    warranty: 'None',
    return_policy: '14-day returns, buyer pays shipping',
    shipping: 'Standard 5–7 day shipping',
    social_proof: '4.4★ from 860 reviews',
    promotions: 'Launch price: save $30',
    citations: {
      price: { page: 1, quote: 'Launch price $99 (was $129).' },
      return_policy: { page: 3, quote: 'Returns accepted within 14 days; return shipping at buyer’s expense.' },
    },
  },
]

// Small deterministic PRNG so the mock looks the same on every reload.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const AGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']
const INCOMES = ['<35k', '35-75k', '75-150k', '150k+']
const STYLES = ['bargain_hunter', 'researcher', 'brand_loyal', 'impulse', 'eco_conscious', 'convenience_first']
const LOCATIONS = ['urban', 'suburban', 'rural']
const HOUSEHOLDS = ['single', 'couple', 'family_with_kids', 'retiree', 'roommates']
const JOBS = ['nurse', 'teacher', 'barista', 'software engineer', 'retired', 'electrician', 'accountant', 'student']

const r = rng(7)
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]

export const PERSONAS: Persona[] = Array.from({ length: 60 }, (_, i) => {
  const age_band = AGES[i % AGES.length]
  const income_band = pick(INCOMES)
  const shopping_style = pick(STYLES)
  const location_type = pick(LOCATIONS)
  const household = age_band === '65+' ? 'retiree' : pick(HOUSEHOLDS.filter((h) => h !== 'retiree'))
  const job = age_band === '65+' ? 'retired' : pick(JOBS.filter((j) => j !== 'retired'))
  const price_sensitivity =
    income_band === '<35k' || shopping_style === 'bargain_hunter' ? 'high' : income_band === '150k+' ? 'low' : 'medium'
  return {
    id: `P${String(i + 1).padStart(3, '0')}`,
    label: `${age_band}, ${location_type} ${job}`,
    age_band,
    income_band,
    shopping_style,
    location_type,
    household,
    price_sensitivity,
    bio: `A ${job} in a ${location_type} area, household income ${income_band}. Shopping style: ${shopping_style.replace('_', ' ')}. Price sensitivity: ${price_sensitivity}.`,
  }
})

export const DECISIONS: Decision[] = PERSONAS.flatMap((p) =>
  VARIANTS.map((v) => {
    let p_buy = 0.35 + r() * 0.4
    if (v.variant_id === 'B') p_buy += p.price_sensitivity === 'high' ? 0.15 : 0.01
    if (v.variant_id === 'B' && p.household === 'retiree') p_buy -= 0.2
    p_buy = Math.min(0.97, Math.max(0.03, p_buy))
    const probs: Record<string, number> = {}
    SKIP_REASONS.forEach((k) => (probs[k] = r()))
    if (v.variant_id === 'B') probs.shipping_returns += 0.45
    if (p.price_sensitivity === 'high') probs.price += v.variant_id === 'A' ? 0.8 : 0.3
    const total = Object.values(probs).reduce((a, b) => a + b, 0)
    Object.keys(probs).forEach((k) => (probs[k] = probs[k] / total))
    const skip_reason = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0]
    return {
      persona_id: p.id,
      variant_id: v.variant_id,
      p_buy,
      buy_confidence: 0.45 + r() * 0.5,
      skip_reason,
      skip_reason_probs: probs,
    }
  }),
)

// Display order for segment groups (anything not listed sorts alphabetically).
export const GROUP_ORDER: Record<string, string[]> = {
  age_band: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'],
  income_band: ['<35k', '35-75k', '75-150k', '150k+'],
  price_sensitivity: ['high', 'medium', 'low'],
  location_type: ['urban', 'suburban', 'rural'],
}
