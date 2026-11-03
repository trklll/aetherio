/// <reference path="./anime-torrent-provider.d.ts" />

// Internet Archive (archive.org) torrent provider for Seanime.
// Every item has a torrent that archive.org itself seeds over HTTP (web seed), so the
// magnet links carry the .torrent URL (xs) and the web seed (ws) and work without peers.
// archive.org hosts a lot besides anime episodes (AMVs, reviews, YouTube mirrors...),
// so smart search filters hard on title, season, year and junk keywords.

const IA = "https://archive.org"

type IaDoc = {
    identifier: string
    title?: string | string[]
    item_size?: number
    downloads?: number
    publicdate?: string
    btih?: string
    format?: string[]
    collection?: string | string[]
}

type Parsed = {
    doc: IaDoc
    title: string
    episode: number // single episode number, -1 if none
    isBatch: boolean
}

type MediaInfo = {
    titles: string[]
    seasons: number[]
    related: string[] | null
}

const VIDEO_FORMATS = ["matroska", "mpeg4", "h.264", "h.264 ia", "512kb mpeg4", "avi", "divx", "webm", "ogg video", "mpeg2", "mpeg1", "quicktime", "windows media", "hevc"]

const JUNK_COLLECTIONS = ["mirrortube", "social-media-video", "tiktoks", "bilibili_videos", "youtubegraveyard", "podcasts-video", "twitchstreams",
    "movie_trailers", "movie_trailers_unsorted", "vhsopenings", "speedpaintingvids", "ytpmv-mad", "deemphasize", "vhsvault", "commercials", "vipernation-tv"]

const JUNK_WORDS = /\b(amv|amvs|mad|mmd|fandub|fan ?dub|fan ?made|fanmade|cosplay|reaction|reactions|review|reviews|trailer|trailers|promo|teaser|teasers|asmr|unboxing|explained|shorts|podcast|vod|livestream|gameplay|walkthrough|lets play|let s play|ost|soundtrack|music video|full album|manga|webtoon|manhwa|manhua|light novel|audiobook|audio book|3ds|cia|iso|dvdiso|bdiso|bdmv|video ts|umd|tiktok|parody|abridged|meme|memes|tier list|top \d+|analysis|theory|funny moments|edit|edits|opening|openings|ending|endings|op ed|vtuber|minecraft|roblox|fortnite|gacha|drawing|speedpaint|redraw|tutorial|figure|figures|haul|interview|panel|concert|live stage|live stages|stage play|musical|live action|tv drama|j drama|kdrama|commentary|watches|watching|watchalong|rewatch|mv|pv|cm|videoclip|videoclips|clip|clips|op \d+|ed \d+|ncop|nced|creditless|media history)\b/

// Adult uploads that are not tagged as hentai
const ADULT_WORDS = /\b(hentai|nsfw|xxx|porn|porno|sex|nude|nudes|onlyfans|jav|r18|erotic|lewd|sweetie fox)\b/

const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)\b/g

// Letters of scripts that norm() cannot transliterate (Cyrillic, Arabic, Thai, Japanese, Chinese, Korean)
const FOREIGN_SCRIPT = /[Ѐ-ӿ֐-ۿ฀-๿぀-ヿ㐀-鿿가-힯]+/g

const mediaCache: { [id: number]: MediaInfo } = {}

function norm(s: string): string {
    let out = (s || "").toLowerCase().replace(/×/g, "x")
    try {
        out = out.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    } catch (e) {}
    return out.replace(/[^a-z0-9]+/g, " ").trim()
}

// Like norm(), but words in other scripts stay visible as "zzforeign" so they still count as words
function normItem(s: string): string {
    return norm((s || "").replace(FOREIGN_SCRIPT, " zzforeign "))
}

function str(v: string | string[] | undefined): string {
    return Array.isArray(v) ? (v[0] || "") : (v || "")
}

