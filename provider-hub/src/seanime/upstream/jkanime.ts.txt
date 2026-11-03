/// <reference path="./online-streaming-provider.d.ts" />

class Provider {

    baseUrl = "https://jkanime.net"

    getSettings(): Settings {
        return {
            episodeServers: ["JK", "Desu", "Okru", "YourUpload", "StreamWish", "DoodStream", "FileMoon", "Voe"],
            supportsDub: false,
        }
    }

    /**
     * Strips the base URL and leading/trailing slashes from a full href,
     * returning a clean relative ID (e.g. "shingeki-no-kyojin").
     */
    private _cleanId(href: string): string {
        return href
            .replace(this.baseUrl, "")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "")
    }

    /**
     * Searches JKAnime for anime matching the given query.
     * Scrapes the search results page and extracts title + ID from each
     * `.anime__item__text` anchor.
     */
    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const query = encodeURIComponent(opts.query)
        const url = `${this.baseUrl}/buscar/${query}/`

        const res = await fetch(url, { credentials: "include" })
        if (!res.ok) return []

        const html = await res.text()

        const results: SearchResult[] = []
        // Each result block contains a link inside .anime__item__text; capture href and title.
        const pattern = /class="anime__item__text"[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
        let match: RegExpExecArray | null

        while ((match = pattern.exec(html)) !== null) {
            const href = match[1].trim()
            // Strip any inline tags from the title (e.g. <span> badges).
            const title = match[2].replace(/<[^>]+>/g, "").trim()
            const id = this._cleanId(href)
            if (!id || !title) continue
            results.push({ id, title, url: `${this.baseUrl}/${id}/`, subOrDub: "sub" })
        }

        return results
    }

    /**
     * Fetches published episodes from the paginated AJAX API. The current API
     * requires POST, the page's CSRF token and its matching session cookies.
     * Retains the legacy parser for pages using the previous layout.
     */
    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const url = `${this.baseUrl}/${id}/`

        const res = await fetch(url, { credentials: "include" })
        if (!res.ok) throw new Error(`JKAnime: failed to load series ${id} (HTTP ${res.status})`)

        const html = await res.text()

        const episodes: EpisodeDetails[] = []
        const seen = new Set<number>()

        const addEp = (number: number, epId?: string, title?: string) => {
            if (!Number.isFinite(number) || number <= 0 || seen.has(number)) return
            seen.add(number)
            episodes.push({
                id: epId ?? `${id}/${number}`,
                number,
                url: `${this.baseUrl}/${id}/${number}/`,
                title: title ?? `Episodio ${number}`,
            })
        }

        // Laravel pagination returns { data, last_page, per_page, total }.
        // The visible "Episodios" count can be 0 for a series already airing.
        const currentApiMatch = html.match(/ajax\/episodes\/(\d+)\//)
        if (currentApiMatch) {
            const tokenMatch = html.match(/<meta\b[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i)
            if (!tokenMatch) throw new Error(`JKAnime: missing CSRF token for ${id}`)

            // Seanime exposes cookies as a record; credentials alone does not
            // forward the session obtained with the series page.
            const cookies = (res as { cookies?: Record<string, string> }).cookies ?? {}
            const headers: Record<string, string> = {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": url,
                "Origin": this.baseUrl,
            }
            const cookieHeader = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ")
            if (cookieHeader) headers["Cookie"] = cookieHeader

            const fetchPage = async (page: number) => {
                const response = await fetch(`${this.baseUrl}/ajax/episodes/${currentApiMatch[1]}/${page}`, {
                    method: "POST",
                    headers,
                    body: `_token=${encodeURIComponent(tokenMatch[1])}`,
                })
                if (!response.ok) {
                    throw new Error(`JKAnime: episode page ${page} failed (HTTP ${response.status})`)
                }
                const data = await response.json()
                if (!data || !Array.isArray(data.data)) {
                    throw new Error(`JKAnime: invalid episode response on page ${page}`)
                }
                return data
            }

            const addPage = (page: { data: { number: number | string, title?: string }[] }) => {
                for (const ep of page.data) addEp(Number(ep.number), undefined, ep.title)
            }
            const firstPage = await fetchPage(1)
            addPage(firstPage)
            const pageCount = Number(firstPage.last_page) ||
                Math.ceil(Number(firstPage.total) / Number(firstPage.per_page)) || 1
            // Bound concurrent requests for large catalogs such as One Piece.
            for (let start = 2; start <= pageCount; start += 4) {
                const requests = []
                for (let page = start; page < start + 4 && page <= pageCount; page++) {
                    requests.push(fetchPage(page))
                }
                const pages = await Promise.all(requests)
                for (const page of pages) addPage(page)
            }
            // Use only published episodes; metadata may include future episodes
            // and numbering gaps may be intentional.
            return episodes.sort((a, b) => a.number - b.number)
        }

        // --- Legacy AJAX pagination ---
        const seriesIdMatch = html.match(/ajax\/pagination_episodes\/(\d+)\//)
        if (seriesIdMatch) {
            const seriesId = seriesIdMatch[1]

            const totalMatch =
                html.match(/num_episodios\s*=\s*(\d+)/) ??
                html.match(/Episodios:<\/span>[^<]*?(\d+)/) ??
                html.match(/data-episodes="(\d+)"/) ??
                html.match(/num-episodios[^>]*>\s*(\d+)/) ??
                html.match(/(\d+)\s*ep[ií]sodios?/i)

            const total = totalMatch ? parseInt(totalMatch[1]) : 0
            const pageCount = total > 0 ? Math.ceil(total / 10) : 1

            const pageRequests = Array.from({ length: pageCount }, (_, i) =>
                fetch(`${this.baseUrl}/ajax/pagination_episodes/${seriesId}/${i + 1}/`, {
                    credentials: "include",
                    headers: { "X-Requested-With": "XMLHttpRequest", "Referer": url },
                }).then(r => r.ok ? r.json() : []).catch(() => [])
            )

            const pages = await Promise.all(pageRequests)
            for (const page of pages) {
                if (!Array.isArray(page)) continue
                for (const ep of page) {
                    const number = parseInt(ep.number ?? ep.num ?? "0")
                    addEp(number, `${id}/${number}`, ep.title)
                }
            }
        }

        // --- HTML href scraping (always runs, merges with AJAX results) ---
        const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const epPattern = new RegExp(`href="(?:${this.baseUrl})?\\/(${escapedId}\\/(\\d+))\\/?"`,"g")
        let match: RegExpExecArray | null
        while ((match = epPattern.exec(html)) !== null) {
            addEp(parseInt(match[2]), match[1])
        }

        // --- Total-based synthetic fill (only if nothing found yet) ---
        if (episodes.length === 0) {
            const totalMatch =
                html.match(/Episodios:<\/span>[^<]*?(\d+)/) ??
                html.match(/data-episodes="(\d+)"/) ??
                html.match(/num-episodios[^>]*>\s*(\d+)/) ??
                html.match(/(\d+)\s*ep[ií]sodios?/i)
            const total = totalMatch ? parseInt(totalMatch[1]) : 0
            for (let i = 1; i <= total; i++) addEp(i)
        }

        // Gap fill: if we found ep N but not ep 1..N-1, add them synthetically.
        const maxEp = episodes.reduce((m, e) => Math.max(m, e.number), 0)
        for (let i = 1; i < maxEp; i++) addEp(i)

        return episodes.sort((a, b) => a.number - b.number)
    }

    /**
     * Maps a player embed URL to its canonical server name.
     * Unknown URLs fall back to "JK" (the site's native player).
     */
    private _serverName(url: string): string {
        if (url.includes("jkplayer") || url.includes("jkanime.net/jk")) return "JK"
        if (url.includes("desu.gg"))      return "Desu"
        if (url.includes("ok.ru"))        return "Okru"
        if (url.includes("yourupload"))   return "YourUpload"
        if (url.includes("streamwish"))   return "StreamWish"
        if (url.includes("doodstream") || url.includes("d0000d")) return "DoodStream"
        if (url.includes("filemoon"))     return "FileMoon"
        if (url.includes("voe.sx"))       return "Voe"
        return "JK"
    }

    /**
     * Extracts all player iframe/embed URLs from an episode page's HTML,
     * keyed by server name. Only the first URL per server is kept.
     *
     * Two passes are attempted:
     *  1. JS object literals — `"url":"https://..."` or `"src":"https://..."` —
     *     which is how JKAnime typically inlines player config.
     *  2. Plain `<iframe src="...">` tags as a fallback for older page layouts.
     */
    private _extractPlayerUrls(html: string): Record<string, string> {
        const map: Record<string, string> = {}

        const jsPattern = /["'](?:url|src)["']\s*:\s*["'](https?:\/\/[^"'\s]+)["']/g
        for (const [, url] of html.matchAll(jsPattern)) {
            const name = this._serverName(url)
            if (!(name in map)) map[name] = url
        }

        if (Object.keys(map).length === 0) {
            for (const [, url] of html.matchAll(/<iframe[^>]+src="(https?:\/\/[^"]+)"/g)) {
                const name = this._serverName(url)
                if (!(name in map)) map[name] = url
            }
        }

        return map
    }

    /**
     * Fetches a player embed page and extracts the direct stream URL.
     * Checks for Zilla Networks HLS streams first, then generic .m3u8, then .mp4.
     * Returns null if no recognisable stream URL is found.
     */
    private async _resolveStream(playerUrl: string): Promise<VideoSource | null> {
        const res = await fetch(playerUrl, {
            credentials: "include",
            headers: { "Referer": this.baseUrl + "/" },
        })

        if (!res.ok) return null

        const html = await res.text()

        // Zilla Networks CDN — used by JKAnime's own player.
        const zillaMatch = html.match(/["'`](https?:\/\/player\.zilla-networks\.com\/[^"'`\s]+)[`'"]/)
        if (zillaMatch) return { url: zillaMatch[1], type: "m3u8", quality: "default", subtitles: [] }

        const m3u8Match = html.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)[`'"]/)
        if (m3u8Match) return { url: m3u8Match[1], type: "m3u8", quality: "default", subtitles: [] }

        const mp4Match = html.match(/["'`](https?:\/\/[^"'`\s]+\.mp4[^"'`\s]*)[`'"]/)
        if (mp4Match) return { url: mp4Match[1], type: "mp4", quality: "default", subtitles: [] }

        return null
    }

    /**
     * Resolves the video source for a specific episode + server combination.
     * Falls back to the JK server, then to whatever is available, if the
     * requested server is not found on the page.
     */
    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const res = await fetch(episode.url, { credentials: "include" })
        if (!res.ok) return { server, headers: {}, videoSources: [] }

        const html = await res.text()
        const playerMap = this._extractPlayerUrls(html)

        if (Object.keys(playerMap).length === 0) {
            return { server, headers: {}, videoSources: [] }
        }

        // Prefer the requested server; fall back to JK, then to the first available.
        const playerUrl = playerMap[server] ?? playerMap["JK"] ?? Object.values(playerMap)[0]
        const source = await this._resolveStream(playerUrl)

        return {
            server,
            headers: {
                "Referer": "https://jkanime.net/",
                "Origin": "https://jkanime.net",
            },
            videoSources: source ? [source] : [],
        }
    }
}
