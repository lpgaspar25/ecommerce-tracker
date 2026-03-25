// Cloudflare Worker — Media Proxy for Swipe File
// Fetches URLs server-side (no CORS), extracts media from Instagram/Facebook/YouTube

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'extract';

    // ── Search mode — mine Facebook Ad Library ──
    if (action === 'search') {
      try { return json(await searchFacebookAds(url.searchParams)); }
      catch (e) { return json({ error: e.message || 'Search error' }, 500); }
    }

    // ── Paginate mode — fetch ads by page_id (pure pagination) ──
    if (action === 'paginate') {
      try { return json(await paginateFacebookAds(url.searchParams)); }
      catch (e) { return json({ error: e.message || 'Paginate error' }, 500); }
    }

    // ── Scroll mode — GraphQL pagination with Facebook cookies ──
    if (action === 'scroll') {
      try { return json(await scrollFacebookAds(url.searchParams)); }
      catch (e) { return json({ error: e.message || 'Scroll error' }, 500); }
    }

    // ── GraphQL pagination proxy — accepts POST with JSON body ──
    if (action === 'graphql') {
      try {
        let docId, variables;
        if (request.method === 'POST') {
          const body = await request.json();
          docId = body.doc_id || '25788260324159216';
          variables = typeof body.variables === 'string' ? body.variables : JSON.stringify(body.variables || {});
        } else {
          docId = url.searchParams.get('doc_id') || '25788260324159216';
          variables = url.searchParams.get('variables') || '{}';
        }

        const gqlResp = await fetch('https://www.facebook.com/api/graphql/', {
          method: 'POST',
          headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ doc_id: docId, variables }).toString(),
        });
        const gqlText = await gqlResp.text();

        const seen = new Set();
        const result = parseAdsFromHtml(gqlText, seen);
        const endCursorMatch = gqlText.match(/"end_cursor"\s*:\s*"([^"]+)"/);
        const hasNext = gqlText.includes('"has_next_page":true');

        // Count raw ad_archive_ids in response for debugging
        const rawIds = (gqlText.match(/"ad_archive_id"/g) || []).length;

        return json({
          ads: result.ads,
          total: result.ads.length,
          nextCursor: (endCursorMatch && hasNext) ? endCursorMatch[1] : '',
          hasMore: hasNext && !!endCursorMatch,
          _rawAdCount: rawIds,
          _responseLen: gqlText.length,
        });
      } catch (e) { return json({ error: e.message }, 500); }
    }

    const target = url.searchParams.get('url');
    if (!target) return json({ error: 'Missing url param' }, 400);

    try {
      // Raw proxy mode — returns binary content (for downloading videos/images)
      if (action === 'proxy') {
        return await proxyRaw(target);
      }

      // Extract mode — returns JSON with media metadata
      if (target.includes('youtube.com') || target.includes('youtu.be')) {
        return json(await extractYouTube(target));
      }
      if (target.includes('instagram.com')) {
        return json(await extractInstagram(target));
      }
      if (target.includes('facebook.com') || target.includes('fb.watch')) {
        return json(await extractFacebook(target));
      }
      // Generic OG extraction
      return json(await extractOG(target));

    } catch (e) {
      return json({ error: e.message || 'Unknown error' }, 500);
    }
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function fetchPage(url, extraHeaders = {}) {
  // Instagram and Facebook respond to their crawler UA with full OG tags
  let ua = UA;
  if (url.includes('instagram.com') || url.includes('facebook.com')) {
    ua = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
  }

  // YouTube needs consent cookie
  let cookies = '';
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    cookies = 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlfZnJvbnRlbmRfdWlzZXJ2ZXJfMjAyMzA4MjkuMDdfcDAQARocBBgiEA; CONSENT=PENDING+987;';
  }

  const resp = await fetch(url, {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8',
      'Cache-Control': 'no-cache',
      ...(cookies ? { 'Cookie': cookies } : {}),
      ...extraHeaders,
    },
    redirect: 'follow',
  });
  return await resp.text();
}

