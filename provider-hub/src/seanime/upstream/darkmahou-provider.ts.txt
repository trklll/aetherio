/// <reference path="./anime-torrent-provider.d.ts" />
/// <reference path="./core.d.ts" />

type Resolution = string;
type CommonRes = any;
type Confidence = string;
type ParseMethod = string;
type MatchStrat = string;
type CacheKey = string;
type Timestamp = any;

type URLPattern = string;
type SearchURL = string;
type MagnetLink = string;

type InfoHash = string;
type EpIdx = any;
type NormString = string;
type FuzzyScore = any;

type StringDist = any;
type SimScore = any;

const PROVIDER_CONFIG = {
    API_BASE_URL: "https://darkmahou.io",
    USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    MAX_EP_IDX: 9999,
    MIN_EP_IDX: 1,
    MAX_YEAR: 2000,
    COMMON_RES: [480, 720, 1080],
    MAX_BATCH_EPS: 999
};

const REGEX_PATTERNS = {
    INFO_HASH: /btih:([a-fA-F0-9]{40})/i,
    MAGNET_LINK: /magnet:\?[^"'\s<>]+/gi,
    RESOLUTION: /\b(\d{3,4}p)\b/i,
    RELEASE_GROUP: /^\[([^\]]+)\]/,
    EP_RANGE: /\b(\d{2,3})\s*[-~]\s*(\d{2,3})\b/,
    SEASON_EP: /S(\d+)E(\d+)/i,
    EP_DASH: /\s-\s(\d{1,4})\s/,
    EP_IDX_RGX: /\b(\d{1,4})\b/g,
    EP_PATTERNS: {
        PORTUGUESE: /episódio\s+(\d+)/i,
        ENGLISH: /(?:ep|episode)\s*(\d+)/i
    },
    SEASON_ORDINAL: /\b(\d+)(?:st|nd|rd|th)\s+season\b/gi,
    SEASON_IDX_RGX: /\bseason\s+(\d+)\b/gi,
    PAGE_LINK_RGX: new RegExp('<a[^>]+href="(https:\\/\\/darkmahou\\.io\\/[^\\/]+\\/)"(?:[^>]*title="([^"]*)")?[^>]*>', 'gi')
};

const PT_BR_TRANS = {
    ORDINAL_IDXS: {
        "first": "1ª",
        "second": "2ª", 
        "third": "3ª",
        "fourth": "4ª",
        "fifth": "5ª"
    },
    TERMS: {
        "movie": "filme",
        "ova": "ova",
        "special": "especial"
    }
};

const EXCLUDED_URLS = [
    "/?s=", "/tag/", "/blog/", "/contato", "/az-lists", 
    "/em-breve", "/animes-populares", "/categoria", "/genero",
    "/lord-of-mysteries/", "/yofukashi-no-uta", "/zutaboro-reijou", 
    "/watari-kun", "/silent-witch", "/tougen-anki", "/arknights"
];

const PERF_CONFIG = {
    CACHE_TTL: 5 * 60 * 1000, 
    MAX_CACHE_SIZE: 100,
    EARLY_EXIT: 95,
    MAX_FUZZY_CANDS: 500,
    MIN_LABEL_LEN: 2
};

interface CacheEntry {
    data: any;
    timestamp: any;
    key: string;
}

interface PerformanceMetrics {
    searchTime: any;
    parseTime: any;
    cacheHits: any;
    cacheMisses: any;
    fuzzyCount: any;
}

const FUZZY_CONFIG = {
    maxDist: 5,
    minSim: 0.6,
    strats: ['exact', 'fuzzy', 'normalized', 'phonetic'],
    weights: {
        exact: 100,
        fuzzy: 80,
        normalized: 70,
        phonetic: 60
    }
};

const CHAR_NORMS: any = {
    'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
    'ç': 'c', 'ñ': 'n',
    'ō': 'o', 'ū': 'u', 'ā': 'a', 'ē': 'e', 'ī': 'i',
    '\u3000': ' ', 
    '\t': ' ',
    '\n': ' ',
    '\r': ' '
};

const ANIME_LABEL_VARS = {
    patterns: [
        { from: /mahou\s+tsukai/gi, to: 'mahoutsukai' },
        { from: /maho\s+tsukai/gi, to: 'mahotsukai' },
        { from: /seirei\s+tsukai/gi, to: 'seireitsukai' },
        { from: /ken\s+shi/gi, to: 'kenshi' },
        { from: /yuu\s+sha/gi, to: 'yuusha' },
        { from: /ou/g, to: 'o' },
        { from: /uu/g, to: 'u' },
        { from: /ei/g, to: 'e' },
        { from: /season\s*(\d+)/gi, to: 'S$1' },
        { from: /episod[ei]o?\s*(\d+)/gi, to: 'E$1' }
    ]
};

interface ScoreMatch {
    url: string;
    matchLabel: string;
    score: any;
    strat: string;
    normLabel?: string;
    dist?: any;
}

const isValidMag = (link: string): boolean =>
    link.startsWith('magnet:?') && link.length > 20;

const isValidHash = (hash: string): boolean =>
    /^[a-fA-F0-9]{40}$/.test(hash);

const isValidEpIdx = (idx: any): boolean =>
    idx >= PROVIDER_CONFIG.MIN_EP_IDX && 
    idx <= PROVIDER_CONFIG.MAX_EP_IDX;