function list(v: string | string[] | undefined): string[] {
    return Array.isArray(v) ? v : (v ? [v] : [])
}

function formatBytes(n: number): string {
    if (!n) return "0 B"
    const units = ["B", "KiB", "MiB", "GiB", "TiB"]
    let i = 0
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024
        i++
    }
    return n.toFixed(i ? 1 : 0) + " " + units[i]
}

function parseResolution(title: string): string {
    const t = title.toLowerCase()
    let m = t.match(/\b(2160|1080|720|576|540|480|360)\s*p\b/) || t.match(/\d{3,4}\s*x\s*(2160|1080|720|576|480|360)\b/)
    if (m) return m[1] + "p"
    if (/\b4k\b|\buhd\b/.test(t)) return "2160p"
    return ""
}

function releaseGroup(title: string): string {
    const m = title.match(/^\s*\[([^\]]{1,30})\]/)
    return m ? m[1].trim() : ""
}

// Season markers written in a title. "complete series" style returns [0] (= any season).
function seasonsIn(text: string): number[] {
    let t = norm(text)
    if (/\b(complete series|all seasons|complete collection|integrale|serie completa|komplette serie)\b/.test(t)) return [0]
    const out: number[] = []
    const add = (a: number, b: number) => {
        if (!(a > 0 && b >= a && b - a < 30)) return
        for (let i = a; i <= b; i++) if (out.indexOf(i) === -1) out.push(i)
    }
    const patterns: [RegExp, boolean][] = [
        // "seasons 1-3", "temporada 1 a 4", "s01&02", "s1-s3"
        [/\b(?:seasons?|temporadas?|staffeln?|saisons?)\s*0*(\d{1,2})\s+(?:(?:to|and|a|bis|und|y)\s+)?0*(\d{1,2})\b/g, true],
        [/\bs\s*0*(\d{1,2})\s+(?:(?:to|and|a|bis)\s+)?s?\s*0*(\d{1,2})\b(?!\s*e\s*\d)/g, true],
        // "2nd season", "2 sezon" (Turkish puts the number first), "season 2", "s02", "s02e05"
        [/\b0*(\d{1,2})(?:st|nd|rd|th)?\s*(?:season|sezon|temporada|staffel)\b/g, false],
        [/\b(?:season|temporada|staffel|saison|stagione)\s*0*(\d{1,2})\b/g, false],
        [/\bs\s*0*(\d{1,2})\b/g, false],
    ]
    for (const [re, isRange] of patterns) {
        let m: RegExpExecArray | null
        const used: string[] = []
        while ((m = re.exec(t))) {
            const a = parseInt(m[1])
            const b = isRange ? parseInt(m[2]) : a
            if (a > 0 && b >= a && b - a < 30) {
                add(a, b)
                used.push(m[0])
            }
        }
        // used markers must not feed the next pattern ("2nd season 01" is season 2, episode 1)
        for (const u of used) t = t.replace(u, " ")
    }
    return out
}

// Words that may follow the anime name without making it a different work
const ALLOWED_AFTER = /^(\d+|s\d+|e\d+|s\d+e\d+|complete|completo|completa|series|serie|season|seasons|temporada|temporadas|staffel|saison|sezon|ep|eps|episode|episodes|episodio|episodios|capitulo|capitulos|cap|folge|folgen|part|vol|volume|dub|dubbed|dublado|dublaj|doblaje|sub|subs|subbed|subtitles|subtitled|legendado|legendada|eng|english|jap|japanese|jpn|dual|audio|multi|latino|castellano|espanol|hindi|german|deutsch|ger|french|vostfr|vf|ita|rus|russian|turkce|pt|br|bd|bdrip|bluray|blu|ray|dvd|dvdrip|web|webrip|webdl|dl|hd|sd|fhd|hevc|x264|x265|h264|h265|av1|10bit|aac|flac|raw|raws|uncensored|tv|batch|collection|box|set|remastered|uncut|und|and|with|mit|by|anime|\d+p|4k|uhd|bolum|bolumler|yayini|cr|nf|amzn|ia|mp4|mkv|avi|version|edition|e|en|jp|v2)$/
// Words that only pass together with an allowed word after them ("full series", but not "full fights")
const CONNECTORS = /^(the|full|all)$/