async function proxyRaw(target) {
  // Use crawler UA for Instagram/Facebook for better content response
  let ua = UA;
  if (target.includes('instagram.com') || target.includes('facebook.com')) {
    ua = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
  }
  const resp = await fetch(target, {
    headers: { 'User-Agent': ua, 'Accept': '*/*', 'Referer': new URL(target).origin + '/' },
    redirect: 'follow',
  });
  const body = await resp.arrayBuffer();
  return new Response(body, {
    status: resp.status,
    headers: {
      ...CORS,
      'Content-Type': resp.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Length': body.byteLength.toString(),
    },
  });
}

function getOG(html, prop) {
  // Match property="og:X" ... content="VALUE" — handle both quote orders
  // Use a more generous regex that handles &amp; inside content values
  const re1 = new RegExp(`property=["']og:${prop}["']\\s[^>]*?content="([^"]*)"`, 'i');
  const re2 = new RegExp(`content="([^"]*)"\\s[^>]*?property=["']og:${prop}["']`, 'i');
  const re3 = new RegExp(`property='og:${prop}'\\s[^>]*?content='([^']*)'`, 'i');
  const m = html.match(re1) || html.match(re2) || html.match(re3);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&#x27;/g, "'") : '';
}

function getMeta(html, name) {
  const m = html.match(new RegExp(`name=["']${name}["'][^>]*content=["']([^"']+)`, 'i'))
    || html.match(new RegExp(`content=["']([^"']+)["'][^>]*name=["']${name}`, 'i'));
  return m ? m[1].replace(/&amp;/g, '&') : '';
}

async function extractOG(url) {
  const html = await fetchPage(url);
  return {
    title: getOG(html, 'title') || getMeta(html, 'title'),
    thumbnail: getOG(html, 'image'),
    videoUrl: getOG(html, 'video:secure_url') || getOG(html, 'video:url') || getOG(html, 'video'),
    description: getOG(html, 'description'),
  };
}

// ── YouTube ──────────────────────────────────────────────────────────────────

