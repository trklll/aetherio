/// <reference path="./anime-torrent-provider.d.ts" />
/// <reference path="./core.d.ts" />

class Provider {

    private api = "https://www.tokyotosho.info"

    // Returns the provider settings.
    getSettings(): AnimeProviderSettings {
        return {
            canSmartSearch: false, // The site does not support searching by AniDB ID.
            smartSearchFilters: [],
            supportsAdult: true, // The site has categories for Hentai.
            type: "main",
        }
    }

    // Searches for torrents based on the user's query.
    async search(opts: AnimeSearchOptions): Promise<AnimeTorrent[]> {
        // *** THIS IS THE MODIFIED PART - Using type=7 for Raws only ***
        const searchUrl = `${this.api}/search.php?terms=${encodeURIComponent(opts.query)}&type=7`;

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
    
    // This provider does not support smart search.
    async smartSearch(opts: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
        return [];
    }

    /**
     * Main parsing function for both search and latest results.
     */
    private parseResults(html: string): AnimeTorrent[] {
        const $ = LoadDoc(html);
        const torrents: AnimeTorrent[] = [];

        // Find all the title cells, which are the primary anchor for each torrent.
        $("table.listing td.desc-top").each((i, el) => {
            const currentRow = el.parent();
            const nextRow = currentRow.next();

            // Select the last 'a' tag within the cell, which is the title.
            const nameElement = el.find("a").last();
            const magnetElement = el.find("a[href^='magnet:']");
            
            if (nameElement.length === 0 || magnetElement.length === 0) {
                return;
            }

            const name = nameElement.text().trim();
            const link = this.api + "/" + currentRow.find("td.web a[href*='details.php']").attr("href");
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
                resolution: this.parseResolution(name),
                releaseGroup: "",
                isBatch: false,
                episodeNumber: -1,
                isBestRelease: false,
                confirmed: false,
            });
        });

        return torrents;
    }

    /**
     * Helper function to parse resolution from a title.
     */
    private parseResolution(title: string): string {
        const match = title.match(/\b(\d{3,4}p)\b/i);
        return match ? match[1] : "";
    }

    /**
     * Helper function to parse a size string (e.g., "75.63MB") into bytes.
     */
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

    /**
     * Helper function to convert a date string to an ISO 8601 string.
     */
    private parseDate(dateStr: string): string {
        if (!dateStr) return "";
        // The date format is "YYYY-MM-DD HH:mm UTC"
        return new Date(dateStr.trim()).toISOString();
    }
    
    /**
     * Helper function to parse seeder, leecher, and completed counts from stats text.
     */
    private parseStats(statsStr: string): { seeders: number, leechers: number, completed: number } {
        const seeders = parseInt((statsStr.match(/S:\s*(\d+)/) || [])[1] || "0");
        const leechers = parseInt((statsStr.match(/L:\s*(\d+)/) || [])[1] || "0");
        const completed = parseInt((statsStr.match(/C:\s*(\d+)/) || [])[1] || "0");
        return { seeders, leechers, completed };
    }
}
