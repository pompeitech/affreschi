// Vesuvius palette (placeholder): replace the hex values with the design system's.
// Every mod in affreschi keeps its own copy, because a plugin cannot import another plugin's files.
export const VESUVIUS = {
  lava: '#E4572E',
  magma: '#F28C28',
  sulfur: '#F2C14E',
  tuff: '#C9B79C',
  ash: '#8A8D91',
  gulf: '#2E86AB',
  vineyard: '#7A9E4E'
} as const

// The order categories take their colors in, warmest first.
export const SEQUENCE = [
  VESUVIUS.lava,
  VESUVIUS.magma,
  VESUVIUS.sulfur,
  VESUVIUS.tuff,
  VESUVIUS.gulf,
  VESUVIUS.vineyard
] as const