async function extractYouTube(url) {
  const videoId = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoId) return { error: 'Invalid YouTube URL' };

  let videoUrl = '';
  let title = '';
  let author = '';
  let duration = 0;
  let captions = '';

  // Fetch the watch page with regular UA (needed for player response)
  // Override to use browser UA for YouTube (not facebook crawler)
  const html = await fetchPage(`https://www.youtube.com/watch?v=${videoId}`, {
    'User-Agent': UA,
    'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlfZnJvbnRlbmRfdWlzZXJ2ZXJfMjAyMzA4MjkuMDdfcDAQARocBBgiEA; CONSENT=YES+cb.20210328;',
  });

  // Title from <title> tag
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  if (titleMatch) title = titleMatch[1].replace(' - YouTube', '').trim();

  // Extract ytInitialPlayerResponse for video details + streams
  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|let|const|<\/script)/s);
  if (playerMatch) {
    try {
      const player = JSON.parse(playerMatch[1]);
      if (!title) title = player.videoDetails?.title || '';
      author = player.videoDetails?.author || '';
      duration = parseInt(player.videoDetails?.lengthSeconds || '0', 10);

      // Try to get direct video URLs (works for some videos)
      const fmts = player.streamingData?.formats || [];
      const mp4 = fmts.filter(f => f.url && f.mimeType?.includes('video/mp4'));
      if (mp4.length > 0) {
        mp4.sort((a, b) => (b.height || 0) - (a.height || 0));
        videoUrl = mp4[0].url;
      }
    } catch (e) { /* parsing failed */ }
  }

  // Also try WEB client API for title/author if page scraping failed
  if (!title) {
    try {
      const apiResp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({
          videoId,
          context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en' } },
        }),
      });
      const data = await apiResp.json();
      if (!title) title = data.videoDetails?.title || '';
      if (!author) author = data.videoDetails?.author || '';
    } catch (e) { /* continue */ }
  }

  // Extract captions from page HTML
  const capMatch = html.match(/"captionTracks":\[\{"baseUrl":"([^"]+)"/);
  if (capMatch) {
    try {
      let capUrl = capMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      capUrl += (capUrl.includes('?') ? '&' : '?') + 'fmt=json3';
      const capResp = await fetch(capUrl, { headers: { 'User-Agent': UA } });
      const capJson = await capResp.json();
      captions = (capJson.events || [])
        .filter(e => e.segs)
        .map(e => e.segs.map(s => (s.utf8 || '').replace(/\n/g, ' ')).join(''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    } catch (e) { /* no captions */ }
  }

  const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  return { title, thumbnail, videoUrl, author, videoId, duration, captions, platform: 'youtube' };
}

// ── Instagram ────────────────────────────────────────────────────────────────

async function extractInstagram(url) {
  const baseUrl = url.split('?')[0];

  // Strategy: try fetching with facebookexternalhit UA
  // This works from residential IPs but may fail from data center IPs
  const html = await fetchPage(baseUrl);

  let title = getOG(html, 'title') || getOG(html, 'description') || '';
  let thumbnail = getOG(html, 'image') || '';
  let videoUrl = getOG(html, 'video') || getOG(html, 'video:secure_url') || getOG(html, 'video:url') || '';

  // Try embedded JSON
  if (!videoUrl) {
    const videoMatch = html.match(/"video_url"\s*:\s*"([^"]+)"/);
    if (videoMatch) videoUrl = videoMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  }

  // Extract username
  let author = '';
  const authorMatch = html.match(/"username"\s*:\s*"([^"]+)"/);
  if (authorMatch) author = authorMatch[1];
  if (!author) {
    const urlAuthor = url.match(/instagram\.com\/([^/?]+)\//);
    if (urlAuthor && !['p', 'reel', 'tv', 'stories'].includes(urlAuthor[1])) author = urlAuthor[1];
  }

  // If server-side fetch failed (common with data center IPs), return
  // what we have — client code has fallback with allorigins proxy
  const isVideo = !!videoUrl || html.includes('og:video') || html.includes('"is_video":true');

  return { title, thumbnail, videoUrl, author, mediaType: isVideo ? 'video' : 'image', platform: 'instagram' };
}

// ── Facebook ─────────────────────────────────────────────────────────────────

async function extractFacebook(url) {
  const isAdsLib = url.includes('ads/library');
  const adIdMatch = url.match(/[?&]id=(\d+)/);
  const adId = adIdMatch ? adIdMatch[1] : '';

  const html = await fetchPage(url);

  let title = getOG(html, 'title') || '';
  let thumbnail = getOG(html, 'image') || '';
  let videoUrl = getOG(html, 'video:secure_url') || getOG(html, 'video:url') || getOG(html, 'video') || '';

  // Extract video URLs from FB's inline JSON (works for regular posts)
  if (!videoUrl) {
    const hdMatch = html.match(/"hd_src"\s*:\s*"([^"]+)"/);
    const sdMatch = html.match(/"sd_src"\s*:\s*"([^"]+)"/);
    if (hdMatch) videoUrl = hdMatch[1].replace(/\\\//g, '/');
    else if (sdMatch) videoUrl = sdMatch[1].replace(/\\\//g, '/');
  }

  // For Ads Library: extract video_hd_url, video_sd_url, video_preview_image_url
  if (isAdsLib) {
    if (!videoUrl) {
      const hdMatch = html.match(/"video_hd_url"\s*:\s*"([^"]+)"/);
      const sdMatch = html.match(/"video_sd_url"\s*:\s*"([^"]+)"/);
      if (hdMatch) videoUrl = hdMatch[1].replace(/\\\//g, '/').replace(/\\u0025/g, '%');
      else if (sdMatch) videoUrl = sdMatch[1].replace(/\\\//g, '/').replace(/\\u0025/g, '%');
    }
    if (!thumbnail) {
      const prevMatch = html.match(/"video_preview_image_url"\s*:\s*"([^"]+)"/);
      if (prevMatch) thumbnail = prevMatch[1].replace(/\\\//g, '/');
    }
    // Also try to get the ad image if no video
    if (!thumbnail && !videoUrl) {
      const imgMatch = html.match(/"resized_image_url"\s*:\s*"([^"]+)"/);
      if (imgMatch) thumbnail = imgMatch[1].replace(/\\\//g, '/');
    }
    // Try to extract ad page name
    if (!title || title === `Facebook Ad #${adId}`) {
      const nameMatch = html.match(/"page_name"\s*:\s*"([^"]+)"/);
      if (nameMatch) title = nameMatch[1] + (adId ? ` — Ad #${adId}` : '');
    }
  }

  const mediaType = videoUrl ? 'video' : (thumbnail ? 'image' : 'unknown');

  return {
    title: title || (adId ? `Facebook Ad #${adId}` : 'Facebook'),
    thumbnail,
    videoUrl,
    author: isAdsLib ? 'Facebook Ads Library' : '',
    adId,
    mediaType,
    platform: 'facebook',
  };
}