const SITE_PREFIX = /^\s*(?:\[[^\]]*\]|\([^)]*\)|【[^】]*】|[\w-]+\.(?:com|net|org|plus|fun|tv|to|cc|me|io|site|xyz|in|club|info|ru|top)\b)\s*/i

// Season number written in an AniList title ("2nd Season", "Season 3", "Title 2", "Title II").
function titleSeason(title: string): number {
    const t = (title || "").toLowerCase().replace(/\s+(?:part|cour)\s*\d+\s*$/, "")
    let m: RegExpMatchArray | null
    if ((m = t.match(/(\d+)(?:st|nd|rd|th)\s+season/))) return parseInt(m[1])
    if ((m = t.match(/season\s*(\d+)/))) return parseInt(m[1])
    if ((m = t.match(/\s(\d{1,2})$/))) return parseInt(m[1])
    const roman: { [r: string]: number } = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6 }
    if ((m = t.match(/\s(ii|iii|iv|v|vi)$/))) return roman[m[1]]
    return 1
}

// Title without season/part markers ("Sousou no Frieren 2nd Season" -> "Sousou no Frieren").
function baseTitle(title: string): string {
    return title
        .replace(/\(?\b\d+(?:st|nd|rd|th)\s+season\b\)?/gi, "")
        .replace(/\b(?:season|part|cour)\s*\d+\b/gi, "")
        .replace(/\s+(?:ii|iii|iv|v|vi|\d{1,2})\s*$/i, "")
        .replace(/[\s:\-–]+$/, "")
        .trim()
}

// Titles of related anime (prequels, alternative versions...) from AniList; null when AniList is unavailable
async function relatedTitles(id: number): Promise<string[] | null> {
    try {
        const query = "query($id:Int){Media(id:$id){relations{edges{node{type title{romaji english} synonyms}}}}}"
        const res = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ query, variables: { id } }),
        })
        if (!res.ok) return null
        const data = await res.json() as any
        const out: string[] = []
        for (const edge of data.data.Media.relations.edges || []) {
            const n = edge.node
            if (!n || n.type !== "ANIME") continue
            for (const t of [n.title.romaji, n.title.english, ...(n.synonyms || [])]) {
                const x = norm(t || "")
                if (x && out.indexOf(x) === -1) out.push(x)
            }
        }
        return out
    } catch (e) {
        return null
    }
}

async function getMediaInfo(media: Media): Promise<MediaInfo> {
    if (mediaCache[media.id]) return mediaCache[media.id]
    const titles: string[] = []
    const add = (t: string | undefined) => {
        // Titles in other scripts would shrink to their Latin fragments ("외톨이 THE ROCK!" -> "the rock")
        if (t && /[a-z]/i.test(t) && !t.match(FOREIGN_SCRIPT) && titles.indexOf(t) === -1) titles.push(t)
    }
    add(media.romajiTitle)
    add(media.englishTitle)
    for (const s of media.synonyms || []) add(s)
    const seasons: number[] = []
    const [zip, related] = await Promise.all([
        fetch(`https://api.ani.zip/mappings?anilist_id=${media.id}`).then(r => r.ok ? r.json() : null).catch(() => null),
        relatedTitles(media.id),
    ])
    if (zip) {
        for (const k of Object.keys(zip.titles || {})) add(zip.titles[k])
        const eps = zip.episodes || {}
        for (const k of Object.keys(eps)) {
            const s = eps[k].seasonNumber
            if (/^\d+$/.test(k) && typeof s === "number" && s > 0 && seasons.indexOf(s) === -1) seasons.push(s)
        }
    }
    const info = { titles, seasons, related }
    // Without AniList data, try again next time
    if (related) mediaCache[media.id] = info
    return info
}