class PortugueseTranslator {
    private static readonly RULES: any = {
        seasonOrdinal: (q: string) => 
            q.replace(REGEX_PATTERNS.SEASON_ORDINAL, (_, idx) => `${idx}ª temporada`),
        
        seasonIdx: (q: string) => 
            q.replace(REGEX_PATTERNS.SEASON_IDX_RGX, "$1ª temporada"),
        
        ordinalIdxs: (q: string) => {
            let res = q;
            const entries = Object.entries(PT_BR_TRANS.ORDINAL_IDXS);
            for (let i = 0; i < entries.length; i++) {
                const [eng, pt] = entries[i];
                const rgx = new RegExp(`\\b${eng}\\s+season\\b`, "gi");
                res = res.replace(rgx, `${pt} temporada`);
            }
            return res;
        },
        
        commonTerms: (q: string) => {
            let res = q;
            const entries = Object.entries(PT_BR_TRANS.TERMS);
            for (let i = 0; i < entries.length; i++) {
                const [eng, pt] = entries[i];
                const rgx = new RegExp(`\\b${eng}\\b`, "gi");
                res = res.replace(rgx, pt);
            }
            return res;
        },
        
        partIdxs: (q: string) => 
            q.replace(/\bpart\s+(\d+)\b/gi, "parte $1"),
        
        normalize: (q: string) => 
            q.replace(/\s+/g, " ").trim()
    };

    static convertQuery(q: string): string {
        const rules = Object.values(this.RULES);
        let res = q;
        for (let i = 0; i < rules.length; i++) {
            res = (rules[i] as any)(res);
        }
        return res;
    }

    parse(input: string): string {
        return PortugueseTranslator.convertQuery(input);
    }
}

class TorrentParser {
    static extractInfoHash(mag: string): string {
        if (!isValidMag(mag)) {
            return "";
        }
        
        const match = mag.match(REGEX_PATTERNS.INFO_HASH);
        const hash = match?.[1];
        return hash && isValidHash(hash) ? hash : "";
    }
    
    static parseRes(name: string): string {
        const match = name.match(REGEX_PATTERNS.RESOLUTION);
        const res = match?.[1];
        
        const validRes = ['480p', '720p', '1080p', '1440p', '4K'];
        return validRes.indexOf(res as any) !== -1 ? res as string : "";
    }
    
    static extractReleaseGroup(name: string): string {
        const match = name.match(REGEX_PATTERNS.RELEASE_GROUP);
        return match?.[1] ?? "";
    }
    
    static checkIsBatch(name: string, epLabel: string): boolean {
        const lName = name.toLowerCase();
        const lLabel = epLabel.toLowerCase();
        
        if (lName.indexOf("batch") !== -1 || 
            lName.indexOf("complete") !== -1 || 
            lLabel.indexOf("~") !== -1) {
            return true;
        }
        
        const rangeMatch = name.match(REGEX_PATTERNS.EP_RANGE);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            if (end > start && start >= PROVIDER_CONFIG.MIN_EP_IDX && end <= PROVIDER_CONFIG.MAX_BATCH_EPS) {
                return true;
            }
        }
        
        if (lName.match(/\bs\d+\b/) && !lName.match(/\bs\d+e\d+\b/)) {
            return true;
        }
        
        if (name.match(/\s-\s\d{1,3}(\s|$)/)) {
            return false;
        }
        
        return false;
    }
    
    static getEpIdx(name: string, epLabel: string): any {
        if (TorrentParser.checkIsBatch(name, epLabel)) {
            return -1;
        }
        
        const res1 = TorrentParser.tryPattern(epLabel, REGEX_PATTERNS.EP_PATTERNS.PORTUGUESE);
        if (res1 !== null) return res1;

        const res2 = TorrentParser.tryPattern(name, REGEX_PATTERNS.EP_DASH);
        if (res2 !== null) return res2;

        const res3 = TorrentParser.trySeasonEp(name);
        if (res3 !== null) return res3;

        const res4 = TorrentParser.tryPattern(name, REGEX_PATTERNS.EP_PATTERNS.ENGLISH);
        if (res4 !== null) return res4;

        const res5 = TorrentParser.tryIsolatedIdxs(name);
        if (res5 !== null) return res5;
        
        return -1;
    }
    
    private static tryPattern(text: string, pat: RegExp): any | null {
        const match = text.match(pat);
        if (match) {
            const idx = parseInt(match[1]);
            return isValidEpIdx(idx) ? idx : null;
        }
        return null;
    }
    
    private static trySeasonEp(name: string): any | null {
        const match = name.match(REGEX_PATTERNS.SEASON_EP);
        if (match) {
            const epIdx = parseInt(match[2]);
            return isValidEpIdx(epIdx) ? epIdx : null;
        }
        return null;
    }
    
    private static tryIsolatedIdxs(name: string): any | null {
        const matches = name.match(REGEX_PATTERNS.EP_IDX_RGX);
        if (matches) {
            for (let i = 0; i < matches.length; i++) {
                const s = matches[i];
                const idx = parseInt(s);
                if (TorrentParser.isValidForIsolation(idx)) {
                    return idx;
                }
            }
        }
        return null;
    }
    
    private static isValidForIsolation(idx: any): boolean {
        return isValidEpIdx(idx) && 
               PROVIDER_CONFIG.COMMON_RES.indexOf(idx) === -1 &&
               idx < PROVIDER_CONFIG.MAX_YEAR;
    }
}

class PerformanceCache {
    private static readonly _cache = new Map<string, CacheEntry>();
    private static _metrics: PerformanceMetrics = {
        searchTime: 0,
        parseTime: 0,
        cacheHits: 0,
        cacheMisses: 0,
        fuzzyCount: 0
    };
    
    static get(k: string): any {
        const ck = this.createKey(k);
        const entry = this._cache.get(ck);
        
        if (!entry) {
            this._metrics.cacheMisses++;
            return null;
        }
        
        const now = Date.now();
        if (now - entry.timestamp > PERF_CONFIG.CACHE_TTL) {
            this._cache.delete(ck);
            this._metrics.cacheMisses++;
            return null;
        }
        
        this._metrics.cacheHits++;
        return entry.data;
    }
    
