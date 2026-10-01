/**
 * Normalizacion del genero que se muestra en el badge.
 *
 * El nombre llega crudo de TMDB (`details.genres[0].name`), y con `lang=es` solo
 * se traduce lo que TMDB tiene traducido. Los generos compuestos llegan
 * enteros: "Ciencia ficcion y fantasia", "Accion y aventura", "Guerra y politica".
 * Eso rompe dos cosas a la vez:
 *
 * 1. La composicion del badge. Un nombre largo obliga al clamp a reducir la
 *    fuente para que quepa, y el badge queda mas chico que el de un genero
 *    corto aunque el titulo sea identico.
 * 2. La lectura. "Crimen · 2013" se entiende; "Guerra y politica · 2013" hay que
 *    parsearlo.
 *
 * Asi que se parte por el " y " y se queda con la primera mitad, que es la que
 * TMDB ordena por relevancia dentro del genero. De ahi sale "Accion" en vez de
 * "Accion y aventura" y "Ciencia ficcion" en vez de "Ciencia ficcion y
 * fantasia", que es justo lo que se busca.
 *
 * Los generos que ya son una palabra o dos ("Sci-Fi", "Drama", "Animacion") no
 * se tocan. "Sci-Fi" en particular se deja tal cual a proposito: es el termino
 * que se usa en espanol y traducirlo a "Ciencia ficcion" no aporta nada y hace
 * el badge mas largo.
 */

// Generos compuestos de TMDB -> primera mitad, ya en espanol.
// La clave va en minusculas y sin acentos: TMDB cambia entre "accion"/"acción"
// segun el idioma y segun el endpoint, y comparar con tildes seria fragil.
const COMPOUND_GENRES: Record<string, string> = {
  "accion": "Acción",
  "accion y aventura": "Acción",
  "accion y aventuras": "Acción",
  "ciencia ficcion": "Ciencia ficción",
  "ciencia ficcion y fantasia": "Ciencia ficción",
  "aventura y accion": "Aventura",
  "guerra": "Guerra",
  "guerra y politica": "Guerra",
  "guerra, politica": "Guerra",
  "crimen": "Crimen",
  "crimen y misterio": "Crimen",
  "misterio": "Misterio",
  "misterio y crimen": "Misterio",
  "musical": "Musical",
  "musical y musica": "Musical",
  "musica y musical": "Música",
  "familia": "Familia",
  "deporte": "Deporte",
  "deporte y lucha": "Deporte",
  // Con ampersand. La clave es la mitad izquierda, pero "Sci-Fi" se devuelve
  // tal cual: es el termino que ya se usa en espanol y traducirlo a
  // "Ciencia ficción" solo alargaria el badge.
  "sci-fi": "Sci-Fi",
  "science fiction": "Sci-Fi",
  "war": "Guerra",
  "action": "Acción",
  "action & adventure": "Acción",
}

/**
 * Quita acentos y baja a minusculas, para comparar sin depender de como los
 * escribio el upstream. `normalize` de unicodeDependencyOption seria overkill
 * (y agrega un modulo) para once letras.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

/**
 * Devuelve el genero listo para pintar en el badge.
 *
 * Ante duda devuelve la entrada tal cual: un genero desconocido mejor se ve
 * como viene que se pierde o se inventa una traduccion.
 */
export function normalizeGenreLabel(raw: string | null | undefined): string {
  if (!raw) return ""
  const trimmed = raw.trim()
  if (!trimmed) return ""

  // Un " y " con espacios es la forma en que TMDB une los generos compuestos.
  // Sin espacios ("Accion&Aventura") no se toca, porque ahi no sabemos donde
  // cortar y partir a ciegas dejaria media palabra pegada.
  // El corte es insensible a mayusculas: TMDB devuelve "ACCION Y AVENTURA" en
  // algunos generos y "Acción y aventura" en otros.
  const parts = trimmed.split(/\s+y\s+/i)
  if (parts.length > 1) {
    const head = parts[0].trim()
    // "Acción y aventura" -> "Acción": si la mitad esta en el mapa, se usa la
    // version acentuada de ahi. Si no, se devuelve la mitad tal cual, que para
    // "Crimen" y "Misterio" ya es la forma correcta.
    return COMPOUND_GENRES[fold(head)] ?? head
  }

  // "Guerra, política" usa coma en vez de " y ".
  if (trimmed.includes(",")) {
    const head = trimmed.split(",")[0].trim()
    if (head) return COMPOUND_GENRES[fold(head)] ?? head
  }

  // " y " con ampersand, que es como Stremio y el endpoint de catalogo los
  // escriben: "Sci-Fi & Fantasy", "War & Politics", "Action & Adventure".
  // Se parte igual que el " y ". El orden importa: va despues de " y " para que
  // "Accion y aventura" no se confunda con un "&".
  const amp = trimmed.split(/\s+&\s+/i)
  if (amp.length > 1) {
    const head = amp[0].trim()
    return COMPOUND_GENRES[fold(head)] ?? head
  }

  return trimmed
}
