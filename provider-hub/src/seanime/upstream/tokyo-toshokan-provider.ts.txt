/// <reference path="./anime-torrent-provider.d.ts" />
/// <reference path="./core.d.ts" />

class Provider {

    private api = "https://www.tokyotosho.info"

    // Returns the provider settings.
    getSettings(): AnimeProviderSettings {
        return {
            canSmartSearch: true,
            smartSearchFilters: ["batch", "episodeNumber", "resolution"],
            supportsAdult: true, // The site has categories for Hentai.
            type: "main",
        }
    }

    // Searches for torrents based on the user's query.
    async search(opts: AnimeSearchOptions): Promise<AnimeTorrent[]> {
        const searchUrl = `${this.api}/search.php?terms=${encodeURIComponent(opts.query)}&cat=1`;

        const response = await fetch(searchUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch search results from Tokyo Toshokan, status: ${response.status}`);
        }
        const html = await response.text();
        
        return this.parseResults(html);
    }

    // Get the latest torrents from the homepage.
    async getLatest(): Promise<AnimeTorrent[]> {
        const response = await fetch(this.api);
        if (!response.ok) {
            return [];
        }
        const html = await response.text();
        return this.parseResults(html);
    }
    
    // This provider does not use a separate details page for the magnet link.
    async getTorrentMagnetLink(torrent: AnimeTorrent): Promise<string> {
        return torrent.magnetLink || "";
    }
    
    // Searches for torrents with specific filters and then refines the results.
    async smartSearch(opts: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
        const query = opts.query || opts.media.romajiTitle || opts.media.englishTitle || "";
        const category = opts.batch ? 11 : 1;
        
        const searchUrl = `${this.api}/search.php?terms=${encodeURIComponent(query)}&cat=${category}`;

        const response = await fetch(searchUrl);
        if (!response.ok) {
            console.log(`Smart search failed, status: ${response.status}`);
            return [];
        }
        const html = await response.text();
        const allTorrents = this.parseResults(html);

        if (opts.batch) {
            return allTorrents.filter(t => t.isBatch);
        }

        let filteredTorrents = allTorrents.filter(t => {
            if (t.isBatch || t.episodeNumber === -1) {
                return false;
            }
            const absoluteEpisode = opts.media.absoluteSeasonOffset + opts.episodeNumber;
            return t.episodeNumber === opts.episodeNumber || t.episodeNumber === absoluteEpisode;
        });

        if (opts.resolution) {
            const cleanOptRes = opts.resolution.replace(/p$/, "");
            filteredTorrents = filteredTorrents.filter(t => {
                const torrentRes = (t.resolution || "").replace(/p$/, "");
                return torrentRes === cleanOptRes;
            });
        }
        
        return filteredTorrents;
    }

    /**
     * Main parsing function for both search and latest results.
     */
    private parseResults(html: string): AnimeTorrent[] {
        const $ = LoadDoc(html);
        const torrents: AnimeTorrent[] = [];

        $("table.listing td.desc-top").each((i, el) => {
            const currentRow = el.parent();
            const nextRow = currentRow.next();

            const nameElement = el.find("a").last();
            const magnetElement = el.find("a[href^='magnet:']");
            
            if (nameElement.length === 0 || magnetElement.length === 0) {
                return;
            }

            const originalName = nameElement.text().trim();
            const isBatch = this.parseIsBatch(originalName);
            // Format the name to include tags for the UI.
            const name = this.formatName(originalName);
            
            const detailsLink = currentRow.find("td.web a[href*='details.php']").attr("href");
            const link = detailsLink ? `${this.api}/${detailsLink}` : "";
            const magnetLink = magnetElement.attr("href") || "";

            const descBotText = nextRow.find("td.desc-bot").text();
            const statsText = nextRow.find("td.stats").text();
            
            const stats = this.parseStats(statsText);
            const sizeStr = (descBotText.match(/Size:\s*([\d.]+\s*\w+)/) || [])[1] || "0";
            const dateStr = (descBotText.match(/Date:\s*([\s\S]+UTC)/) || [])[1] || "";
            
            torrents.push({
                name: name,
                date: this.parseDate(dateStr),
                size: this.parseSize(sizeStr),
                formattedSize: sizeStr,
                seeders: stats.seeders,
                leechers: stats.leechers,
                downloadCount: stats.completed,
                link: link,
                downloadUrl: "",
                magnetLink: magnetLink,
                infoHash: (magnetLink.match(/btih:([a-zA-Z0-9]+)/) || [])[1] || "",
                resolution: this.parseResolution(originalName),
                releaseGroup: "",
                isBatch: isBatch,
                episodeNumber: isBatch ? -1 : this.parseEpisodeNumber(originalName),
                isBestRelease: false,
                confirmed: false,
            });
        });

        return torrents;
    }

    /**
     * Appends standardized tags to the torrent name for better UI detection.
     */
    private formatName(name: string): string {
        let modifiedName = name;
        const lowerName = name.toLowerCase();

        // Add [Dual Audio] tag if [ENG] is present (and it's not a raw).
        if (lowerName.includes("[eng]") && !lowerName.includes("raw") && !lowerName.includes("dual audio")) {
            modifiedName += " [Dual Audio]";
        }

        // Add [Multi Subs] tag if "Multiple Subtitle" is present.
        if (lowerName.includes("multiple subtitle") && !lowerName.includes("multi subs")) {
            modifiedName += " [Multi Subs]";
        }
        
        // Add [Multiple Languages] tag if several language codes are found.
        const langCodeRegex = /\[([A-Z]{2,3}(?:-[A-Z]{2})?)\]/gi;
        const matches = name.match(langCodeRegex);
        if (matches && matches.length > 2 && !lowerName.includes("multiple languages")) {
            modifiedName += " [Multiple Languages]";
        }

        return modifiedName;
    }

    private parseEpisodeNumber(name: string): number {
        const match = name.match(/(?:\s-\s|\[|\()(\d{1,4})(?:v\d)?(?:\s|\]|\)|END)/i);
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }
        return -1;
    }

    private parseIsBatch(name: string): boolean {
        const batchRegex = /\b(batch|complete|pack|collection|\d{1,3}\s*([~-])\s*\d{1,3})\b/i;
        return batchRegex.test(name);
    }
    
    private parseResolution(title: string): string {
        const match = title.match(/\b(\d{3,4}p)\b/i);
        return match ? match[1] : "";
    }

    private parseSize(sizeStr: string): number {
        const sizeMatch = sizeStr.match(/([\d\.]+)\s*(GB|MB|KB)/i);
        if (!sizeMatch) return 0;
        const size = parseFloat(sizeMatch[1]);
        const unit = sizeMatch[2].toUpperCase();
        if (unit === "GB") { return Math.round(size * 1024 * 1024 * 1024); }
        if (unit === "MB") { return Math.round(size * 1024 * 1024); }
        if (unit === "KB") { return Math.round(size * 1024); }
        return 0;
    }
    
    private parseDate(dateStr: string): string {
        if (!dateStr) return "";
        return new Date(dateStr.trim()).toISOString();
    }
    
    private parseStats(statsStr: string): { seeders: number, leechers: number, completed: number } {
        const seeders = parseInt((statsStr.match(/S:\s*(\d+)/) || [])[1] || "0");
        const leechers = parseInt((statsStr.match(/L:\s*(\d+)/) || [])[1] || "0");
        const completed = parseInt((statsStr.match(/C:\s*(\d+)/) || [])[1] || "0");
        return { seeders, leechers, completed };
    }
}
