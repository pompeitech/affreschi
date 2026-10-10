// Palette Vesuvius (provvisoria): sostituisci gli esadecimali con quelli del design system.
// La stessa palette è copiata in ogni mod di affreschi, perché un plugin non può importare file di un altro.
export const VESUVIUS = {
  lava: '#E4572E',
  magma: '#F28C28',
  zolfo: '#F2C14E',
  tufo: '#C9B79C',
  cenere: '#8A8D91',
  golfo: '#2E86AB',
  vigna: '#7A9E4E',
} as const

// L'ordine in cui le categorie si prendono i colori, dal più caldo al più freddo.
export const SEQUENZA = [
  VESUVIUS.lava,
  VESUVIUS.magma,
  VESUVIUS.zolfo,
  VESUVIUS.tufo,
  VESUVIUS.golfo,
  VESUVIUS.vigna,
] as const
