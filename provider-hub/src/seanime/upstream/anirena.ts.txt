interface SmartQuery {
    query: string
    sortBy: string
}

type Torrent = AnimeTorrent & { metadata: $habari.Metadata }

class Provider {
    canSmartSearch = true
    supportsAdult = true

    async getLatest(): Promise<AnimeTorrent[]> {
        try {
            const url = this.buildSearchURL("")
            console.log("anirena: Fetching latest from " + url)
            const html = await this.fetchHTML(url)
            const torrents = this.parseHTML(html)
            console.log("anirena: Found " + torrents.length + " latest torrents")
            return torrents.map(t => this.strip(t))
        } catch (e) {
            console.error("anirena: getLatest error: " + String(e))
            return []
        }
    }

    async search(options: AnimeSearchOptions): Promise<AnimeTorrent[]> {
        try {
            const query = (options.query || "").replace(/[()|"'\[\]]/g, " ").replace(/\s+/g, " ").trim()
            if (!query) return []

            const url = this.buildSearchURL(query)
            console.log("anirena: Searching: " + query)
            const html = await this.fetchHTML(url)
            const torrents = this.parseHTML(html)
            console.log("anirena: Found " + torrents.length + " torrents")
            return torrents.map(t => this.strip(t))
        } catch (e) {
            console.error("anirena: search error: " + String(e))
            return []
        }
    }

    async smartSearch(options: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
        try {
            const queries = this.buildSmartSearchQueries(options)
            if (!queries || queries.length === 0) return []

            console.log("anirena: Smart search — " + queries.length + " queries")

            const allTorrents: Torrent[] = []

            for (let i = 0; i < queries.length; i += 3) {
                const batch = queries.slice(i, i + 3)
                const results = await Promise.all(batch.map(async q => {
                    try {
                        const url = this.buildSearchURL(q.query)
                        console.log("anirena: Query -> " + q.query)
                        const html = await this.fetchHTML(url)
                        return this.parseHTML(html)
                    } catch (err) {
                        console.error("anirena: Batch query failed: " + String(err))
                        return [] as Torrent[]
                    }
                }))
                allTorrents.push(...results.flat())
            }

            const seen = new Map<string, Torrent>()
            for (const t of allTorrents) {
                const key = t.infoHash || t.link || t.downloadUrl
                if (key && !seen.has(key)) seen.set(key, t)
            }

            const unique = [...seen.values()]
            console.log("anirena: " + unique.length + " unique torrents before filtering")

            const filtered = this.filterSmartResults(unique, options)
                .map(t => this.strip(t))

            console.log("anirena: " + filtered.length + " torrents after filtering")
            return filtered
        } catch (e) {
            console.error("anirena: smartSearch error: " + String(e))
            return []
        }
    }

    async getTorrentInfoHash(torrent: AnimeTorrent): Promise<string> {
        return torrent.infoHash || ""
    }

    async getTorrentMagnetLink(torrent: AnimeTorrent): Promise<string> {
        if (torrent.magnetLink && torrent.magnetLink.startsWith("magnet:")) {
            return torrent.magnetLink
        }

        if (torrent.magnetLink && torrent.magnetLink.endsWith("/magnet")) {
            try {
                const res = await fetch(torrent.magnetLink, { redirect: "manual" })
                if (res.status >= 300 && res.status < 400) {
                    const loc = res.headers.get("Location")
                    if (loc && loc.startsWith("magnet:")) return loc
                }
                const text = (await res.text()).trim()
                if (text.startsWith("magnet:")) return text
            } catch (e) {
                const errStr = String(e)
                const match = errStr.match(/(magnet:\?xt=[^\s"']+)/)
                if (match) return match[1]
            }
        }

        if (torrent.link) {
            try {
                console.log("anirena: Fetching details page for InfoHash fallback...")
                const res = await fetch(torrent.link)
                if (res.ok) {
                    const html = await res.text()
                    
                    const hashMatch = html.match(/\b([a-fA-F0-9]{40})\b/)
                    if (hashMatch) {
                        const hash = hashMatch[1]
                        console.log("anirena: InfoHash successfully scraped: " + hash)
                        
                        const trackers = [
                            "udp://tracker.opentrackr.org:1337/announce",
                            "udp://open.demonii.com:1337/announce",
                            "udp://tracker.openbittorrent.com:80",
                            "udp://exodus.desync.com:6969/announce"
                        ]
                        
                        let constructed = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(torrent.name)}`
                        for (const tr of trackers) {
                            constructed += `&tr=${encodeURIComponent(tr)}`
                        }
                        return constructed
                    }
                }
            } catch (e) {
                console.error("anirena: Detail page scrape error: " + String(e))
            }
        }

        return torrent.downloadUrl || ""
    }

    getSettings(): AnimeProviderSettings {
        return {
            canSmartSearch: this.canSmartSearch,
            smartSearchFilters: ["batch", "episodeNumber", "resolution", "query"],
            supportsAdult: true,
            type: "main",
        }
    }

    private parseHTML(html: string): Torrent[] {
        const $ = LoadDoc(html)
        const torrents: Torrent[] = []

        $("tr[data-torrent-id]").each((_: number, row: any) => {
            try {
                const titleEl = row.find(".tl-torrent-name").first()
                const title = titleEl.text().trim()
                if (!title) return

                const linkHref = titleEl.attr("href") || ""
                const magnetHref = row.find("a[href$='/magnet']").first().attr("href") || ""
                const downloadHref = row.find("a[href$='.torrent']").first().attr("href") || ""

                let sizeText = row.find(".col-size").first().text().trim()
                if (!sizeText) sizeText = row.find(".tl-meta-size").first().text().trim()

                const seedersText = row.find(".col-se .tl-se").first().text().trim()
                const leechersText = row.find(".col-le .tl-le").first().text().trim()
                const dlText = row.find(".col-dl").first().text().trim()

                const seeders = parseInt(seedersText.replace(/\D/g, '')) || 0
                const leechers = parseInt(leechersText.replace(/\D/g, '')) || 0
                const downloads = parseInt(dlText.replace(/\D/g, '')) || 0

                let dateStr = ""
                const utcText = row.find("[data-utc]").first().attr("data-utc") || ""
                if (utcText) {
                    try {
                        const d = new Date(utcText.replace(" ", "T") + "Z")
                        if (!isNaN(d.getTime())) dateStr = d.toISOString()
                    } catch {}
                }

                const { baseUrl } = this.getSettings_()
                const link = linkHref ? (linkHref.startsWith("http") ? linkHref : baseUrl + linkHref) : ""
                const magnetLink = magnetHref ? (magnetHref.startsWith("http") ? magnetHref : baseUrl + magnetHref) : ""
                const downloadUrl = downloadHref ? (downloadHref.startsWith("http") ? downloadHref : baseUrl + downloadHref) : ""

                const metadata = $habari.parse(title)
                
                let episode = -1
                if (metadata.episode_number && metadata.episode_number.length >= 1) {
                    episode = parseInt(metadata.episode_number[0]) || -1
                }
                const isBatch = this.isTorrentLikelyBatch(title)
                if (isBatch) episode = -1
                
                const sizeBytes = this.parseSize(sizeText)

                torrents.push({
                    name: title,
                    date: dateStr,
                    size: sizeBytes,
                    formattedSize: sizeText || "0 B",
                    seeders,
                    leechers,
                    downloadCount: downloads,
                    link,
                    downloadUrl,
                    magnetLink,
                    infoHash: "",
                    resolution: metadata.video_resolution || "",
                    isBatch,
                    episodeNumber: episode,
                    releaseGroup: metadata.release_group || "",
                    isBestRelease: false,
                    confirmed: false,
                    metadata,
                })
            } catch (e) {
                console.error("anirena: Row parse error: " + String(e))
            }
        })

        return torrents
    }

    private async fetchHTML(url: string): Promise<string> {
        const res = await fetch(url)
        if (!res.ok) throw new Error("HTTP " + res.status + " for " + url)
        return res.text()
    }

    private buildSearchURL(query: string): string {
        const { baseUrl } = this.getSettings_()
        if (!query.trim()) return `${baseUrl}/`
        return `${baseUrl}/?q=${encodeURIComponent(query.trim())}`
    }

    private getSettings_(): { baseUrl: string } {
        let url: string = $getUserPreference("apiUrl") || "https://www.anirena.com"
        if (!url.startsWith("http")) url = "https://" + url
        return { baseUrl: url.replace(/\/$/, "") }
    }

    private buildSmartSearchQueries(opts: AnimeSmartSearchOptions): SmartQuery[] {
        const { media, query: userQuery, batch, episodeNumber, resolution } = opts

        if (userQuery) {
            const q = userQuery.replace(/[()|"'\[\]]/g, " ").replace(/\s+/g, " ").trim()
            return [{ query: resolution ? `${q} ${resolution}` : q, sortBy: "seeders" }]
        }

        const allTitles = [
            media.romajiTitle || "",
            media.englishTitle || "",
            ...(media.synonyms || []),
        ].filter(Boolean)

        if (allTitles.length === 0) return []

        const processed = $scannerUtils.buildSmartSearchTitles(allTitles)
        const titles: string[] = processed.titles || []
        const season = processed.season > 0 ? processed.season : 0

        if (titles.length === 0) return []

        const cleanTitles = titles
            .map(t => t.replace(/[()|"'\[\]]/g, " ").replace(/\s+/g, " ").trim())
            .filter(Boolean)

        const sorted = [...cleanTitles].sort((a, b) => a.length - b.length)

        const isMovie = media.format === "MOVIE" && (media.episodeCount || 0) === 1
        const canBatch = media.status === "FINISHED" && (media.episodeCount || 0) > 0

        let queries: SmartQuery[]
        if (batch && canBatch && !isMovie) {
            queries = this.buildBatchQueries(sorted, season, resolution)
        } else if (isMovie) {
            queries = this.buildMovieQueries(sorted, resolution)
        } else {
            queries = this.buildEpisodeQueries(sorted, season, episodeNumber, resolution)
        }

        const seen = new Set<string>()
        const unique: SmartQuery[] = []
        for (const q of queries) {
            if (!seen.has(q.query)) {
                seen.add(q.query)
                unique.push(q)
            }
            if (unique.length >= 15) break
        }
        return unique
    }

    private buildEpisodeQueries(sorted: string[], season: number, ep: number, resolution: string): SmartQuery[] {
        const res = resolution ? ` ${resolution}` : ""
        const epStr = this.zeropad(ep)
        const primary = sorted[0]
        const secondary = sorted.length > 1 ? sorted[1] : ""
        const queries: SmartQuery[] = []

        queries.push({ query: `${primary} ${epStr}${res}`.trim(), sortBy: "seeders" })
        queries.push({ query: `${primary} - ${epStr}${res}`.trim(), sortBy: "seeders" })
        queries.push({ query: `${primary} E${epStr}${res}`.trim(), sortBy: "seeders" })
        if (season > 1) {
            queries.push({ query: `${primary} S${this.zeropad(season)}E${epStr}${res}`.trim(), sortBy: "seeders" })
        }
        if (secondary) {
            queries.push({ query: `${secondary} ${epStr}${res}`.trim(), sortBy: "seeders" })
        }
        return queries
    }

    private buildBatchQueries(sorted: string[], season: number, resolution: string): SmartQuery[] {
        const res = resolution ? ` ${resolution}` : ""
        const primary = sorted[0]
        const secondary = sorted.length > 1 ? sorted[1] : ""
        const queries: SmartQuery[] = []

        queries.push({ query: `${primary} Batch${res}`, sortBy: "size" })
        queries.push({ query: `${primary} Complete${res}`, sortBy: "size" })
        if (season > 1) {
            queries.push({ query: `${primary} S${this.zeropad(season)} Batch${res}`, sortBy: "size" })
        }
        if (secondary) {
            queries.push({ query: `${secondary} Batch${res}`, sortBy: "size" })
        }
        queries.push({ query: `${primary}${res}`, sortBy: "size" })
        return queries
    }

    private buildMovieQueries(sorted: string[], resolution: string): SmartQuery[] {
        const res = resolution ? ` ${resolution}` : ""
        const queries: SmartQuery[] = []
        queries.push({ query: `${sorted[0]}${res}`, sortBy: "seeders" })
        if (sorted.length > 1) queries.push({ query: `${sorted[1]}${res}`, sortBy: "seeders" })
        return queries
    }

    private filterSmartResults(torrents: Torrent[], opts: AnimeSmartSearchOptions): Torrent[] {
        const { media, batch, episodeNumber } = opts
        const isMovie = media.format === "MOVIE" && (media.episodeCount || 0) === 1
        const hasAbsoluteOffset = (media.absoluteSeasonOffset || 0) > 0
        const absEp = hasAbsoluteOffset ? episodeNumber + (media.absoluteSeasonOffset || 0) : -1
        const minDate = this.getMediaMinDate(media)

        if (batch) return this.filterBatch(torrents, media, minDate)

        if (isMovie) {
            return torrents.filter(t =>
                this.matchesMedia(t.name, media, 0.6, t.metadata) &&
                this.afterDate(t, minDate)
            )
        }

        return torrents.filter(t => {
            const ep = t.episodeNumber ?? -1
            if (ep < 0) return false
            if (ep !== episodeNumber && (absEp < 0 || ep !== absEp)) return false
            if (!this.matchesMedia(t.name, media, 0.75, t.metadata)) return false
            if (!this.afterDate(t, minDate)) return false
            return true
        })
    }

    private filterBatch(torrents: Torrent[], media: Media, minDate: number): Torrent[] {
        return torrents.filter(t => {
            const ep = t.episodeNumber ?? -1
            const isBatch = t.isBatch || (ep === -1 && this.matchesMedia(t.name, media, 0.6, t.metadata))
            if (!isBatch || ep > 0) return false
            if (!this.matchesMedia(t.name, media, 0.6, t.metadata)) return false
            if (!this.afterDate(t, minDate)) return false
            return true
        })
    }

    private matchesMedia(name: string, media: Media, threshold: number, metadata: $habari.Metadata): boolean {
        const parsed = (metadata.title || metadata.formatted_title || name).toLowerCase().replace(/[^a-z0-9]+/g, " ")
        const titles = [media.romajiTitle || "", media.englishTitle || "", ...(media.synonyms || [])].filter(Boolean)
        for (const t of titles) {
            const norm = t.toLowerCase().replace(/[^a-z0-9]+/g, " ")
            if ($scannerUtils.compareTitles(parsed, norm) >= threshold) return true
            if (parsed.includes(norm) || norm.includes(parsed)) return true
        }
        return false
    }

    private afterDate(t: AnimeTorrent, minDate: number): boolean {
        if (minDate <= 0 || !t.date) return true
        try {
            const ts = new Date(t.date).getTime()
            return isNaN(ts) || ts >= minDate
        } catch { return true }
    }

    private getMediaMinDate(media: Media): number {
        if (!media.startDate?.year) return 0
        const d = new Date(media.startDate.year, (media.startDate.month || 1) - 1, media.startDate.day || 1)
        d.setMonth(d.getMonth() - 3)
        return d.getTime()
    }

    private isTorrentLikelyBatch(name: string): boolean {
        if (/\bbatch\b/i.test(name)) return true
        if (/\b(complete series?|全集|dual audio batch)\b/i.test(name)) return true
        const rng = name.match(/(?:^|[\s\[\(])0*(\d{1,3})\s*[-~]\s*0*(\d{1,3})(?:[\s\]\)]|$)/)
        if (rng) {
            const [s, e] = [parseInt(rng[1]), parseInt(rng[2])]
            if (e > s && s >= 1 && e <= 300) return true
        }
        if (/\b\d{1,3}\s*-\s*\d{1,3}\b/.test(name)) return true
        if (/\be\d{1,3}\s*[-~]\s*e?\d{1,3}\b/i.test(name)) return true
        if (/\bvol\.?\s*\d+\s*[-~]\s*\d+/i.test(name)) return true
        return false
    }

    private parseSize(sizeStr: string): number {
        const m = sizeStr.match(/([\d.]+)\s*([KMGT]?i?B)/i)
        if (!m) return 0
        const n = parseFloat(m[1])
        const u = m[2].toUpperCase()
        if (u.endsWith("IB")) {
            if (u.startsWith("G")) return Math.round(n * Math.pow(1024, 3))
            if (u.startsWith("M")) return Math.round(n * Math.pow(1024, 2))
            if (u.startsWith("T")) return Math.round(n * Math.pow(1024, 4))
            return Math.round(n * 1024)
        }
        if (u.startsWith("G")) return Math.round(n * Math.pow(1000, 3))
        if (u.startsWith("M")) return Math.round(n * Math.pow(1000, 2))
        if (u.startsWith("T")) return Math.round(n * Math.pow(1000, 4))
        if (u.startsWith("K")) return Math.round(n * 1000)
        return Math.round(n)
    }

    private zeropad(v: number): string {
        return String(v).padStart(2, "0")
    }

    private strip(t: Torrent): AnimeTorrent {
        const { metadata, ...rest } = t
        return rest as AnimeTorrent
    }
}