async function iaSearch(q: string, rows: number, sort: string): Promise<IaDoc[]> {
    const fl = ["identifier", "title", "item_size", "downloads", "publicdate", "btih", "format", "collection"].map(f => "fl[]=" + f).join("&")
    const url = `${IA}/advancedsearch.php?q=${encodeURIComponent(q)}&${fl}&rows=${rows}&page=1&output=json${sort ? "&sort[]=" + encodeURIComponent(sort) : ""}`
    // advancedsearch fails now and then under load: one retry
    let lastError = ""
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(url)
            if (!res.ok) {
                lastError = `HTTP ${res.status}`
                continue
            }
            const data = await res.json() as any
            if (data && data.response && data.response.docs) return data.response.docs
            lastError = "unexpected response"
        } catch (e) {
            lastError = String(e)
        }
    }
    throw new Error(`archive.org search failed: ${lastError}`)
}

const BASE_FILTER = `mediatype:movies AND format:"Archive BitTorrent" AND -collection:(${JUNK_COLLECTIONS.join(" OR ")})`

function isJunk(doc: IaDoc, allowAdult: boolean): boolean {
    const title = str(doc.title)
    const t = norm(title)
    if (!doc.btih || !title) return true
    if (/^(youtube|tiktok|bilibili|twitch|instagram|twitter|vimeo)[-_]/i.test(doc.identifier)) return true
    if (list(doc.collection).some(c => JUNK_COLLECTIONS.indexOf(c) !== -1)) return true
    if ((doc.item_size || 0) < 20 * 1024 * 1024) return true
    const formats = list(doc.format).map(f => f.toLowerCase())
    if (!formats.some(f => VIDEO_FORMATS.indexOf(f) !== -1)) return true
    if (JUNK_WORDS.test(t)) return true
    if (!allowAdult && ADULT_WORDS.test(t)) return true
    return false
}

// Episode number from the (normalized) part of the title after the anime name.
// "explicit" = written with an episode marker ("Episode 5", "S01E05"), not just a bare number.
function parseEpisode(rest: string): { episode: number, explicit: boolean } {
    const r = " " + rest
        .replace(YEAR_RE, " ")
        .replace(/\b\d{3,4}\s*p\b/g, " ")
        .replace(/\b\d{3,4}\s*x\s*\d{3,4}\b/g, " ")
        .replace(/\b(?:x|h)\s*26[45]\b/g, " ")
        .replace(/\b(?:10|8)\s*bit\b/g, " ")
        .replace(/\b(?:5|2|7)\s+1\b/g, " ")
        // season markers are not episode numbers ("1. Sezon - [1, 2, 3]", "Season 2 Cap 1")
        .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s*(?:season|sezon|temporada|staffel)\b/g, " ")
        .replace(/\b(?:seasons?|temporadas?|staffel|saison)\s*\d{1,2}\b/g, " ")
        .replace(/\bs\s*\d{1,2}\b(?!\s*e\s*\d)/g, " ") + " "
    const none = { episode: -1, explicit: false }
    // Ranges: "episodes 1-12", "ep1-23", "1 al 6", "01 26", "[1, 2, 3, 4. bolumler]"
    let m = r.match(/\b(?:episodes?|eps?|episodios?|capitulos?|caps?|folgen?)\s*(\d{1,4})\s+(?:(?:to|a|al|bis|and|y|e|ve)\s+)?(\d{1,4})\b/)
        || r.match(/^\s*(\d{1,4})\s+(?:(?:to|a|al|bis|and|y|e|ve)\s+)?(\d{1,4})\b/)
    if (m && parseInt(m[2]) > parseInt(m[1])) return none
    m = r.match(/\bs\s*\d{1,2}\s*e\s*(\d{1,4})\b/)
        || r.match(/\b(?:episode|episodio|episodi|ep|e|folge|capitulo|cap|chapter|bolum|odcinek)\s*(\d{1,4})\b/)
        || r.match(/\b(\d{1,4})\s*(?:bolum\w*|serie|seria|odcinek|wa|hua)\b/)
    if (m) return { episode: parseInt(m[1]), explicit: true }
    m = r.match(/^\s*(\d{1,4})\b/)
    if (m) return { episode: parseInt(m[1]), explicit: false }
    return none
}