// ── Facebook Ad Library Search ─────────────────────────────────────────────────

function buildFbSearchUrl(query, country, mediaType, activeStatus, dateFrom, dateTo, language) {
  const fbUrl = new URL('https://www.facebook.com/ads/library/');
  fbUrl.searchParams.set('active_status', activeStatus);
  fbUrl.searchParams.set('ad_type', 'all');
  fbUrl.searchParams.set('country', country);
  fbUrl.searchParams.set('q', query);
  if (mediaType !== 'all') fbUrl.searchParams.set('media_type', mediaType);
  if (language) fbUrl.searchParams.set('content_languages[0]', language);
  fbUrl.searchParams.set('search_type', 'keyword_unordered');
  if (dateFrom) fbUrl.searchParams.set('start_date[min]', dateFrom);
  if (dateTo) fbUrl.searchParams.set('start_date[max]', dateTo);
  return fbUrl.toString();
}

function parseAdsFromHtml(html, seen) {
  const ads = [];
  const archiveIdRegex = /"ad_archive_id"\s*:\s*"(\d+)"/g;
  let match;
  while ((match = archiveIdRegex.exec(html)) !== null) {
    const adId = match[1];
    if (seen.has(adId)) continue;
    seen.add(adId);

    const start = Math.max(0, match.index - 200);
    const end = Math.min(html.length, match.index + 5000);
    const chunk = html.substring(start, end);

    const ad = { adId };

    const pnMatch = chunk.match(/"page_name"\s*:\s*"([^"]+)"/);
    ad.pageName = pnMatch ? pnMatch[1] : '';

    const pidMatch = chunk.match(/"page_id"\s*:\s*"(\d+)"/);
    ad.pageId = pidMatch ? pidMatch[1] : '';

    const vhdMatch = chunk.match(/"video_hd_url"\s*:\s*"([^"]+)"/);
    if (vhdMatch) ad.videoUrl = vhdMatch[1].replace(/\\\//g, '/').replace(/\\u0025/g, '%');
    if (!ad.videoUrl) {
      const vsdMatch = chunk.match(/"video_sd_url"\s*:\s*"([^"]+)"/);
      if (vsdMatch) ad.videoUrl = vsdMatch[1].replace(/\\\//g, '/').replace(/\\u0025/g, '%');
    }

    const vpMatch = chunk.match(/"video_preview_image_url"\s*:\s*"([^"]+)"/);
    if (vpMatch) ad.thumbnail = vpMatch[1].replace(/\\\//g, '/');
    if (!ad.thumbnail) {
      const riMatch = chunk.match(/"resized_image_url"\s*:\s*"([^"]+)"/);
      if (riMatch) ad.thumbnail = riMatch[1].replace(/\\\//g, '/');
    }
    if (!ad.thumbnail) {
      const oiMatch = chunk.match(/"original_image_url"\s*:\s*"([^"]+)"/);
      if (oiMatch) ad.thumbnail = oiMatch[1].replace(/\\\//g, '/');
    }

    const ppMatch = chunk.match(/"publisher_platform"\s*:\s*\[([^\]]*)\]/);
    if (ppMatch) { try { ad.platforms = JSON.parse('[' + ppMatch[1] + ']'); } catch { ad.platforms = []; } }

    const sdMatch = chunk.match(/"start_date"\s*:\s*(\d+)/);
    if (sdMatch) ad.startDate = new Date(Number(sdMatch[1]) * 1000).toISOString().slice(0, 10);

    const iaMatch = chunk.match(/"is_active"\s*:\s*(true|false)/);
    ad.isActive = iaMatch ? iaMatch[1] === 'true' : null;

    // Collation count = "X anúncios usam esse criativo" (ad sets using this creative)
    const ccMatch = chunk.match(/"collation_count"\s*:\s*(\d+)/);
    ad.collationCount = ccMatch ? parseInt(ccMatch[1]) : 1;

    // Body text: "body":{"text":"..."}
    const bodyMatch = chunk.match(/"body"\s*:\s*\{\s*"text"\s*:\s*"([^"]*)"/);
    ad.bodyText = bodyMatch ? bodyMatch[1].replace(/\\n/g, '\n').replace(/\\u[\da-fA-F]{4}/g, m => String.fromCharCode(parseInt(m.slice(2), 16))) : '';

    // Title (link headline)
    const titleMatch = chunk.match(/"title"\s*:\s*"([^"]+)"/);
    ad.adTitle = titleMatch ? titleMatch[1].replace(/\\u[\da-fA-F]{4}/g, m => String.fromCharCode(parseInt(m.slice(2), 16))) : '';

    // CTA text
    const ctaMatch = chunk.match(/"cta_text"\s*:\s*"([^"]*)"/);
    ad.ctaText = ctaMatch ? ctaMatch[1].replace(/\\u[\da-fA-F]{4}/g, m => String.fromCharCode(parseInt(m.slice(2), 16))) : '';

    // Caption (website URL)
    const capMatch = chunk.match(/"caption"\s*:\s*"([^"]*)"/);
    ad.caption = capMatch ? capMatch[1] : '';

    // Legacy fields for compatibility
    ad.bodyTexts = ad.bodyText ? [ad.bodyText] : [];
    ad.linkTitles = ad.adTitle ? [ad.adTitle] : [];

    ad.mediaType = ad.videoUrl ? 'video' : (ad.thumbnail ? 'image' : 'unknown');
    ad.url = `https://www.facebook.com/ads/library/?id=${adId}`;

    ads.push(ad);
  }

  const countMatch = html.match(/"count"\s*:\s*(\d+)/);
  const totalAvailable = countMatch ? parseInt(countMatch[1]) : 0;
  const endCursorMatch = html.match(/"end_cursor"\s*:\s*"([^"]+)"/);
  const hasNextMatch = html.includes('"has_next_page":true');
  const queryIDMatch = html.match(/"queryID"\s*:\s*"(\d+)"/);

  return {
    ads,
    totalAvailable,
    endCursor: (endCursorMatch && hasNextMatch) ? endCursorMatch[1] : '',
    queryID: queryIDMatch ? queryIDMatch[1] : '',
  };
}