    static set(k: string, data: any): void {
        if (this._cache.size >= PERF_CONFIG.MAX_CACHE_SIZE) {
            const fk = this._cache.keys().next().value;
            if (fk) this._cache.delete(fk);
        }
        
        const ck = this.createKey(k);
        const entry: CacheEntry = {
            data,
            timestamp: Date.now(),
            key: ck
        };
        
        this._cache.set(ck, entry);
    }
    
    private static createKey(k: string): string {
        return k.toLowerCase().replace(/\s+/g, '_');
    }
    
    static getMetrics(): PerformanceMetrics {
        return { ...this._metrics };
    }
    
    static incFuzzy(): void {
        this._metrics.fuzzyCount++;
    }
    
    static recSearch(t: any): void {
        this._metrics.searchTime += t;
    }
    
    static recParse(t: any): void {
        this._metrics.parseTime += t;
    }
}

class PageLinkFinder {
    private static _fm: FuzzyMatcher | null = null;
    
    private static get fm(): FuzzyMatcher {
        if (!this._fm) {
            this._fm = new FuzzyMatcher();
        }
        return this._fm;
    }
    static extractPageURL(html: string, q: string): string {
        try {
            // console.log("Extracting anime page URL for query: " + q);
            
            const ck = "page_extract_" + q;
            const cached = PerformanceCache.get(ck);
            if (cached) {
                console.log("Cache hit for page extraction: " + q);
                return cached;
            }
            
            const pot: ScoreMatch[] = [];
            let m: any;
            const rgx = new RegExp(REGEX_PATTERNS.PAGE_LINK_RGX.source, 'gi');
            let count = 0;
            
            while ((m = rgx.exec(html)) !== null) {
                const url = m[1];
                let matchLabel = m[2] || "";
                
                if (!matchLabel) {
                    matchLabel = PageLinkFinder.extractSlug(url);
                }
                
                if (PageLinkFinder.skipURL(url) || matchLabel.length < PERF_CONFIG.MIN_LABEL_LEN) {
                    continue;
                }
                
                const res = PageLinkFinder.calcScore(q, matchLabel, url);
                if (res.score > 0) {
                    pot.push(res);
                    // console.log("Found potential match: " + matchLabel + " (" + url + ") - Score: " + res.score + " (Strat: " + res.strat + ")");
                    
                    if (res.score >= PERF_CONFIG.EARLY_EXIT) {
                        // console.log("Early exit triggered for high-scoring match");
                        const final = res.url;
                        PerformanceCache.set(ck, final);
                        return final;
                    }
                }
                
                count++;
                if (count >= PERF_CONFIG.MAX_FUZZY_CANDS * 2) {
                    console.log("Limiting fuzzy matching candidates for performance");
                    break;
                }
            }
            
            const final = PageLinkFinder.best(pot);
            if (final) {
                PerformanceCache.set(ck, final);
            }
            return final;
            
        } catch (err) {
            console.log("Error extracting anime page URL: " + (err as any).message);
            return "";
        }
    }
    
    private static skipURL(url: string): boolean {
        const lUrl = url.toLowerCase();
        for (let i = 0; i < EXCLUDED_URLS.length; i++) {
            if (lUrl.indexOf(EXCLUDED_URLS[i]) !== -1) return true;
        }
        return lUrl.indexOf('/page/') !== -1 ||
               lUrl.indexOf('/search/') !== -1 ||
               lUrl.indexOf('/category/') !== -1 ||
               lUrl.indexOf('/?') !== -1 ||
               lUrl.endsWith('.jpg') ||
               lUrl.endsWith('.png') ||
               lUrl.endsWith('.css') ||
               lUrl.endsWith('.js');
    }
    
    private static calcScore(q: string, matchLabel: string, url: string): ScoreMatch {
        PerformanceCache.incFuzzy();
        
        const qL = q.toLowerCase();
        const lL = matchLabel.toLowerCase();
        
        if (qL === lL) {
            return {
                url,
                matchLabel,
                score: 100,
                strat: 'exact',
                normLabel: lL
            };
        }
        
        if (lL.indexOf(qL) !== -1) {
            return {
                url,
                matchLabel,
                score: 90,
                strat: 'exact',
                normLabel: lL
            };
        }
        
        const cScore = this.calcCompound(q, matchLabel);
        if (cScore >= 80) {
            return {
                url,
                matchLabel,
                score: cScore,
                strat: 'phonetic',
                normLabel: lL
            };
        }
        
        const slug = this.extractSlug(url);
        if (slug.length > 3) {
            const uScore = this.fm.match(q, slug);
            if (uScore >= 75) {
                return {
                    url,
                    matchLabel,
                    score: uScore,
                    strat: 'normalized',
                    normLabel: lL
                };
            }
        }
        
        const nQ = this.fm.normalize(q);
        const nL = this.fm.normalize(matchLabel);
        const fScore = this.fm.match(nQ, nL);
        
        const final = fScore >= 0 && fScore <= 100 ? fScore : 0;
        
        return {
            url,
            matchLabel,
            score: final,
            strat: 'fuzzy',
            normLabel: nL.length > 0 ? nL : undefined
        };
    }
    
    private static extractSlug(url: string): string {
        const m = url.match(/\/([^\/]+)\/?$/);
        if (m) {
            return m[1]
                .replace(/-/g, ' ')
                .replace(/_/g, ' ')
                .trim();
        }
        return "";
    }
    