function parseDoc(doc: IaDoc, rest: string, isMovie: boolean): Parsed {
    const title = str(doc.title)
    const ep = parseEpisode(rest)
    let episode = ep.episode
    // A bare number on a huge item is a season pack or a stream recording, not an episode
    if (episode > 0 && !ep.explicit && (doc.item_size || 0) > 3.5 * 1024 * 1024 * 1024 && !isMovie) episode = -1
    return { doc, title, episode, isBatch: !isMovie && episode < 0 }
}

function toTorrent(p: Parsed, episodeNumber: number, confirmed: boolean): AnimeTorrent {
    const id = p.doc.identifier
    const btih = (p.doc.btih || "").toLowerCase()
    const torrentUrl = `${IA}/download/${encodeURIComponent(id)}/${encodeURIComponent(id)}_archive.torrent`
    const magnet = `magnet:?xt=urn:btih:${btih}&dn=${encodeURIComponent(id)}`
        + `&tr=${encodeURIComponent("http://bt1.archive.org:6969/announce")}`
        + `&tr=${encodeURIComponent("http://bt2.archive.org:6969/announce")}`
        + `&ws=${encodeURIComponent(IA + "/download/")}`
        + `&xs=${encodeURIComponent(torrentUrl)}`
    const size = p.doc.item_size || 0
    return {
        name: p.title,
        date: p.doc.publicdate || "",
        size,
        formattedSize: formatBytes(size),
        // archive.org always seeds its torrents over HTTP (web seed)
        seeders: 1,
        leechers: 0,
        downloadCount: p.doc.downloads || 0,
        link: `${IA}/details/${encodeURIComponent(id)}`,
        downloadUrl: torrentUrl,
        magnetLink: magnet,
        infoHash: btih,
        resolution: parseResolution(p.title),
        isBatch: p.isBatch,
        episodeNumber,
        releaseGroup: releaseGroup(p.title),
        isBestRelease: false,
        confirmed,
    }
}