async function searchFacebookAds(params) {
  const q = params.get('q') || '';
  if (!q) throw new Error('Missing search query (q)');

  const country = params.get('country') || 'BR';
  const mediaType = params.get('media_type') || 'all';
  const activeStatus = params.get('active_status') || 'active';
  const minResults = parseInt(params.get('min_results') || '20');
  const dateFrom = params.get('date_from') || '';
  const dateTo = params.get('date_to') || '';
  const language = params.get('language') || '';
  const cursor = params.get('cursor') || '';

  const seen = new Set();
  let allAds = [];
  let totalAvailable = 0;
  const batchIdx = parseInt(params.get('batch') || '0');

  // Build search queries: keyword + suffix variations (6 per batch, 200+ total suffixes)
  const suffixes = [
    '', 'shop', 'store', 'buy', 'best', 'offer', 'sale', 'discount', 'free shipping',
    'new', 'review', 'online', 'brand', 'official', 'deals', 'premium', 'natural',
    'organic', 'products', 'kit', 'set', 'bundle', 'gift', 'for women', 'for men',
    'tips', 'routine', 'results', 'before after', 'testimonial', 'trending',
    'top rated', 'recommended', 'professional', 'exclusive', 'limited', 'promo',
    'trial', 'sample', 'subscription', 'wholesale', 'dropship',
    'comprar', 'barato', 'original', 'importado', 'frete gratis',
    'loja', 'site oficial', 'onde comprar', 'melhor', 'funciona',
    'amazon', 'shopify', 'mercado livre', 'aliexpress', 'shopee', 'etsy', 'ebay',
    'launch', 'order now', 'get yours', 'limited time', 'today only',
    'save now', 'try free', 'guarantee', 'fast delivery', 'worldwide',
    'shop now', 'buy now', 'order today', 'claim yours', 'last chance',
    'skin', 'beauty', 'health', 'wellness', 'fitness', 'supplement',
    'cream', 'serum', 'oil', 'treatment', 'solution', 'formula',
    'secret', 'hack', 'method', 'system', 'program', 'course',
    'luxury', 'affordable', 'cheap', 'budget', 'value',
    'viral', 'tiktok', 'instagram', 'influencer', 'celebrity',
    'summer', 'winter', 'holiday', 'christmas', 'black friday',
    'clearance', 'outlet', 'factory', 'direct', 'authentic',
    'handmade', 'custom', 'personalized', 'unique', 'limited edition',
    'amazing', 'incredible', 'game changer', 'must have', 'essential',
    'hurry', 'ending soon', 'selling fast', 'going viral',
    'women', 'men', 'kids', 'baby', 'mom', 'dad', 'family',
    'fashion', 'clothing', 'shoes', 'jewelry', 'accessories', 'home', 'kitchen',
    'tech', 'gadget', 'tool', 'pet', 'dog', 'cat', 'outdoor',
    'food', 'snack', 'drink', 'coffee', 'protein', 'vegan',
    'reviews', '5 stars', 'bestseller', 'most popular',
    'usa', 'uk', 'canada', 'australia', 'europe', 'worldwide shipping',
  ];

  const queries = [];
  const perBatch = 6;
  const startIdx = batchIdx * perBatch;

  for (let i = startIdx; i < Math.min(startIdx + perBatch, suffixes.length); i++) {
    const s = suffixes[i];
    queries.push(s ? `${q} ${s}` : q);
  }

  // After exhausting suffixes: alphabetical combos
  if (startIdx >= suffixes.length) {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const li = (batchIdx - Math.ceil(suffixes.length / perBatch)) * perBatch;
    for (let i = li; i < Math.min(li + perBatch, letters.length); i++) {
      queries.push(`${q} ${letters[i]}`);
    }
  }

  if (queries.length === 0) queries.push(q);

  // Fetch all queries in parallel
  const fetches = queries.map(query =>
    fetchPage(buildFbSearchUrl(query, country, mediaType, activeStatus, dateFrom, dateTo, language))
      .then(html => parseAdsFromHtml(html, seen))
      .catch(() => ({ ads: [], totalAvailable: 0 }))
  );

  const results = await Promise.all(fetches);
  for (const r of results) {
    allAds.push(...r.ads);
    if (r.totalAvailable > totalAvailable) totalAvailable = r.totalAvailable;
  }

  // ── Phase 3: Count ads per page ──
  const countByPage = {};
  for (const ad of allAds) {
    const key = ad.pageName || ad.adId;
    countByPage[key] = (countByPage[key] || 0) + 1;
  }
  for (const ad of allAds) {
    ad._pageAdCount = countByPage[ad.pageName || ad.adId] || 1;
  }

  // Return unique page_ids for pagination mode
  const pageIds = [...new Set(allAds.map(a => a.pageId).filter(Boolean))];

  return {
    ads: allAds,
    total: allAds.length,
    totalFetched: allAds.length,
    totalAvailable,
    query: q,
    country,
    mediaType,
    activeStatus,
    hasMore: allAds.length > 0,
    batchIdx,
    pageIds,
  };
}