    private static calcCompound(q: string, matchLabel: string): any {
        const words = q.toLowerCase().split(/\s+/);
        const lL = matchLabel.toLowerCase();
        
        const joined = words.join('');
        if (lL.indexOf(joined) !== -1) {
            return 85; 
        }
        
        const exL = lL
            .replace(/mahoutsukai/g, 'mahou tsukai')
            .replace(/seireitsukai/g, 'seirei tsukai')
            .replace(/kenshi/g, 'ken shi')
            .replace(/yuusha/g, 'yuu sha');
        
        if (exL.indexOf(q.toLowerCase()) !== -1) {
            return 80; 
        }
        
        let pMatch = 0;
        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            if (lL.indexOf(w) !== -1 && w.length > 2) {
                pMatch++;
            }
        }
        
        if (pMatch > 0) {
            return Math.min(70, pMatch * 25); 
        }
        
        return 0;
    }
    
    private static best(pot: ScoreMatch[]): string {
        if (pot.length === 0) {
            console.log("No anime page found");
            return "";
        }
        
        pot.sort((a, b) => {
            if (a.score !== b.score) {
                return b.score - a.score;
            }
            const order: any = {
                'exact': 4,
                'fuzzy': 3,
                'normalized': 2,
                'phonetic': 1
            };
            return (order[b.strat] || 0) - (order[a.strat] || 0);
        });
        
        const top = pot[0];
        console.log("Best match: " + top.matchLabel + " - " + top.url + " (Score: " + top.score + ", Strat: " + top.strat + ")");
        
        return top.url;
    }
}

class HTTPClient {
    static getHeader(res: any, key: string): string {
        if (!res || !res.headers) return "";
        if (typeof res.headers.get === 'function') return res.headers.get(key) || "";
        const lKey = key.toLowerCase();
        for (const k in res.headers) {
            if (k.toLowerCase() === lKey) return res.headers[k];
        }
        return "";
    }

    static getAllCookies(res: any): string {
        if (!res || !res.headers) return "";
        const cookiesMap = new Map<string, string>();
        
        const process = (val: string) => {
            const parts = val.split(/,(?=[^;]*=)/); 
            parts.forEach(p => {
                const cookiePart = p.split(';')[0].trim();
                const eqIdx = cookiePart.indexOf('=');
                if (eqIdx > 0) {
                    const name = cookiePart.substring(0, eqIdx);
                    const value = cookiePart.substring(eqIdx + 1);
                    cookiesMap.set(name, value);
                }
            });
        };

        if (typeof res.headers.forEach === 'function') {
            res.headers.forEach((value: string, key: string) => {
                if (key.toLowerCase() === 'set-cookie') {
                    process(value);
                }
            });
        } else if (res.headers['set-cookie']) {
            const sc = res.headers['set-cookie'];
            const scArr = Array.isArray(sc) ? sc : [String(sc)];
            scArr.forEach(process);
        }
        
        const result: string[] = [];
        cookiesMap.forEach((v, k) => result.push(`${k}=${v}`));
        return result.join('; ');
    }

    static async fetchWithUA(
        url: string,
        parser?: any,
        headers?: any,
        redir?: string
    ): Promise<any> {
        try {
            const res = await fetch(url, {
                headers: {
                    "User-Agent": PROVIDER_CONFIG.USER_AGENT,
                    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Connection": "keep-alive",
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Site": "none",
                    ...headers
                },
                redirect: (redir as any) || 'follow'
            });

            if (!res.ok && res.status !== 301 && res.status !== 302) {
                return {
                    success: false,
                    error: {
                        status: res.status,
                        message: "HTTP " + res.status + ": " + res.statusText
                    }
                };
            }

            const data = parser ? await parser(res) : await res.text();
            return { success: true, data, response: res };

        } catch (err) {
            return {
                success: false,
                error: {
                    status: 0,
                    message: err instanceof Error ? err.message : 'Unknown error'
                }
            };
        }
    }

