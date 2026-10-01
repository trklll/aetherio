export function parseItemParam(typeOrSlug: string, idParam?: string): { id: number; media_type: "movie" | "tv" } | null {
  if (idParam) {
    const num = parseInt(idParam, 10)
    if (!isNaN(num) && num > 0) {
      const type = typeOrSlug === "tv" ? "tv" : "movie"
      return { id: num, media_type: type }
    }
  }

  const slug = typeOrSlug
  if (slug.includes("-")) {
    const parts = slug.split("-")
    const t = parts[0]
    const i = parts[parts.length - 1]
    const num = parseInt(i, 10)
    if (!isNaN(num) && num > 0) {
      return { id: num, media_type: t === "tv" ? "tv" : "movie" }
    }
  }

  const num = parseInt(slug, 10)
  if (!isNaN(num) && num > 0) {
    return { id: num, media_type: "movie" }
  }

  return null
}
