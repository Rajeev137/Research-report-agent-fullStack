const axios = require("axios");
const cheerio = require("cheerio");
const { NEWSAPI_KEY } = require("../config/env");

async function fetchNewsViaNewsApi(companyName, pageSize = 12) {
  if (!NEWSAPI_KEY) return [];
  const q = encodeURIComponent(companyName);
  const url = `https://newsapi.org/v2/everything?q=${q}&pageSize=${pageSize}&sortBy=publishedAt&apiKey=${NEWSAPI_KEY}`;
  try {
    const r = await axios.get(url, { timeout: 12000 });
    return r.data && r.data.articles ? r.data.articles.map((a, i) => ({
      id: (i + 1).toString(),
      title: a.title,
      description: a.description,
      url: a.url,
      source: a.source?.name || a.source,
      publishedAt: a.publishedAt,
    })) : [];
  } catch (e) {
    console.warn("NewsAPI fetch failed:", e.message || e);
    return [];
  }
}

async function fetchNewsGoogleFallback(companyName) {
  try {
    const url = `https://news.google.com/search?q=${encodeURIComponent(companyName)}&hl=en-US&gl=US&ceid=US:en`;
    const html = await (await axios.get(url, {
      headers: { "User-Agent": "ResearchAgent/0.1" },
      timeout: 20000
    })).data;
    const $ = cheerio.load(html);
    const out = [];
    $("article").slice(0, 12).each((i, el) => {
      const title = $(el).find("h3").text().trim() || $(el).find("h4").text().trim();
      const linkRel = $(el).find("a").attr("href") || "";
      const link = linkRel.startsWith("./") ? "https://news.google.com" + linkRel.slice(1) : linkRel;
      const source = $(el).find(".SVJrMe").first().text().trim() || null;
      const time = $(el).find("time").attr("datetime") || null;
      if (title) out.push({ id: (i + 1).toString(), title, description: null, url: link, source, publishedAt: time });
    });
    return out;
  } catch (e) {
    console.warn("Google News fallback failed:", e.message || e);
    return [];
  }
}

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
  for (const kw of SALES_KEYWORDS) if (title.includes(kw) || desc.includes(kw)) score += 1.5;
  if (src.includes("reuters") || src.includes("bloomberg") || src.includes("fortune")) score += 1.2;

  if (article.publishedAt) {
    try {
      const days = (Date.now() - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days <= 7) score += 1.0;
      else if (days <= 30) score += 0.5;
    } catch {}
  }

  if (!article.description || article.description.trim().length < 40) score -= 0.7;
  const url = (article.url || "").toLowerCase();
  if (url.includes("/comments") || url.includes("opinion") || url.includes("/offers/")) score -= 10;

  return score;
}

function filterAndRankArticles(allArticles, companyName, topN = 3) {
  if (!Array.isArray(allArticles)) return [];
  const scored = allArticles.map(a => ({ a, score: scoreArticleForSales(a, companyName) }));
  scored.sort((x, y) => y.score - x.score);
  return scored.filter(s => s.score > -5).slice(0, topN).map(s => ({ ...s.a, relevanceScore: s.score }));
}

module.exports = {
  fetchNewsViaNewsApi,
  fetchNewsGoogleFallback,
  filterAndRankArticles,
};