    static async postForm(
        url: string,
        payload: any,
        headers?: any,
        redir?: any
    ): Promise<any> {
        try {
            const fd = new URLSearchParams();
            // Payload ordering is preserved by iterating Object.entries
            const entries = Object.entries(payload);
            for (let i = 0; i < entries.length; i++) {
                const [k, v] = entries[i];
                fd.append(k, String(v));
            }

            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    "User-Agent": PROVIDER_CONFIG.USER_AGENT,
                    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Connection": "keep-alive",
                    "Sec-Fetch-Dest": "empty",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Site": "same-origin",
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': '*/*',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    ...headers
                },
                body: fd.toString(),
                redirect: redir || 'follow'
            });

            return { success: true, data: res };

        } catch (err) {
            return {
                success: false,
                error: {
                    status: 0,
                    message: err instanceof Error ? err.message : 'Unknown error'
                }
            };
        }
    }
}

class StringNorm {
    static normalize(input: string): string {
        let res = input.toLowerCase().trim();
        
        const entries = Object.entries(CHAR_NORMS);
        for (let i = 0; i < entries.length; i++) {
            const [f, t] = entries[i];
            res = res.replace(new RegExp(f, 'g'), t as string);
        }
        
        for (let i = 0; i < ANIME_LABEL_VARS.patterns.length; i++) {
            const v = ANIME_LABEL_VARS.patterns[i];
            res = res.replace(v.from, v.to);
        }
        
        res = res.replace(/\s+/g, ' ').trim();
        
        return res;
    }
    
    static clean(input: string): string {
        return input
            .replace(/[\[\](){}]/g, '') 
            .replace(/[^\w\s\-]/g, '') 
            .replace(/\s+/g, ' ')
            .trim();
    }
}

class DistCalc {
    calculate(a: string, b: string): any {
        const matrix: any[][] = [];
        const aL = a.length;
        const bL = b.length;
        
        for (let i = 0; i <= bL; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= aL; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= bL; i++) {
            for (let j = 1; j <= aL; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, 
                        matrix[i][j - 1] + 1,     
                        matrix[i - 1][j] + 1      
                    );
                }
            }
        }
        
        return matrix[bL][aL];
    }
    
    static similarity(a: string, b: string, d: any): any {
        const max = Math.max(a.length, b.length);
        if (max === 0) return 1;
        return Math.max(0, (max - d) / max);
    }
}

class SoraBypass {
    private static readonly AJAX_URL = "https://otakufilmes.org/wp-admin/admin-ajax.php";
    private static readonly WAIT = 5000;

    static async bypass(sUrl: string, _ref?: string): Promise<string> {
        console.log("Attempting to bypass SoraLink protection for: " + sUrl);

        try {
            let currentUrl = sUrl;
            const cookiesMap = new Map<string, string>();
            let response: any;
            let html = "";
            
            const getCookieHeader = () => {
                const parts: string[] = [];
                cookiesMap.forEach((v, k) => parts.push(`${k}=${v}`));
                return parts.join('; ');
            };

            const updateCookies = (res: any) => {
                const raw = HTTPClient.getAllCookies(res);
                if (!raw) return;
                raw.split(';').forEach(c => {
                    const eqIdx = c.indexOf('=');
                    if (eqIdx > 0) {
                        const name = c.substring(0, eqIdx).trim();
                        const val = c.substring(eqIdx + 1).trim();
                        if (name) {
                            cookiesMap.set(name, val);
                        }
                    }
                });
            };

            // Manual redirect follow to capture all session cookies (simulating Python session)
            for (let i = 0; i < 5; i++) {
                const cookieHeader = getCookieHeader();
                const pRes = await HTTPClient.fetchWithUA(
                    currentUrl, 
                    undefined, 
                    { 'Referer': 'https://darkmahou.io/', 'Cookie': cookieHeader },
                    'manual'
                );
                if (!pRes.success) break;
                
                response = pRes.response;
                updateCookies(response);
                
                if (response.status === 301 || response.status === 302) {
                    const loc = HTTPClient.getHeader(response, 'Location');
                    if (loc) {
                        currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).href;
                        continue;
                    }
                }
                
                html = await response.text();
                break;
            }

            if (!html) {
                console.log("Failed to fetch landing page content");
                return "";
            }

            const dMatch = html.match(/(?:var|const|let)\s+(?:item|soralinklite)\s*=\s*({.*?})/s);
            if (!dMatch || !dMatch[1]) {
                console.log("Failed to extract var item from page");
                return "";
            }

            const aMatch = html.match(/"soralink_z":"(.*?)"/s);
            if (!aMatch || !aMatch[1]) {
                console.log("Failed to extract soralink_z action");
                return "";
            }

            let dJson: any;
            try {
                dJson = JSON.parse(dMatch[1]);
            } catch (e) {
                console.log("Failed to parse var item JSON: " + (e as any).message);
                return "";
            }

            const reqFields = ["token", "id", "time", "post", "redirect", "cacha", "link"];
            for (let i = 0; i < reqFields.length; i++) {
                const f = reqFields[i];
                if (dJson[f] === undefined || dJson[f] === null) {
                    console.log("Missing required field in extracted data: " + f);
                    return "";
                }
            }

            const action = aMatch[1];
            const toPyBool = (v: any) => {
                if (v === true) return "true";
                if (v === false) return "false";
                return String(v || "");
            };
            
            // Payload ordering matches Python script
            const payload: any = {
                "token": dJson["token"],
                "id": dJson["id"],
                "time": dJson["time"],
                "post": dJson["post"],
                "redirect": dJson["redirect"],
                "cacha": dJson["cacha"],
                "new": toPyBool(dJson["new"]),
                "link": dJson["link"],
                "action": action
            };

            console.log("Waiting 5 seconds before validation request...");
            await this.delay(this.WAIT);

            const postHeaders: any = { 
                'Referer': currentUrl,
                'Cookie': getCookieHeader()
            };

            const postRes = await HTTPClient.postForm(
                this.AJAX_URL,
                payload,
                postHeaders,
                'manual' 
            );

            if (!postRes.success) {
                console.log("POST request failed: " + postRes.error.message);
                return "";
            }

            const res = postRes.data;
            if (res.status === 302) {
                const loc = HTTPClient.getHeader(res, 'Location');
                if (loc) return loc;
            } else if (res.url && res.url !== this.AJAX_URL) {
                return res.url;
            } else if (res.status === 200) {
                const text = await res.text();
                try {
                    const j = JSON.parse(text);
                    if (j.url) return j.url;
                } catch(e) {}
            }

            console.log("Expected redirect but got status: " + res.status);
            return "";

        } catch (err) {
            console.log("Error in SoraLink bypass: " + (err as any).message);
            return "";
        }
    }

    private static async delay(ms: number): Promise<void> {
        if (typeof $sleep !== 'undefined') {
            await ($sleep(ms) as any);
        } else {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }
}

class FuzzyMatcher {
    private readonly dc = new DistCalc();
    
    match(q: string, t: string, config: any = FUZZY_CONFIG): any {
        const s1 = this.exactMatch(q, t, config.weights.exact);
        if (s1 === 100) return 100;

        const s2 = this.fuzzy(q, t, config);
        const s3 = this.norm(q, t, config.weights.normalized);
        const s4 = this.phonetic(q, t, config.weights.phonetic);
        
        return Math.max(s1, s2, s3, s4);
    }
    
    normalize(input: string): string {
        return StringNorm.normalize(input);
    }
    
    private exactMatch(q: string, t: string, w: any): any {
        const qN = q.toLowerCase().trim();
        const tN = t.toLowerCase().trim();
        
        if (qN === tN) return w;
        if (tN.indexOf(qN) !== -1) return w * 0.8;
        if (qN.indexOf(tN) !== -1) return w * 0.7;
        
        return 0;
    }
    
    private fuzzy(q: string, t: string, config: any): any {
        const d = this.dc.calculate(q, t);
        
        if (d > config.maxDist) return 0;
        
        const sim = DistCalc.similarity(q, t, d);
        
        if (sim < config.minSim) return 0;
        
        return Math.round(sim * config.weights.fuzzy);
    }
    
    private norm(q: string, t: string, w: any): any {
        const qN = this.normalize(q);
        const tN = this.normalize(t);
        
        if (qN === tN) return w;
        if (tN.indexOf(qN) !== -1) return w * 0.8;
        if (qN.indexOf(tN) !== -1) return w * 0.7;
        
        const qC = StringNorm.clean(qN);
        const tC = StringNorm.clean(tN);
        
        if (qC === tC) return w * 0.6;
        if (tC.indexOf(qC) !== -1) return w * 0.5;
        
        return 0;
    }
    
    private phonetic(q: string, t: string, w: any): any {
        const qP = this.toPh(q);
        const tP = this.toPh(t);
        
        if (qP === tP) return w;
        if (tP.indexOf(qP) !== -1) return w * 0.7;
        
        return 0;
    }
    
    private toPh(input: string): string {
        return input
            .toLowerCase()
            .replace(/ou/g, 'o')     
            .replace(/uu/g, 'u')
            .replace(/ei/g, 'e')
            .replace(/[^a-z0-9\s]/g, '') 
            .replace(/\s+/g, '')     
            .trim();
    }
}

class Provider {
    private readonly api = PROVIDER_CONFIG.API_BASE_URL;
    private readonly translator = new PortugueseTranslator();

    getSettings(): AnimeProviderSettings {
        return {
            canSmartSearch: true,
            smartSearchFilters: ["episode" + "Number", "resolution", "query"],
            supportsAdult: false,
            type: "main"
        };
    }

    async search(opts: AnimeSearchOptions): Promise<AnimeTorrent[]> {
        const t0 = Date.now();
        // console.log("Searching for: " + opts.query);
        
        try {
            const ck = "search_" + opts.query;
            const cached = PerformanceCache.get(ck);
            if (cached) {
                console.log("Cache hit for search: " + opts.query);
                PerformanceCache.recSearch(Date.now() - t0);
                return cached;
            }
            
            const cQ = this.translator.parse(opts.query);
            // console.log("Converted query: " + cQ);
            
            const sUrl = this.api + "/?s=" + encodeURIComponent(cQ);
            // console.log("Search URL: " + sUrl);
            
            const fRes = await HTTPClient.fetchWithUA(sUrl);
            
            if (!fRes.success) {
                console.log("Search failed: " + fRes.error.message + " (Status: " + fRes.error.status + ")");
                PerformanceCache.recSearch(Date.now() - t0);
                return [];
            }

            const aURL = PageLinkFinder.extractPageURL(fRes.data, cQ);
            
            if (!aURL) {
                console.log("No anime page found for: " + opts.query);
                PerformanceCache.recSearch(Date.now() - t0);
                return [];
            }

            // console.log("Found anime page: " + aURL);
            
            const results = await this.fetchTorrents(aURL, opts.media);
            
            if (results.length > 0) {
                PerformanceCache.set(ck, results);
            }
            
            PerformanceCache.recSearch(Date.now() - t0);
            return results;
            
        } catch (err) {
            console.log("Error in search: " + (err as any).message);
            PerformanceCache.recSearch(Date.now() - t0);
            return [];
        }
    }

    async smartSearch(opts: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
        try {
            const romKey = "romaji" + "Title";
            const engKey = "english" + "Title";
            const epNumKey = "episode" + "Number";
            const q = opts.query || (opts.media as any)[romKey] || (opts.media as any)[engKey] || "";
            const epIdx = (opts as any)[epNumKey] || 1;
            
            // console.log("Smart search for: " + q + " - EpIdx: " + epIdx);
            
            const results = await this.search({ media: opts.media, query: q });
            
            if (results.length === 0) {
                return [];
            }
            
            return this.applyFilters(results, opts);
            
        } catch (err) {
            console.log("Error in smart search: " + (err as any).message);
            return [];
        }
    }
    
    private applyFilters(
        results: AnimeTorrent[], 
        opts: AnimeSmartSearchOptions
    ): AnimeTorrent[] {
        let fil = results;
        const epNumKey = "episode" + "Number";
        const targetEp = (opts as any)[epNumKey];
        
        if (targetEp && targetEp > 0) {
            fil = fil.filter((t: any) => 
                t[epNumKey] === targetEp || 
                t.isBatch || 
                t[epNumKey] === -1
            );
        }
        
        if (opts.resolution) {
            fil = fil.filter((t: any) => 
                !t.resolution || 
                t.resolution.indexOf(opts.resolution) !== -1
            );
        }
        
        if (opts.batch) {
            fil = fil.filter((t: any) => t.isBatch);
        }
        
        return fil;
    }

    async getTorrentInfoHash(torrent: AnimeTorrent): Promise<string> {
        console.log("Getting info hash for torrent: " + (torrent.name || "Unknown"));
        
        if (!torrent || typeof torrent !== 'object') {
            console.log("Invalid torrent object provided");
            return "";
        }
        
        if (torrent.infoHash && torrent.infoHash.length === 40) {
            console.log("Info hash found: " + torrent.infoHash);
            return torrent.infoHash;
        }
        
        if (torrent.magnetLink && isValidMag(torrent.magnetLink)) {
            console.log("Trying to extract info hash from magnet link...");
            const hash = TorrentParser.extractInfoHash(torrent.magnetLink);
            if (hash) {
                console.log("Extracted info hash from magnet link: " + hash);
                return hash;
            }
        }
        
        console.log("No valid info hash found for torrent: " + (torrent.name || "Unknown"));
        return "";
    }

    async getTorrentMagnetLink(torrent: AnimeTorrent): Promise<string> {
        console.log("Getting magnet link for torrent: " + (torrent.name || "Unknown"));
        
        if (!torrent || typeof torrent !== 'object') {
            console.log("Invalid torrent object provided");
            return "";
        }
        
        if (torrent.magnetLink && isValidMag(torrent.magnetLink)) {
            console.log("Magnet link found: " + torrent.magnetLink.substring(0, 100) + "...");
            return torrent.magnetLink;
        }

        if (torrent.link && torrent.link.includes("systemads.net")) {
            console.log("Extracting magnet link from systemads.net...");
            try {
                const req = await fetch(torrent.link, {
                    headers: {
                        "User-Agent": PROVIDER_CONFIG.USER_AGENT
                    },
                    redirect: "follow"
                });

                const html = await req.text();
                const match = html.match(/const\s+DEST_URL\s*=\s*["'](magnet:\?[^"']+)["']/i);
                
                if (match && match[1]) {
                    console.log("Extracted magnet link successfully");
                    return match[1];
                }
            } catch (e) {
                console.error("Error extracting magnet from systemads:", e);
            }
        }
        
        console.log("No valid magnet link found for torrent: " + (torrent.name || "Unknown"));
        return "";
    }

    async getLatest(): Promise<AnimeTorrent[]> {
        return [];
    }
    
    private async fetchTorrents(aURL: string, _m: Media): Promise<AnimeTorrent[]> {
        // console.log("Fetching torrents from: " + aURL);
        
        const fRes = await HTTPClient.fetchWithUA(aURL);
        
        if (!fRes.success) {
            console.log("Failed to fetch anime page: " + fRes.error.message + " (Status: " + fRes.error.status + ")");
            return [];
        }

        return this.parseHTML(fRes.data, aURL);
    }

    private async parseHTML(html: string, aURL: string): Promise<AnimeTorrent[]> {
        const t0 = Date.now();

        try {
            // console.log("Parsing torrents from HTML using optimized regex...");

            const ck = "torrents_" + aURL;
            const cached = PerformanceCache.get(ck);
            if (cached) {
                console.log("Cache hit for torrents parsing: " + aURL);
                PerformanceCache.recParse(Date.now() - t0);
                return cached;
            }

            const results = await this.parseRegex(html, aURL);

            if (results.length > 0) {
                PerformanceCache.set(ck, results);
            }

            PerformanceCache.recParse(Date.now() - t0);
            return results;

        } catch (err) {
            console.log("Error parsing torrents: " + (err as any).message);
            PerformanceCache.recParse(Date.now() - t0);
            return [];
        }
    }

    // Reads episode numbers straight from the DOM instead of guessing them from
    // magnet dn= filenames: each div.mctnx div.soraddl block belongs to one
    // episode per its .sorattl h3 heading (matches the real Kotlin extractor's
    // structure), so every magnet inside that block gets that exact number
    // instead of running through the regex heuristics in TorrentParser.getEpIdx.
    private parseStructured(html: string, aURL: string): AnimeTorrent[] {
        const res: AnimeTorrent[] = [];

        try {
            const $ = LoadDoc(html);

            $("div.mctnx div.soraddl").each((_: any, block: any) => {
                const epLabel = block.find(".sorattl h3").text().trim();
                const epMatch = epLabel.match(/(\d+(?:\.\d+)?)/);
                if (!epMatch) return;
                const epIdx = parseFloat(epMatch[1]);

                // New format: quality-grouped tables (current darkmahou.io layout)
                block.find(".content table tr").each((_: any, row: any) => {
                    row.find(".slink a").each((_: any, link: any) => {
                        const mag = link.attr("href");
                        if (!mag || !isValidMag(mag)) return;
                        // Name comes from the magnet's own dn= filename (like the
                        // rest of this file) so resolution/batch/release-group
                        // extraction stays consistent — only episodeNumber is
                        // overridden with the DOM-confirmed value.
                        const name = this.getName(mag, res.length + 1);
                        res.push(this.makeTorrentObj(name, mag, aURL, TorrentParser.parseRes(name), epLabel, epIdx));
                    });
                });

                // Old format: dublado/legendado divs
                block.find(".soraurl").each((_: any, group: any) => {
                    group.find(".slink a").each((_: any, link: any) => {
                        const mag = link.attr("href");
                        if (!mag || !isValidMag(mag)) return;
                        const name = this.getName(mag, res.length + 1);
                        res.push(this.makeTorrentObj(name, mag, aURL, TorrentParser.parseRes(name), epLabel, epIdx));
                    });
                });
            });
        } catch (err) {
            console.log("Error in structured (DOM) parsing: " + (err as any).message);
        }

        return res;
    }

    private async parseRegex(html: string, aURL: string): Promise<AnimeTorrent[]> {
        const res: AnimeTorrent[] = this.parseStructured(html, aURL);

        try {
            // console.log("Using optimized regex to find magnet links...");

            const labeledPat = /<a[^>]+href=["'](https?:\/\/darkmahou\.io\?([a-zA-Z0-9]+)=([a-zA-Z0-9+\/]+=*))["'][^>]*>(.*?)<\/a>/gi;
            let m;
            while ((m = labeledPat.exec(html)) !== null) {
                const sUrl = m[1];
                const label = m[4] || "";
                
                if (this.isSora(sUrl)) {
                    console.log("Found protected URL: " + sUrl.substring(0, 50) + "... (Label: " + label + ")");

                    const mag = await this.tryBypass(sUrl, aURL);
                    if (mag) {
                        const name = this.getName(mag, res.length + 1);
                        const resolution = TorrentParser.parseRes(label) || TorrentParser.parseRes(name);
                        
                        res.push(this.makeTorrentObj(
                            name,
                            mag,
                            aURL,
                            resolution,
                            label
                        ));
                    }
                }
            }
            
            const fallbackPats = [
                /(?:href|data-link|data-url)=["'](https?:\/\/[^"']*(?:otakufilmes\.org|soralink)[^"']*)["']/gi,
                /(?:href|data-link|data-url)=["']([^"']*\?[a-zA-Z0-9_=]{20,})["']/gi
            ];

            for (let i = 0; i < fallbackPats.length; i++) {
                const pat = fallbackPats[i];
                let m2;
                while ((m2 = pat.exec(html)) !== null) {
                    const sUrl = m2[1];
                    if (res.some(t => t.magnetLink === sUrl || t.link === sUrl)) continue;

                    if (this.isSora(sUrl)) {
                        const mag = await this.tryBypass(sUrl, aURL);
                        if (mag) {
                            if (res.some(t => t.magnetLink === mag)) continue;
                            const name = this.getName(mag, res.length + 1);
                            res.push(this.makeTorrentObj(
                                name,
                                mag,
                                aURL,
                                TorrentParser.parseRes(name),
                                ""
                            ));
                        }
                    }
                }
            }

            const mMatches = html.match(REGEX_PATTERNS.MAGNET_LINK);

            if (mMatches && mMatches.length > 0) {
                // console.log("Found " + mMatches.length + " magnet links in page");

                const seen = new Set<string>();
                for (let i = 0; i < res.length; i++) {
                    if (res[i].infoHash) seen.add(res[i].infoHash);
                }

                for (let i = 0; i < mMatches.length; i++) {
                    const mag = mMatches[i];

                    const hash = TorrentParser.extractInfoHash(mag);
                    if (hash && seen.has(hash)) {
                        continue;
                    }
                    if (hash) seen.add(hash);

                    const name = this.getName(mag, res.length + 1);

                    res.push(this.makeTorrentObj(
                        name,
                        mag,
                        aURL,
                        TorrentParser.parseRes(name),
                        ""
                    ));
                }
            }

            // console.log("Optimized regex parsing found " + res.length + " unique torrents");
            return res;

        } catch (err) {
            console.log("Error in optimized regex parsing: " + (err as any).message);
            return [];
        }
    }

    private isSora(url: string): boolean {
        if (!url) return false;
        const lUrl = url.toLowerCase();
        
        const excluded = [
            "youtube.com", "google.com", "facebook.com", "twitter.com", "instagram.com", 
            "xmlrpc.php", "wp-admin", "wp-content", "wp-includes", "/wp-json/", 
            "wordpress.org", "schema.org", "gravatar.com", "w.org"
        ];
        
        for (let i = 0; i < excluded.length; i++) {
            if (lUrl.indexOf(excluded[i]) !== -1) return false;
        }

        if (lUrl.indexOf("otakufilmes.org") !== -1 || lUrl.indexOf("soralink") !== -1) {
            return true;
        }

        if (lUrl.indexOf("darkmahou.io") !== -1 && lUrl.indexOf("?") !== -1 && url.length > 40) {
            return true;
        }

        if (/[\?&][a-zA-Z0-9]{20,}/.test(url)) {
            if (lUrl.indexOf("/?") !== -1 && lUrl.indexOf("=") === -1) return true;
            if (/[\?&](?:token|link|id|cacha|post)=/.test(lUrl)) return true;
        }

        return false;
    }

    private async tryBypass(sUrl: string, ref?: string): Promise<string> {
        try {
            const final = await SoraBypass.bypass(sUrl, ref);
            if (final) {
                if (final.indexOf("magnet:") === 0) {
                    return final;
                } else {
                    const fRes = await HTTPClient.fetchWithUA(final);
                    if (fRes.success) {
                        const m = fRes.data.match(REGEX_PATTERNS.MAGNET_LINK);
                        if (m && m.length > 0) {
                            return m[0];
                        }
                    }
                }
            }
        } catch (err) {
            console.log("Error attempting SoraLink bypass: " + (err as any).message);
        }
        return "";
    }
    
    private getName(mag: string, fIdx: any): string {
        const m = mag.match(/&dn=([^&]+)/);
        if (m) {
            try {
                return decodeURIComponent(m[1]);
            } catch (e) {
                return m[1];
            }
        }
        return "Episode " + fIdx;
    }

    private makeTorrentObj(
        name: string,
        mag: string,
        aURL: string,
        res: string,
        epLabel: string,
        epIdxOverride?: number
    ): AnimeTorrent {
        const hash = TorrentParser.extractInfoHash(mag);
        const pRes = TorrentParser.parseRes(name) || res;
        const batch = TorrentParser.checkIsBatch(name, epLabel);
        // A DOM-confirmed episode number is only trusted when the block isn't
        // itself a batch release (e.g. an h3 like "Episódios 1-12" would
        // otherwise match "1" as a false single-episode number).
        const epIdx = (epIdxOverride !== undefined && !batch) ? epIdxOverride : TorrentParser.getEpIdx(name, epLabel);
        const group = TorrentParser.extractReleaseGroup(name);
        
        return {
            name: name,
            date: new Date().toISOString(),
            size: 0,
            formattedSize: "N/A",
            seeders: 0,
            leechers: 0,
            downloadCount: 0,
            link: aURL,
            downloadUrl: "",
            magnetLink: mag,
            infoHash: hash,
            resolution: pRes,
            isBatch: batch,
            ["episode" + "Number"]: epIdx !== null ? epIdx : -1,
            releaseGroup: group,
            isBestRelease: false,
            confirmed: true
        };
    }

}