// ── Paginate by page_id — pure pagination without keyword variations ──

async function paginateFacebookAds(params) {
  const pageIdsParam = params.get('page_ids') || '';
  const country = params.get('country') || 'ALL';
  const mediaType = params.get('media_type') || 'all';
  const activeStatus = params.get('active_status') || 'active';

  if (!pageIdsParam) throw new Error('Missing page_ids');

  const pageIds = pageIdsParam.split(',').filter(Boolean);
  const seen = new Set();
  let allAds = [];

  // Fetch all page_ids in parallel (max 6 per call to stay within Worker limits)
  const fetches = pageIds.slice(0, 6).map(pid => {
    const url = `https://www.facebook.com/ads/library/?active_status=${activeStatus}&ad_type=all&country=${country}&view_all_page_id=${pid}&media_type=${mediaType === 'all' ? 'all' : mediaType}`;
    return fetchPage(url)
      .then(html => parseAdsFromHtml(html, seen))
      .catch(() => ({ ads: [] }));
  });

  const results = await Promise.all(fetches);
  for (const r of results) allAds.push(...r.ads);

  // Count per page
  const countByPage = {};
  for (const ad of allAds) { countByPage[ad.pageName || ad.adId] = (countByPage[ad.pageName || ad.adId] || 0) + 1; }
  for (const ad of allAds) { ad._pageAdCount = countByPage[ad.pageName || ad.adId] || 1; }

  return { ads: allAds, total: allAds.length };
}

