const axios = require("axios");
const cheerio = require("cheerio");

function sanitizeDomainInput(raw) {
  if (!raw) return null;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      return u.host.toLowerCase();
    }
    return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  } catch (e) {
    return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeDomain(d) {
  if (!d) return "";
  return d.toString().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

async function fetchHtml(url) {
  const r = await axios.get(url, {
    headers: { "User-Agent": "ResearchAgent/0.1", "Accept-Language": "en-US,en;q=0.9" },
    timeout: 20000,
    maxRedirects: 6,
    validateStatus: s => s >= 200 && s < 400,
  });
  return r.data;
}

function extractTextFromHtml(html) {
  const $ = cheerio.load(html || "");
  const title = $("title").first().text() || null;
  const metaDesc = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || null;
  const ptexts = [];
  $("p").each((i, el) => {
    const txt = $(el).text().trim();
    if (txt && txt.length > 20) ptexts.push(txt);
  });
  const website_text = [title, metaDesc, ...ptexts.slice(0, 12)].filter(Boolean).join("\n\n");
  return { title, metaDesc, website_text };
}

function safeTruncate(s, n = 300) {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).trim() + "..." : t;
}

module.exports = {
  sanitizeDomainInput,
  normalizeDomain,
  fetchHtml,
  extractTextFromHtml,
  safeTruncate,
};