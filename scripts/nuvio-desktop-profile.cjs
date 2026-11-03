// Aetherio managed desktop profile. Copied and bundled by stage-nuvio.ps1.
const ARCHIVE_PROVIDERS = new Set([
  'replayzone', 'soccerfull', 'fullraces', 'basketballvideo', 'nflvideo',
  'hockeyreplays', 'mlblive', 'livetv',
]);
const CONFIGURED = Symbol.for('aetherio.nuvio.desktop-profile');
const providerName = provider => String(provider.sourceName || provider.name || '').toLowerCase();

function configureDesktopProfile(container) {
  const aggregator = container.resolve('matchAggregator');
  if (aggregator[CONFIGURED]) return;
  // Keep the complete archive for Sports' replay row, but let live schedules
  // acquire the bounded slots first. Upstream retains its 12-hour replay cache.
  aggregator.providers = aggregator.providers.filter(Boolean);
  const priority = ['ak47live', 'ppvst', 'sktech', 'leaf'];
  const rank = provider => {
    const name = providerName(provider);
    if (ARCHIVE_PROVIDERS.has(name)) return priority.length + 1;
    const index = priority.indexOf(name);
    return index < 0 ? priority.length : index;
  };
  aggregator.providers.sort((a, b) => rank(a) - rank(b));
  const cache = container.resolve('cacheService');
  const fetchProvider = aggregator._fetchProviderMatches.bind(aggregator);
  const waiting = [];
  let active = 0;
  aggregator._fetchProviderMatches = async (...args) => {
    if (active < 4) active++;
    else await new Promise(resolve => waiting.push(resolve));
    try {
      const matches = await fetchProvider(...args);
      // Upstream normally waits for EVERY provider before publishing anything.
      // On cold boot, publish the first usable football/MMA schedule immediately;
      // the normal full sync still performs the final merge. Never clobber a
      // populated persistent cache with a partial provider result.
      if (Array.isArray(matches) && typeof cache.getMatchesReadOnly === 'function' &&
          cache.getMatchesReadOnly().length === 0) {
        const schedule = matches.filter(match => match && !match.isReplay &&
          ['football', 'soccer', 'mma', 'boxing', 'ufc'].includes(String(match.category || '').toLowerCase()) &&
          Array.isArray(match.sources) && match.sources.length > 0);
        if (schedule.length) cache.setMatches(schedule);
      }
      return matches;
    } finally {
      // Transfer a reserved slot directly so newly arriving requests cannot
      // overtake a queued request and exceed the concurrency budget.
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
  process.env.PREWARM_MAX_MATCHES = '0';
  process.env.CATALOG_MEMO_PREWARM = 'false';
  process.env.LOGO_ENRICH_CONCURRENCY = '2';
  aggregator[CONFIGURED] = true;
}

module.exports = { configureDesktopProfile };
