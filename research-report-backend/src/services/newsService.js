// newsService.js
// English-first news fetcher + scorer for sales relevance.
// - NewsAPI: adds &language=${NEWS_LANGUAGE}
// - Google News: en-US feed + post-filter
// - Post-filter everything to English via franc-min (if present) or a heuristic
// - Then rank using your SALES_KEYWORDS logic

const axios = require("axios");
const cheerio = require("cheerio");
const { NEWSAPI_KEY, NEWS_LANGUAGE } = require("../config/env");

// ---- Optional language detector (recommended, but we fall back if not installed)
let franc = null;
try {
  franc = require("franc-min");
} catch (e) {
  console.warn("[newsService] franc-min not installed; using heuristic language filter.");
}

/** Prefer ISO 639-3 'eng' for english when using franc-min */
const FRANC_ENG = (NEWS_LANGUAGE || "en").toLowerCase() === "en" ? "eng" : null;

/** Simple robust heuristic for English if franc-min isn't available */
function heuristicIsEnglish(s = "") {
  if (!s) return false;
  const sample = s.slice(0, 800); // cap to reduce noise
  // 1) ASCII ratio
  const ascii = sample.split("").filter(ch => ch.charCodeAt(0) <= 127).length;
  const ratio = ascii / Math.max(1, sample.length);
  if (ratio < 0.9) return false;

  // 2) Common English function words
  const lw = ` ${sample.toLowerCase()} `;
  const hits = [" the ", " and ", " for ", " with ", " from ", " to ", " in ", " on ", " of ", " says "]
    .reduce((acc, w) => acc + (lw.includes(w) ? 1 : 0), 0);
  return hits >= 2;
}

/** Decide if text is English */
function isEnglish(text) {
  const t = text || "";
  if (t.length < 20) return false; // too short to judge
  if (franc && FRANC_ENG) {
    try {
      const lang = franc(t, { minLength: 20 });
      return lang === FRANC_ENG;
    } catch {
      // fall through to heuristic
    }
  }
  return heuristicIsEnglish(t);
}

/** Apply English filter to article list using title+description blob */
function filterEnglish(articles) {
  const out = [];
  for (const a of (articles || [])) {
    const blob = [a.title, a.description].filter(Boolean).join(" ");
    if (isEnglish(blob)) out.push(a);
  }
  return out;
}

// ----------------- FETCHERS -----------------

async function fetchNewsViaNewsApi(companyName, pageSize = 12) {
  if (!NEWSAPI_KEY) return [];
  const q = encodeURIComponent(companyName);
  const lang = (NEWS_LANGUAGE || "en").toLowerCase();
  const url =
    `https://newsapi.org/v2/everything?q=${q}` +
    `&language=${lang}` +                     // << enforce language at the API level
    `&pageSize=${pageSize}&sortBy=publishedAt&apiKey=${NEWSAPI_KEY}`;

  try {
    const r = await axios.get(url, { timeout: 12000 });
    const items = (r.data && r.data.articles) ? r.data.articles : [];
    const normalized = items.map((a, i) => ({
      id: (i + 1).toString(),
      title: a.title,
      description: a.description,
      url: a.url,
      source: a.source?.name || a.source || null,
      publishedAt: a.publishedAt,
    }));
    const en = filterEnglish(normalized);
    if (normalized.length !== en.length) {
      console.log(`[newsService] NewsAPI filtered non-en: ${normalized.length} -> ${en.length}`);
    }
    return en;
  } catch (e) {
    console.warn("NewsAPI fetch failed:", e.message || e);
    return [];
  }
}

async function fetchNewsGoogleFallback(companyName) {
  try {
    const url =
      `https://news.google.com/search?q=${encodeURIComponent(companyName)}` +
      `&hl=en-US&gl=US&ceid=US:en`; // en-US feed
    const html = await (await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 ResearchAgent/0.1",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 20000
    })).data;

    const $ = cheerio.load(html);
    const raw = [];
    $("article").slice(0, 24).each((i, el) => {
      const title = $(el).find("h3").text().trim() || $(el).find("h4").text().trim();
      const linkRel = $(el).find("a").attr("href") || "";
      const link = linkRel.startsWith("./") ? "https://news.google.com" + linkRel.slice(1) : linkRel;
      const source = $(el).find(".SVJrMe").first().text().trim() || null;
      const time = $(el).find("time").attr("datetime") || null;
      if (title) {
        raw.push({
          id: (i + 1).toString(),
          title,
          description: null,
          url: link,
          source,
          publishedAt: time
        });
      }
    });

    // Post-filter to English as an extra guard
    const en = filterEnglish(raw);
    if (raw.length !== en.length) {
      console.log(`[newsService] GoogleNews filtered non-en: ${raw.length} -> ${en.length}`);
    }
    return en.slice(0, 12);
  } catch (e) {
    console.warn("Google News fallback failed:", e.message || e);
    return [];
  }
}

// ----------------- SCORING / RANKING -----------------

const SALES_KEYWORDS = [
  "partnership","acquisition","earnings","revenue","profit","loss","deal","contract",
  "launch","product","supplier","supply","merger","funding","invest","appoint",
  "lawsuit","settlement","order","purchase"
];

function scoreArticleForSales(article, companyName) {
  let score = 0;
  const title = (article.title || "").toLowerCase();
  const desc  = (article.description || "").toLowerCase();
  const src   = (article.source || "").toLowerCase();

  if (title.includes(companyName.toLowerCase())) score += 3;
  if (desc.includes(companyName.toLowerCase()))  score += 2;

  for (const kw of SALES_KEYWORDS) {
    if (title.includes(kw) || desc.includes(kw)) score += 1.5;
  }

  if (src.includes("reuters") || src.includes("bloomberg") || src.includes("fortune")) score += 1.2;

  if (article.publishedAt) {
    try {
      const days = (Date.now() - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days <= 7) score += 1.0;
      else if (days <= 30) score += 0.5;
    } catch {}
  }

  // weak content penalty
  if (!article.description || article.description.trim().length < 40) score -= 0.7;

  // junk filter
  const url = (article.url || "").toLowerCase();
  if (url.includes("/comments") || url.includes("opinion") || url.includes("/offers/")) score -= 10;

  return score;
}

/**
 * NOTE: Make sure you pass ONLY English articles here.
 * If you call this directly from elsewhere, filter first:
 *   const enOnly = filterEnglish(allArticles);
 *   const top = filterAndRankArticles(enOnly, companyName, 3);
 */
function filterAndRankArticles(allArticles, companyName, topN = 3) {
  if (!Array.isArray(allArticles)) return [];

  // Safety: ensure EN only if caller forgot
  const enOnly = filterEnglish(allArticles);

  const scored = enOnly.map(a => ({ a, score: scoreArticleForSales(a, companyName) }));
  scored.sort((x, y) => y.score - x.score);
  return scored
    .filter(s => s.score > -5)
    .slice(0, topN)
    .map(s => ({ ...s.a, relevanceScore: s.score }));
}

module.exports = {
  fetchNewsViaNewsApi,
  fetchNewsGoogleFallback,
  filterAndRankArticles,
};