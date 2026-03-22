function extractProductIdFromUrl(parsed) {
    const pathMatch = String(parsed.pathname || '').match(/\/item\/(\d+)\.html/i);
    if (pathMatch?.[1])
        return pathMatch[1];
    const keys = ['x_object_id', '_p_origin_prod', 'itemId', 'item_id', 'productId', 'product_id'];
    for (const key of keys) {
        const raw = String(parsed.searchParams.get(key) || '').trim();
        const match = raw.match(/(\d{8,})/);
        if (match?.[1])
            return match[1];
    }
    const query = (() => {
        try {
            return decodeURIComponent(String(parsed.search || ''));
        }
        catch {
            return String(parsed.search || '');
        }
    })();
    const tokenMatch = query.match(/(\d{10,})/);
    return tokenMatch?.[1] || '';
}
function normalizeCurrency(value) {
    const curr = String(value || '').trim().toUpperCase();
    if (['USD', 'BRL', 'EUR', 'GBP'].includes(curr))
        return curr;
    if (/^[A-Z]{3}$/.test(curr))
        return curr;
    return 'USD';
}
function parseLooseNumber(value) {
    const raw = String(value || '').trim();
    if (!raw)
        return 0;
    const cleaned = raw.replace(/[^0-9,.-]/g, '');
    if (!cleaned)
        return 0;
    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');
    if (hasComma && hasDot) {
        const lastComma = cleaned.lastIndexOf(',');
        const lastDot = cleaned.lastIndexOf('.');
        if (lastComma > lastDot) {
            const n = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
            return Number.isFinite(n) ? n : 0;
        }
        const n = parseFloat(cleaned.replace(/,/g, ''));
        return Number.isFinite(n) ? n : 0;
    }
    if (hasComma) {
        const n = parseFloat(cleaned.replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
    }
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
}
function decodeEntity(text) {
    return String(text || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
}
function stripTags(text) {
    return decodeEntity(String(text || '').replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}
export function normalizeAliExpressUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return null;
    }
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (!hostname.includes('aliexpress.com'))
        return null;
    const productId = extractProductIdFromUrl(parsed);
    if (!productId)
        return null;
    parsed.pathname = `/item/${productId}.html`;
    parsed.hash = '';
    return parsed;
}
function extractFromPdpNpi(url) {
    const pdpNpi = url.searchParams.get('pdp_npi') || '';
    if (!pdpNpi)
        return null;
    const decoded = (() => {
        try {
            return decodeURIComponent(pdpNpi);
        }
        catch {
            return pdpNpi;
        }
    })();
    const parts = decoded.split('!').map(part => part.trim()).filter(Boolean);
    const currencyIdx = parts.findIndex(part => /^[A-Z]{3}$/.test(part));
    if (currencyIdx < 0)
        return null;
    const currency = normalizeCurrency(parts[currencyIdx]);
    const first = parseLooseNumber(parts[currencyIdx + 1] || '');
    const second = parseLooseNumber(parts[currencyIdx + 2] || '');
    const value = second > 0 ? second : first;
    if (!(value > 0))
        return null;
    return {
        value: parseFloat(value.toFixed(2)),
        currency
    };
}
function extractMetaContent(html, name) {
    const regex = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
    const match = html.match(regex);
    return stripTags(match?.[1] || '');
}
function extractPriceFromHtml(html) {
    const usdMatch = html.match(/(?:US\$|\$)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i);
    if (usdMatch) {
        const value = parseLooseNumber(usdMatch[1]);
        if (value > 0) {
            return { value: parseFloat(value.toFixed(2)), currency: 'USD' };
        }
    }
    const brlMatch = html.match(/R\$\s*([0-9]+(?:[.,][0-9]{1,2})?)/i);
    if (brlMatch) {
        const value = parseLooseNumber(brlMatch[1]);
        if (value > 0) {
            return { value: parseFloat(value.toFixed(2)), currency: 'BRL' };
        }
    }
    const genericMatch = html.match(/\b(USD|BRL|EUR|GBP)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i);
    if (genericMatch) {
        const value = parseLooseNumber(genericMatch[2]);
        if (value > 0) {
            return { value: parseFloat(value.toFixed(2)), currency: normalizeCurrency(genericMatch[1]) };
        }
    }
    return null;
}
function extractFunctionsFromHtml(html) {
    const allMatches = [...html.matchAll(/<li[^>]*>([\s\S]{1,200}?)<\/li>/gi)];
    const lines = [];
    for (const item of allMatches) {
        const text = stripTags(item[1] || '');
        if (!text)
            continue;
        if (text.length < 6 || text.length > 120)
            continue;
        if (/https?:\/\//i.test(text))
            continue;
        if (/^(home|help|shopping|feedback|privacy|terms|copyright)/i.test(text))
            continue;
        lines.push(text);
        if (lines.length >= 12)
            break;
    }
    return [...new Set(lines)].slice(0, 8);
}
function deriveFunctionsFromTitle(title) {
    const cleaned = stripTags(title)
        .replace(/\s*-\s*AliExpress.*$/i, '')
        .trim();
    if (!cleaned)
        return [];
    const chunks = cleaned
        .split(/,|\/|;|\s+-\s+/)
        .map(part => part.trim())
        .filter(part => part.length >= 4 && part.length <= 80);
    if (chunks.length >= 2) {
        return [...new Set(chunks)].slice(0, 6);
    }
    return [cleaned];
}
async function fetchHtml(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
        const res = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });
        if (!res.ok)
            return '';
        return await res.text();
    }
    catch {
        return '';
    }
    finally {
        clearTimeout(timer);
    }
}
export async function extractAliExpressData(url) {
    const parsed = normalizeAliExpressUrl(url);
    if (!parsed) {
        throw new Error('URL não suportada. Use o link do produto AliExpress (formato /item/123...html).');
    }
    const productId = extractProductIdFromUrl(parsed);
    const result = {
        canonicalUrl: parsed.toString(),
        productId,
        title: '',
        cost: null,
        functions: [],
        sources: [],
        warnings: []
    };
    const pdpCost = extractFromPdpNpi(parsed);
    if (pdpCost) {
        result.cost = pdpCost;
        result.sources.push('url_param_pdp_npi');
    }
    const html = await fetchHtml(parsed.toString());
    if (!html) {
        result.warnings.push('Não foi possível carregar a página para enriquecimento.');
        return result;
    }
    if (/captcha|unusual traffic|slide to verify/i.test(html)) {
        result.warnings.push('AliExpress exigiu verificação anti-bot; retorno parcial aplicado.');
    }
    const ogTitle = extractMetaContent(html, 'og:title');
    const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleTag = stripTags(titleTagMatch?.[1] || '');
    result.title = ogTitle || titleTag || '';
    if (result.title) {
        result.sources.push(ogTitle ? 'html_meta_og_title' : 'html_title_tag');
    }
    if (!result.cost) {
        const htmlCost = extractPriceFromHtml(html);
        if (htmlCost) {
            result.cost = htmlCost;
            result.sources.push('html_price_pattern');
        }
    }
    const htmlFunctions = extractFunctionsFromHtml(html);
    if (htmlFunctions.length >= 3) {
        result.functions = htmlFunctions;
        result.sources.push('html_list_items');
    }
    else {
        const titleFunctions = deriveFunctionsFromTitle(result.title);
        if (titleFunctions.length > 0) {
            result.functions = titleFunctions;
            result.sources.push('title_derived');
        }
    }
    return result;
}
