/** Builds an attachment header without copying control characters into HTTP headers. */
export function attachmentDisposition(fileName: string) {
  const safeFileName = Array.from(fileName, (character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f ? '_' : character
  }).join('')
  const fallback = safeFileName.replace(/[^\x20-\x7e]|["\\;]/g, '_')
  const encoded = encodeURIComponent(safeFileName).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