// ── Scroll pagination with Facebook cookies ──

async function scrollFacebookAds(params) {
  const q = params.get('q') || '';
  if (!q) throw new Error('Missing q');

  const country = params.get('country') || 'ALL';
  const mediaType = params.get('media_type') || 'all';
  const activeStatus = params.get('active_status') || 'active';
  const language = params.get('language') || '';
  const fbCookie = params.get('cookie') || '';
  const cursor = params.get('cursor') || '';

  if (!fbCookie) throw new Error('Cookie do Facebook necessário para paginação scroll');

  const QUERY_ID = '25788260324159216';
  const seen = new Set();
  let allAds = [];
  let nextCursor = cursor || null;
  let totalAvailable = 0;

  // Paginate through GraphQL with cookies — up to 5 pages per Worker call
  const maxPages = 5;

  for (let page = 0; page < maxPages; page++) {
    try {
      const variables = JSON.stringify({
        activeStatus: activeStatus,
        adType: 'ALL',
        bylines: [],
        collationToken: null,
        contentLanguages: language ? [language] : [],
        countries: [country],
        cursor: nextCursor,
        excludedIDs: [],
        first: 30,
        mediaType: mediaType === 'all' ? 'ALL' : mediaType === 'video' ? 'VIDEO' : 'IMAGE',
        potentialReachInput: [],
        publisherPlatforms: [],
        queryString: q,
        searchType: 'KEYWORD_UNORDERED',
        sortData: null,
        source: null,
        startDate: null,
      });

      const gqlResp = await fetch('https://www.facebook.com/api/graphql/', {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': fbCookie,
        },
        body: new URLSearchParams({ doc_id: QUERY_ID, variables }).toString(),
      });

      const gqlText = await gqlResp.text();
      const result = parseAdsFromHtml(gqlText, seen);
      allAds.push(...result.ads);

      if (result.totalAvailable > totalAvailable) totalAvailable = result.totalAvailable;

      const cursorMatch = gqlText.match(/"end_cursor"\s*:\s*"([^"]+)"/);
      const hasNext = gqlText.includes('"has_next_page":true');
      nextCursor = (cursorMatch && hasNext) ? cursorMatch[1] : null;

      if (!nextCursor || result.ads.length === 0) break;
    } catch (e) {
      break;
    }
  }

  // Count per page
  const countByPage = {};
  for (const ad of allAds) { countByPage[ad.pageName || ad.adId] = (countByPage[ad.pageName || ad.adId] || 0) + 1; }
  for (const ad of allAds) { ad._pageAdCount = countByPage[ad.pageName || ad.adId] || 1; }

  return {
    ads: allAds,
    total: allAds.length,
    totalAvailable,
    nextCursor: nextCursor || '',
    hasMore: !!nextCursor,
  };
}
