// Sample the original shares at the centre of each block so tiny categories do not inflate usage.
export function blockColors(parts: readonly { weight: number; color: string }[], count: number) {
  const total = parts.reduce((sum, part) => sum + part.weight, 0)
  const colors: string[] = []
  let offset = 0

  for (const part of parts) {
    offset += part.weight

    while (colors.length < count && (colors.length + 0.5) * total < offset * count) {
      colors.push(part.color)
    }
  }

  return colors
}

export function blockSvg(colors: readonly string[]) {
  const width = Math.max(1, colors.length * 12 - 2)
  const blocks = colors.map(
    (color, i) => `<rect x="${i * 12}" width="10" height="8" rx="2.5" fill="${color}"/>`
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">${blocks.join('')}</svg>`
}
