/// <reference path="./types/anime-torrent-provider.d.ts" />
/// <reference path="./types/core.d.ts" />

class Provider {
  private api = "https://share.acgnx.se/rss.xml";

  // Defines the settings for this provider.
  async getSettings(): Promise<AnimeProviderSettings> {
    return {
      canSmartSearch: false, // ACGNX RSS does not support detailed filtering
      smartSearchFilters: [],
      supportsAdult: true, // The site may contain adult content
      type: "main",
    };
  }

  // Searches for torrents based on a user's query.
  async search(opts: AnimeSearchOptions): Promise<AnimeTorrent[]> {
    const url = `${this.api}?keyword=${encodeURIComponent(opts.query)}`;
    return this.fetchAndParseRss(url);
  }

  // This provider does not support smart searching.
  async smartSearch(opts: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
    console.log("ACGNX provider does not support smart search.");
    return [];
  }

  // Fetches the latest torrents from the main RSS feed.
  async getLatest(): Promise<AnimeTorrent[]> {
    return this.fetchAndParseRss(this.api);
  }

  // The info hash is already provided in the search results.
  async getTorrentInfoHash(torrent: AnimeTorrent): Promise<string> {
    return torrent.infoHash || "";
  }

  // The magnet link is already provided in the search results.
  async getTorrentMagnetLink(torrent: AnimeTorrent): Promise<string> {
    return torrent.magnetLink || "";
  }

  // Main function to fetch the RSS feed and parse it.
  private async fetchAndParseRss(url: string): Promise<AnimeTorrent[]> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch RSS feed, status: ${response.status}`);
      }
      const xmlText = response.text();
      const torrents = this.parseTorrentsFromXml(xmlText);
      return torrents;
    } catch (error) {
      console.error(`Error fetching or parsing RSS feed from ${url}: ${error}`);
      return [];
    }
  }

  // Parses the raw XML string to extract torrent items.
  private parseTorrentsFromXml(xml: string): AnimeTorrent[] {
    const items = xml.split("<item>");

    return items
      .map((itemXml) => {
        try {
          // Get the raw title and clean it of any stray HTML tags.
          let title = this.getTagContent(itemXml, "title");
          title = title.replace(/<[^>]*>/g, "").trim();

          const link = this.getTagContent(itemXml, "link");
          const pubDate = this.getTagContent(itemXml, "pubDate");
          const description = this.getTagContent(itemXml, "description");

          const magnetMatch = /<enclosure url="(magnet:[^"]+)"/.exec(itemXml);
          const magnetLink = magnetMatch ? magnetMatch[1] : "";

          // --- FIX: Robustly parse data from the description tag ---
          const cleanedDescription = description.replace(/<[^>]*>/g, "").trim();
          const descriptionParts = cleanedDescription.split("|");

          // Find the file size using a regex pattern, not a fixed index.
          let formattedSize = "0 MB";
          for (const part of descriptionParts) {
            if (/\d+(\.\d+)?\s*(KB|MB|GB|TB)/i.test(part.trim())) {
              formattedSize = part.trim();
              break;
            }
          }

          // Get the info hash from the magnet link or find it in the description.
          let infoHash = this.getHashFromMagnet(magnetLink) || "";
          if (!infoHash) {
            for (const part of descriptionParts) {
              const trimmedPart = part.trim();
              if (
                trimmedPart.length === 40 &&
                /^[a-f0-9]+$/i.test(trimmedPart)
              ) {
                infoHash = trimmedPart;
                break;
              }
            }
          }
          // --- END FIX ---

          return {
            name: title,
            date: new Date(pubDate).toISOString(),
            size: this.parseSizeToBytes(formattedSize),
            formattedSize: formattedSize,
            seeders: -1,
            leechers: -1,
            downloadCount: 0,
            link: link,
            magnetLink: magnetLink,
            infoHash: infoHash.toLowerCase(),
            episodeNumber: -1, // seaanime will auto parse
            isBestRelease: false,
            confirmed: false,
          } as AnimeTorrent;
        } catch (e) {
          console.error("Failed to parse an item from ACGNX RSS:", e);
          return null;
        }
      })
      .filter((t) => t !== null);
  }

  // Helper to extract content from a CDATA-wrapped tag.
  private getTagContent(xml: string, tagName: string): string {
    const match = new RegExp(
      `<${tagName}><!\\[CDATA\\[(.*?)]]></${tagName}>`,
      "s"
    ).exec(xml);
    if (match && match[1]) return match[1];

    const fallbackMatch = new RegExp(`<${tagName}>(.*?)</${tagName}>`).exec(
      xml
    );
    return fallbackMatch ? fallbackMatch[1] : "";
  }

  // Helper to extract the info hash from a magnet link.
  private getHashFromMagnet(magnet: string): string | null {
    const match = /urn:btih:([a-fA-F0-9]{40})/.exec(magnet);
    return match ? match[1] : null;
  }

  // Helper to convert size strings (e.g., "1.5GB") into bytes.
  private parseSizeToBytes(sizeStr: string): number {
    if (!sizeStr) return 0;
    const sizeLower = sizeStr.toLowerCase();
    let value = parseFloat(sizeStr.replace(/[^0-9.]/g, ""));

    if (isNaN(value)) {
      return 0;
    }

    let bytes = 0;
    if (sizeLower.includes("gb")) {
      bytes = value * 1024 * 1024 * 1024;
    } else if (sizeLower.includes("mb")) {
      bytes = value * 1024 * 1024;
    } else if (sizeLower.includes("kb")) {
      bytes = value * 1024;
    } else {
      bytes = value;
    }

    return Math.round(bytes);
  }
}