function quotePhrase(s: string): string {
    return "\"" + s.replace(/["\\]/g, " ").replace(/[:;!?()\[\]{}~^*]/g, " ").replace(/\s+/g, " ").trim() + "\""
}

function simpleTorrents(docs: IaDoc[], allowAdult: boolean): AnimeTorrent[] {
    return docs
        .filter(d => !isJunk(d, allowAdult))
        // Seanime parses episode/batch from the name when the episode number is -1
        .map(d => toTorrent({ doc: d, title: str(d.title), episode: -1, isBatch: false }, -1, false))
}

class Provider {
    getSettings(): AnimeProviderSettings {
        return {
            canSmartSearch: true,
            smartSearchFilters: ["batch", "episodeNumber", "query"],
            supportsAdult: false,
            type: "main",
        }
    }

    async getLatest(): Promise<AnimeTorrent[]> {
        const docs = await iaSearch(`collection:(anime_miscellaneous) AND ${BASE_FILTER}`, 60, "publicdate desc")
        return simpleTorrents(docs, false)
    }

    async search(opts: AnimeSearchOptions): Promise<AnimeTorrent[]> {
        const words = norm(opts.query).split(" ").filter(w => w.length > 0)
        if (!words.length) return this.getLatest()
        const docs = await iaSearch(`title:(${words.join(" AND ")}) AND ${BASE_FILTER}`, 100, "downloads desc")
        return simpleTorrents(docs, !!(opts.media && opts.media.isAdult))
    }

    async smartSearch(opts: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
        const media = opts.media
        const isMovie = media.format === "MOVIE"
        const info = await getMediaInfo(media)

        // Full titles (may name the season themselves), base titles (season markers removed)
        // and prefixes (the part before a colon, often the franchise: "Naruto: Shippuuden" -> "Naruto")
        const customQuery = (opts.query || "").trim()
        const fullTitles = customQuery ? [customQuery] : info.titles
        const usable = (n: string) => n.length >= 4 || n.indexOf(" ") !== -1
        const full = fullTitles.map(norm).filter(usable)
        const bases: string[] = []
        const prefixes: string[] = []
        const names: string[] = [] // search order: main titles first
        for (const t of fullTitles) {
            const b = norm(baseTitle(t))
            if (usable(b) && bases.indexOf(b) === -1) bases.push(b)
        }
        for (const t of fullTitles) {
            const b = norm(baseTitle(t))
            const p = norm(baseTitle(t.split(/:\s| - /)[0]))
            if (usable(b) && names.indexOf(b) === -1) names.push(b)
            if (usable(p) && bases.indexOf(p) === -1 && prefixes.indexOf(p) === -1) {
                prefixes.push(p)
                names.push(p)
            }
        }
        if (!names.length) return []
        // Names that also belong to a related anime need season or year evidence ("Fullmetal Alchemist" 2003 vs. Brotherhood).
        // The anime's own main titles never count as ambiguous.
        const own = [media.romajiTitle, media.englishTitle].map(x => norm(baseTitle(x || "")))
        const ambiguous = (n: string) => own.indexOf(n) === -1 && (
            prefixes.indexOf(n) !== -1 && (!info.related || info.related.indexOf(n) !== -1)
            || (!!info.related && info.related.indexOf(n) !== -1))

        const mediaSeasons = info.seasons.length ? info.seasons : [titleSeason(media.romajiTitle || media.englishTitle || "")]
        const startYear = media.startDate && media.startDate.year ? media.startDate.year : 0
        // Roughly how many years the anime ran (weekly: ~45 episodes a year)
        const yearSpan = media.status === "RELEASING" || !media.episodeCount ? 50 : Math.max(1, Math.ceil(media.episodeCount / 45))

        const phrases = names.slice(0, 10).map(quotePhrase).join(" OR ")
        const docs = await iaSearch(`title:(${phrases}) AND ${BASE_FILTER}`, 200, "downloads desc")
        // Later dubs and re-releases carry their own year, remakes are usually further away
        const yearFits = (y: number) => y >= startYear - 1 && y <= startYear + yearSpan + 3

        const singles: AnimeTorrent[] = []
        const batches: AnimeTorrent[] = []
        const seen: { [h: string]: boolean } = {}
        for (const doc of docs) {
            if (isJunk(doc, media.isAdult)) continue
            const btih = (doc.btih || "").toLowerCase()
            if (seen[btih]) continue
            const title = str(doc.title)
            let stripped = title
            while (SITE_PREFIX.test(stripped)) stripped = stripped.replace(SITE_PREFIX, "")
            const t = " " + normItem(stripped) + " "

            // The anime name must open the title (after group/site tags): "Boruto: Naruto ..." is not Naruto
            const opens = (n: string) => t.indexOf(" " + n + " ") === 0
            const fullHit = full.filter(opens).sort((a, b) => b.length - a.length)[0]
            const nameHit = names.filter(opens).sort((a, b) => b.length - a.length)[0]
            const hit = (fullHit && (!nameHit || fullHit.length >= nameHit.length)) ? fullHit : nameHit
            if (!hit) continue
            const namesItself = !!fullHit && hit === fullHit && bases.indexOf(fullHit) === -1
            const rest = t.slice(hit.length + 2).trim()
            const restWords = rest ? rest.split(" ") : []
            // Seasons can also hide in a leading tag ("[SEASON 2] Jujutsu Kaisen")
            const itemSeasons = seasonsIn(title.slice(0, title.length - stripped.length) + " " + rest)
            const years = (title.match(YEAR_RE) || []).map(y => parseInt(y))

            // Years must fit the anime
            if (startYear && years.length && !years.some(yearFits)) continue

            if (!namesItself && ambiguous(hit)) {
                const seasonProof = itemSeasons.length > 0 && itemSeasons.some(s => mediaSeasons.indexOf(s) !== -1)
                if (!seasonProof && !(startYear && years.some(yearFits))) continue
            }

            if (isMovie) {
                // Movie titles vary a lot: a base hit needs most of the subtitle words
                if (itemSeasons.length && itemSeasons[0] !== 0) continue
                if (!namesItself) {
                    const subtitle = norm(fullTitles[0] || "").split(" ").filter(w => w.length > 2 && hit.split(" ").indexOf(w) === -1 && !/^(the|movie|film|gekijouban)$/.test(w))
                    const pool = " " + norm(title) + " "
                    if (subtitle.length && subtitle.filter(w => pool.indexOf(" " + w + " ") !== -1).length / subtitle.length < 0.5) continue
                }
            } else {
                // A different subtitle after the name means another work ("Death Note: New Generation", "Kimetsu no Yaiba Yuukaku-hen")
                let k = 0
                while (k < restWords.length && CONNECTORS.test(restWords[k])) k++
                if (k > 0 && k === restWords.length) continue
                // the first two words (up to a number) must be release words ("SD Rock Lee" is a spin-off)
                let foreign = false
                for (let i = k; i < Math.min(k + 2, restWords.length) && !/\d/.test(restWords[i]); i++) {
                    if (!ALLOWED_AFTER.test(restWords[i])) foreign = true
                }
                if (foreign) continue
                if (/\b(movie|film|gekijouban|pelicula|final season)\b/.test(rest)) continue
                if (itemSeasons[0] !== 0) {
                    if (itemSeasons.length) {
                        if (!itemSeasons.some(s => mediaSeasons.indexOf(s) !== -1)) continue
                    } else if (!namesItself && mediaSeasons.indexOf(1) === -1) {
                        // no season written: first season only, unless the matched title names the sequel itself
                        continue
                    }
                }
            }

            const p = parseDoc(doc, rest, isMovie)
            seen[btih] = true

            if (isMovie) {
                singles.push(toTorrent(p, 1, false))
                continue
            }
            if (p.isBatch) {
                batches.push(toTorrent(p, -1, false))
                continue
            }
            // Later seasons are often numbered from the start of the series ("Attack on Titan 30")
            const absolute = mediaSeasons.indexOf(1) === -1 && media.absoluteSeasonOffset > 0 ? opts.episodeNumber + media.absoluteSeasonOffset : -1
            if (opts.episodeNumber > 0) {
                if (p.episode === opts.episodeNumber || p.episode === absolute) {
                    singles.push(toTorrent(p, opts.episodeNumber, true))
                }
            } else if (!opts.batch) {
                singles.push(toTorrent(p, p.episode, false))
            }
        }

        if (opts.batch) return isMovie ? singles : batches
        // Seanime sorts by seeders (all 1 here), so episode hits would drown between season packs:
        // packs only show up when archive.org has no upload of that single episode
        if (opts.episodeNumber > 0 && singles.length) return singles
        return singles.concat(batches)
    }

    async getTorrentInfoHash(torrent: AnimeTorrent): Promise<string> {
        return torrent.infoHash || ""
    }

    async getTorrentMagnetLink(torrent: AnimeTorrent): Promise<string> {
        return torrent.magnetLink || ""
    }
}
