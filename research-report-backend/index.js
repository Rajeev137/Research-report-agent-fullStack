// index.js - Research Agent backend (final merged + robust LLM extraction & retry)
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4000;
const SERVICE_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json";
const NEWSAPI_KEY = process.env.NEWSAPI_KEY || "";
const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT || null;
const AZURE_KEY = process.env.AZURE_KEY || process.env.OPENAI_KEY || null;
const AZURE_DEPLOYMENT_NAME =
  process.env.AZURE_DEPLOYMENT_NAME ||
  process.env.DEPLOYMENT_NAME ||
  "gpt-5-mini";
const AZURE_API_VERSION = process.env.AZURE_API_VERSION || "2025-04-01-preview";

// Tuneables (add/update)
const SALES_TOP_K = parseInt(process.env.SALES_TOP_K || "3", 10);
const SALES_MAX_TOKENS = parseInt(process.env.SALES_MAX_TOKENS || "256", 10); // legacy usage in code
const SALES_MAX_COMPLETION_TOKENS = parseInt(
  process.env.SALES_MAX_COMPLETION_TOKENS || "1024",
  10
); // NEW: completion budget for GPT-5 reasoning models
const SALES_RETRY_MAX_TOKENS = parseInt(
  process.env.SALES_RETRY_MAX_TOKENS || "200",
  10
);

if (!fs.existsSync(SERVICE_PATH)) {
  console.error("FIREBASE SERVICE ACCOUNT JSON NOT FOUND at", SERVICE_PATH);
  process.exit(1);
}
const serviceAccount = require(path.resolve(SERVICE_PATH));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

/* ===================== HELPERS & UTILITIES ===================== */

// Domain helpers
function sanitizeDomainInput(raw) {
  if (!raw) return null;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      return u.host;
    }
    return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  } catch (e) {
    return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
}
function normalizeDomain(d) {
  if (!d) return "";
  return d
    .toString()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}
function guessDomain(companyName) {
  if (!companyName) return null;
  const candidate = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${candidate}.com`;
}
function domainMatchesCompany(domain, companyName) {
  if (!domain || !companyName) return false;
  const d = normalizeDomain(domain);
  const cname = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return d.includes(cname) || cname.includes(d.split(".")[0] || "");
}

// HTTP fetch helpers
async function fetchHtml(url) {
  const opts = {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ResearchAgent/0.1",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    maxRedirects: 8,
    timeout: 20000,
    validateStatus: (s) => s >= 200 && s < 400,
  };
  const r = await axios.get(url, opts);
  return r.data;
}
function extractTextFromHtml(html) {
  const $ = cheerio.load(html || "");
  const title = $("title").first().text() || null;
  const metaDesc =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    null;
  const ptexts = [];
  $("p").each((i, el) => {
    const txt = $(el).text().trim();
    if (txt && txt.length > 20) ptexts.push(txt);
  });
  return {
    title,
    metaDesc,
    website_text: [title, metaDesc, ...ptexts.slice(0, 12)]
      .filter(Boolean)
      .join("\n\n"),
  };
}
async function tryCommonPaths(host) {
  const base = host.replace(/^www\./, "");
  const candidates = [
    `https://${host}`,
    `https://www.${base}`,
    `http://${host}`,
    `http://www.${base}`,
    `https://${host}/about`,
    `https://${host}/about/`,
    `https://${host}/company`,
    `https://${host}/about-us`,
  ];
  for (const u of candidates) {
    try {
      const html = await fetchHtml(u);
      if (html && html.length > 200) return { url: u, html };
    } catch (e) {
      // try next
    }
  }
  return { url: null, html: null };
}

// Wikipedia resolver & scoring
async function wikiSearchTitles(query, limit = 5) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&srlimit=${limit}&format=json`;
    const r = await axios.get(url, { timeout: 8000 });
    if (r.data && r.data.query && r.data.query.search)
      return r.data.query.search.map((s) => s.title);
  } catch (e) {}
  return [];
}
async function fetchWikiSummaryByTitle(title) {
  try {
    const slug = encodeURIComponent(title.replace(/\s+/g, "_"));
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;
    const r = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "ResearchAgent/0.1" },
    });
    if (r.data)
      return {
        title: r.data.title,
        description: r.data.description || "",
        extract: r.data.extract || "",
        pageUrl:
          r.data.content_urls?.desktop?.page ||
          `https://en.wikipedia.org/wiki/${slug}`,
      };
  } catch (e) {}
  return null;
}
async function extractWebsiteFromWikiPage(pageUrl) {
  try {
    const html = (await axios.get(pageUrl, { timeout: 8000 })).data;
    const $ = cheerio.load(html);
    const websiteEl = $(".infobox a.external.text").first();
    if (websiteEl && websiteEl.attr && websiteEl.attr("href"))
      return normalizeDomain(websiteEl.attr("href"));
  } catch (e) {}
  return null;
}
function scoreWikiCandidate(candidate, companyName, rawDomain) {
  let score = 0;
  const desc = (candidate.description || "").toLowerCase();
  const extract = (candidate.extract || "").toLowerCase();
  const cname = companyName.toLowerCase();
  const COMPANY_KEYWORDS = [
    "company",
    "inc",
    "ltd",
    "corporation",
    "group",
    "plc",
    "co.",
    "enterprise",
    "technology",
    "software",
    "bank",
    "airlines",
    "automotive",
    "film",
    "studio",
    "retailer",
    "clinic",
    "pharma",
    "hospital",
    "manufacturing",
    "manufacturer",
    "limited",
    "llc",
    "gmbh",
  ];
  const NONCOMPANY_KEYWORDS = [
    "fruit",
    "tree",
    "apple variety",
    "song",
    "person",
    "village",
    "river",
    "dish",
    "recipe",
    "nutrient",
    "food",
    "plant",
    "garden",
  ];
  for (const k of COMPANY_KEYWORDS)
    if (desc.includes(k) || extract.includes(k)) {
      score += 0.6;
      break;
    }
  if (
    (candidate.title || "").toLowerCase().includes(cname) ||
    desc.includes(cname) ||
    extract.includes(cname)
  )
    score += 0.25;
  if (candidate.pageUrl) score += 0.05;
  for (const k of NONCOMPANY_KEYWORDS)
    if (desc.includes(k) || extract.includes(k)) {
      score -= 0.8;
      break;
    }
  if (rawDomain && candidate.domainCandidate)
    if (
      normalizeDomain(candidate.domainCandidate) === normalizeDomain(rawDomain)
    )
      score += 0.2;
  if (score > 1) score = 1;
  if (score < -1) score = -1;
  return score;
}
async function resolveCandidates(companyName, rawDomain = null) {
  const titles = await wikiSearchTitles(companyName, 6);
  const candidates = [];
  for (const t of titles) {
    const summary = await fetchWikiSummaryByTitle(t);
    if (!summary) continue;
    let domainCandidate = null;
    try {
      domainCandidate = await extractWebsiteFromWikiPage(summary.pageUrl);
    } catch (e) {}
    const cand = {
      title: summary.title,
      description: summary.description,
      extract: summary.extract,
      pageUrl: summary.pageUrl,
      domainCandidate: domainCandidate || null,
      source: "wikipedia",
    };
    cand.score = scoreWikiCandidate(cand, companyName, rawDomain);
    candidates.push(cand);
  }
  if (candidates.length === 0) {
    const guessed = {
      title: companyName,
      description: null,
      extract: null,
      pageUrl: null,
      domainCandidate: guessDomain(companyName),
      score: 0.2,
      source: "guess",
    };
    return { best: guessed, candidates: [guessed] };
  }
  candidates.sort((a, b) => b.score - a.score);
  return { best: candidates[0], candidates };
}

// News fetching & scoring
const SALES_KEYWORDS = [
  "partnership",
  "partnership announcement",
  "acquisition",
  "earnings",
  "revenue",
  "profit",
  "loss",
  "ceo",
  "cfo",
  "executive",
  "appoint",
  "resign",
  "merger",
  "lawsuit",
  "contract",
  "deal",
  "investment",
  "funding",
  "launch",
  "product",
  "supplier",
  "supply",
  "contract win",
  "joint venture",
  "purchase order",
];
const BAD_PATH_MARKERS = [
  "comment",
  "/comments",
  "opinion",
  "blog",
  "deals",
  "offers",
  "coupon",
  "discount",
  "promo",
  "affiliate",
];
const PRIORITY_SOURCES = [
  "reuters",
  "bloomberg",
  "fortune",
  "businessinsider",
  "cnbc",
  "forbes",
  "wsj",
  "ft.com",
  "financial times",
  "theverge",
];

function buildTargetedNewsApiUrl(companyName, pageSize = 12) {
  const q = `${companyName} AND (${SALES_KEYWORDS.join(" OR ")})`;
  return `https://newsapi.org/v2/everything?q=${encodeURIComponent(
    q
  )}&pageSize=${pageSize}&sortBy=publishedAt&apiKey=${NEWSAPI_KEY}`;
}
function scoreArticle(article, companyName) {
  let score = 0;
  const title = (article.title || "").toLowerCase();
  const desc = (article.description || "").toLowerCase();
  const source =
    article.source && article.source.name
      ? (article.source.name || "").toLowerCase()
      : (article.source || "").toLowerCase();
  if (title.includes(companyName.toLowerCase())) score += 3;
  if (desc.includes(companyName.toLowerCase())) score += 2;
  for (const s of PRIORITY_SOURCES)
    if (source.includes(s)) {
      score += 2;
      break;
    }
  let kwMatches = 0;
  for (const kw of SALES_KEYWORDS)
    if (title.includes(kw) || desc.includes(kw)) kwMatches++;
  score += Math.min(kwMatches, 3);
  if (article.publishedAt) {
    try {
      const ageDays =
        (Date.now() - new Date(article.publishedAt).getTime()) /
        (1000 * 60 * 60 * 24);
      if (ageDays <= 7) score += 2;
      else if (ageDays <= 30) score += 1;
    } catch (e) {}
  }
  const url = (article.url || "").toLowerCase();
  for (const bad of BAD_PATH_MARKERS) if (url.includes(bad)) score -= 10;
  if (!article.description || article.description.trim().length < 40)
    score -= 1;
  return score;
}
function filterAndScoreNews(articles, companyName, topN = 5) {
  if (!Array.isArray(articles)) return [];
  const scored = articles.map((a) => ({
    a,
    score: scoreArticle(a, companyName),
  }));
  const filtered = scored
    .filter((s) => s.score > -5)
    .sort((x, y) => y.score - x.score)
    .slice(0, topN)
    .map((s) => ({ ...s.a, relevanceScore: s.score }));
  return filtered;
}

// Firestore token log
async function logTokenUsage({
  source = "unknown",
  model = "unknown",
  usage = {},
}) {
  try {
    if (!db) {
      console.error("logTokenUsage: no db available");
      return;
    }
    const docRef = await db.collection("token_logs").add({
      source,
      model,
      usage,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("logTokenUsage: saved token log id=", docRef.id);
  } catch (e) {
    // Become loud about it so you can debug
    console.error("logTokenUsage FAILED:", e.code || e.message || e);
    throw e; // rethrow so caller sees error (optional — safe for debugging)
  }
}

// Cache check (domain-preferential)
async function checkRecentReport(
  companyName,
  domain = null,
  maxAgeHours = 7 * 24
) {
  if (!db) return null;
  try {
    const q = await db
      .collection("reports")
      .where("companyName", "==", companyName)
      .orderBy("createdAt", "desc")
      .limit(8)
      .get();
    if (q.empty) return null;
    const now = Date.now();
    if (domain) {
      for (const doc of q.docs) {
        const data = doc.data();
        const createdAtMs =
          data.createdAt && data.createdAt.toDate
            ? data.createdAt.toDate().getTime()
            : null;
        const ageHours = createdAtMs
          ? (now - createdAtMs) / (1000 * 60 * 60)
          : Number.POSITIVE_INFINITY;
        if (createdAtMs && ageHours > maxAgeHours) continue;
        if (normalizeDomain(data.domainUsed || "") === normalizeDomain(domain))
          return { id: doc.id, data };
      }
    }
    for (const doc of q.docs) {
      const data = doc.data();
      const createdAtMs =
        data.createdAt && data.createdAt.toDate
          ? data.createdAt.toDate().getTime()
          : null;
      const ageHours = createdAtMs
        ? (now - createdAtMs) / (1000 * 60 * 60)
        : Number.POSITIVE_INFINITY;
      if (createdAtMs && ageHours > maxAgeHours) continue;
      return { id: doc.id, data };
    }
  } catch (e) {
    console.warn("checkRecentReport error:", e.message);
  }
  return null;
}

/* ===================== LLM HELPERS: CALL, EXTRACT, PING, PARSE ===================== */

// callAzureChat - uses temperature 1 for gpt-5-mini on Azure
// callAzureChat - use max_completion_tokens + reasoning_effort for GPT-5 reasoning models
async function callAzureChat(
  deploymentName,
  messages,
  max_completion_tokens = SALES_MAX_COMPLETION_TOKENS
) {
  if (!AZURE_ENDPOINT || !AZURE_KEY)
    throw new Error(
      "Azure OpenAI credentials not configured (AZURE_ENDPOINT/AZURE_KEY)"
    );
  // Chat Completions endpoint for Azure
  const url = `${AZURE_ENDPOINT.replace(
    /\/$/,
    ""
  )}/openai/deployments/${deploymentName}/chat/completions?api-version=${AZURE_API_VERSION}`;

  // Use max_completion_tokens (reasoning models) and request minimal reasoning effort
  const body = {
    messages,
    max_completion_tokens: max_completion_tokens, // allow the model a larger visible-token budget
    reasoning_effort: "minimal", // reduce internal reasoning token spend
    // intentionally omit temperature (reasoning models may not support it)
  };

  try {
    const resp = await axios.post(url, body, {
      headers: { "Content-Type": "application/json", "api-key": AZURE_KEY },
      timeout: 45000,
    });
    return resp.data;
  } catch (e) {
    console.error("Azure chat call failed. URL:", url);
    if (e.response) {
      try {
        const bodyStr = JSON.stringify(e.response.data);
        console.error("Status:", e.response.status);
        console.error(
          "Response body (truncated):",
          bodyStr.length > 4000
            ? bodyStr.slice(0, 4000) + "... [truncated]"
            : bodyStr
        );
      } catch (err) {
        console.error("Error serializing e.response.data:", err.message);
      }
    } else {
      console.error("Error:", e.message);
    }
    throw e;
  }
}

// extract content robustly from Azure response shapes
function extractAiContent(ai) {
  if (!ai || typeof ai !== "object") return null;
  try {
    if (Array.isArray(ai.choices) && ai.choices.length > 0) {
      const ch = ai.choices[0];
      if (
        ch.message &&
        typeof ch.message.content === "string" &&
        ch.message.content.trim()
      )
        return ch.message.content;
      if (typeof ch.text === "string" && ch.text.trim()) return ch.text;
      if (
        ch.delta &&
        typeof ch.delta.content === "string" &&
        ch.delta.content.trim()
      )
        return ch.delta.content;
    }
    if (ai.data && typeof ai.data === "string" && ai.data.trim())
      return ai.data;
    if (
      ai.choices &&
      ai.choices[0] &&
      ai.choices[0].message &&
      ai.choices[0].message.content
    )
      return ai.choices[0].message.content;
  } catch (e) {
    return null;
  }
  return null;
}

// simple ping to check deployment alive
async function pingAzure(deploymentName) {
  try {
    const sys = { role: "system", content: "You are a terse assistant." };
    const usr = { role: "user", content: 'Say "pong" if you are online.' };
    const r = await callAzureChat(deploymentName, [sys, usr], 20);
    const c = extractAiContent(r);
    return { ok: !!c, content: c, raw: r };
  } catch (e) {
    return { ok: false, error: e.response ? e.response.data : e.message };
  }
}

// try parse JSON robustly
function tryParseJsonFromModel(content) {
  if (!content || typeof content !== "string") return null;
  try {
    return JSON.parse(content);
  } catch (e) {}
  const match = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/m);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      return null;
    }
  }
  return null;
}

// safe truncate
function safeTruncate(s, n = 300) {
  if (!s) return "";
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length > n ? trimmed.slice(0, n).trim() + "..." : trimmed;
}

/* ===================== ROUTES ===================== */

app.get("/health", (req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

// Sales highlights standalone endpoint (safe truncation + retry)
app.post("/api/sales_highlights", async (req, res) => {
  try {
    const { companyName, articles } = req.body || {};
    if (!companyName)
      return res.status(400).json({ error: "companyName required" });
    if (!Array.isArray(articles) || articles.length === 0)
      return res.status(400).json({ error: "articles array required" });

    const useArticles = articles.slice(0, SALES_TOP_K);
    let articlesText = "";
    useArticles.forEach((a, i) => {
      const title = safeTruncate(a.title || "(no title)", 200);
      const src = (a.source && a.source.name) || a.source || "unknown";
      const date = a.publishedAt || "";
      const url = a.url || "";
      const desc = safeTruncate(a.description || "", 300);
      articlesText += `\n[${
        i + 1
      }] TITLE: ${title}\nSOURCE: ${src}\nDATE: ${date}\nURL: ${url}\nDESC: ${desc}\n---\n`;
    });

    const header = `You are a sales assistant. Convert the following news articles into a JSON list of sales highlights for ${companyName}. For each article return: title, url, one_line_summary (single sentence), sales_bullet (5-12 words), suggested_question (one specific question). Return ONLY valid JSON (no explanation).`;
    const systemMsg = {
      role: "system",
      content: "You are a concise sales briefing generator.",
    };
    const userMsg = { role: "user", content: header + "\n\n" + articlesText };

    // initial LLM call
    let aiData;
    try {
      aiData = await callAzureChat(
        AZURE_DEPLOYMENT_NAME,
        [systemMsg, userMsg],
        SALES_MAX_TOKENS
      );
    } catch (e) {
      console.warn(
        "LLM call failed (initial):",
        e.response ? e.response.data : e.message
      );
      return res.status(500).json({
        error: "llm_call_failed_initial",
        details: e.response ? e.response.data : e.message,
      });
    }

    console.log(
      "LLM initial response (truncated):",
      aiData
        ? JSON.stringify(aiData).slice(0, 2000) +
            (JSON.stringify(aiData).length > 2000 ? "...[truncated]" : "")
        : "NULL"
    );

    let content = extractAiContent(aiData) || "";
    let parsed = tryParseJsonFromModel(content);

    // repair if needed
    if (!parsed) {
      console.warn(
        "Model output not parseable or empty. Attempting repair prompt..."
      );
      const repairMsg = {
        role: "user",
        content:
          "Previous output was not valid JSON. NOW output only the JSON array/object matching the requested schema. Do not include any explanation.",
      };
      try {
        const aiRepair = await callAzureChat(
          AZURE_DEPLOYMENT_NAME,
          [systemMsg, repairMsg],
          SALES_RETRY_MAX_TOKENS
        );
        console.log(
          "LLM repair response (truncated):",
          aiRepair
            ? JSON.stringify(aiRepair).slice(0, 2000) + "...[truncated]"
            : "NULL"
        );
        const repairContent = extractAiContent(aiRepair) || "";
        parsed = tryParseJsonFromModel(repairContent);
        if (parsed) content = repairContent;
        if (aiRepair.usage)
          await logTokenUsage({
            source: "sales_highlights_repair",
            model: aiRepair.model || AZURE_DEPLOYMENT_NAME,
            usage: aiRepair.usage,
          });
      } catch (e) {
        console.warn(
          "LLM repair call failed:",
          e.response ? e.response.data : e.message
        );
      }
    }

    // if still not parsed -> ping and try small reduced prompt
    if (!parsed) {
      const ping = await pingAzure(AZURE_DEPLOYMENT_NAME);
      if (!ping.ok) {
        console.error(
          "Azure ping failed or returned no content:",
          ping.error || JSON.stringify(ping.raw || "null")
        );
        return res.status(500).json({
          error: "llm_no_response",
          details: ping.error || "empty response from model; see server logs",
        });
      }

      // reduced prompt using first article
      console.log("Retrying with single, aggressively truncated article...");
      const single = useArticles[0];
      const smallTitle = safeTruncate(single.title || "(no title)", 120);
      const smallDesc = safeTruncate(single.description || "", 200);
      const reducedText = `[1] TITLE: ${smallTitle}\nDESC: ${smallDesc}\nURL: ${
        single.url || ""
      }\n---\n`;
      const reducedUser = {
        role: "user",
        content: header + "\n\n" + reducedText + "\nReturn only JSON.",
      };
      try {
        const aiSmall = await callAzureChat(
          AZURE_DEPLOYMENT_NAME,
          [systemMsg, reducedUser],
          SALES_RETRY_MAX_TOKENS
        );
        console.log(
          "LLM small-retry response (truncated):",
          aiSmall
            ? JSON.stringify(aiSmall).slice(0, 2000) + "...[truncated]"
            : "NULL"
        );
        const smallContent = extractAiContent(aiSmall) || "";
        const smallParsed = tryParseJsonFromModel(smallContent);
        if (aiSmall && aiSmall.usage)
          await logTokenUsage({
            source: "sales_highlights_retry_small",
            model: aiSmall.model || AZURE_DEPLOYMENT_NAME,
            usage: aiSmall.usage,
          });
        if (smallParsed) {
          parsed = smallParsed;
          content = smallContent;
        } else {
          console.warn(
            "Final retry did not produce parseable JSON. Returning raw content for inspection."
          );
          return res.json({
            success: false,
            warning:
              "Could not parse JSON from model output after repair attempts",
            raw: content || "",
          });
        }
      } catch (e) {
        console.warn(
          "LLM small-retry failed:",
          e.response ? e.response.data : e.message
        );
        return res.status(500).json({
          error: "llm_retry_failed",
          details: e.response ? e.response.data : e.message,
        });
      }
    }

    // log tokens for initial call
    if (aiData && aiData.usage)
      await logTokenUsage({
        source: "sales_highlights",
        model: aiData.model || AZURE_DEPLOYMENT_NAME,
        usage: aiData.usage,
      });

    if (parsed) return res.json({ success: true, data: parsed, raw: content });
    else
      return res.json({
        success: false,
        warning: "Could not parse JSON from model output",
        raw: content || "",
      });
  } catch (e) {
    console.error("/api/sales_highlights error:", e);
    return res
      .status(500)
      .json({ error: "internal_error", details: e.message || e });
  }
});

// Main research endpoint - integrates everything and uses inline LLM with same robust flow
app.post("/api/research", async (req, res) => {
  const startTs = Date.now();
  try {
    const { companyName: rawCompanyName } = req.body || {};
    let rawDomain = req.body ? req.body.domain : null;
    const rawForce = req.body ? req.body.force : false;
    const force =
      rawForce === true ||
      (typeof rawForce === "string" && rawForce.toLowerCase() === "true");

    if (!rawCompanyName)
      return res.status(400).json({ error: "companyName is required" });
    const companyName = rawCompanyName.trim();
    console.log("REQ /api/research", { companyName, rawDomain, force });

    // Resolve candidates
    const domainCandidateRaw = sanitizeDomainInput(rawDomain || null);
    let resolvedDomain = null,
      resolvedFrom = null,
      resolvedConfidence = 0,
      resolvedCandidates = [];
    if (
      domainCandidateRaw &&
      domainMatchesCompany(domainCandidateRaw, companyName)
    ) {
      resolvedDomain = normalizeDomain(domainCandidateRaw);
      resolvedFrom = "user-provided";
      resolvedConfidence = 1.0;
    } else {
      const { best, candidates } = await resolveCandidates(
        companyName,
        domainCandidateRaw
      );
      resolvedCandidates = candidates.map((c) => ({
        title: c.title,
        pageUrl: c.pageUrl,
        domainCandidate: c.domainCandidate,
        score: c.score,
      }));
      if (best && best.domainCandidate)
        resolvedDomain = normalizeDomain(best.domainCandidate);
      else resolvedDomain = normalizeDomain(guessDomain(companyName));
      resolvedFrom = "wikipedia";
      resolvedConfidence =
        best && typeof best.score === "number" ? best.score : 0.0;
    }

    if (!force && resolvedConfidence < 0.8) {
      return res.json({
        ambiguous: true,
        message:
          "Multiple possible entities found. Provide chosen domain or re-run with force:true.",
        resolvedCandidates,
        suggestedDomain: resolvedDomain,
        resolvedConfidence,
      });
    }

    const domainSan = normalizeDomain(
      resolvedDomain || guessDomain(companyName)
    );
    if (!force) {
      const recent = await checkRecentReport(companyName, domainSan, 7 * 24);
      if (recent)
        return res.json({
          cached: true,
          firestoreId: recent.id,
          report: recent.data,
        });
    }

    const result = {
      companyName,
      domainUsed: domainSan,
      website: null,
      website_text: null,
      news: [],
      createdAt: new Date().toISOString(),
      resolvedFrom,
      resolvedConfidence,
    };
    if (
      domainCandidateRaw &&
      normalizeDomain(domainCandidateRaw) !== normalizeDomain(domainSan)
    )
      result.domainMismatch = true;
    result.resolvedCandidates = resolvedCandidates;

    // fetch website or wiki fallback
    try {
      const { url, html } = await tryCommonPaths(domainSan);
      if (html) {
        result.website = url;
        result.website_text = extractTextFromHtml(html).website_text;
      } else {
        const wiki = await fetchWikiSummaryByTitle(companyName).catch(
          () => null
        );
        if (wiki) {
          result.website = wiki.pageUrl;
          result.website_text =
            (wiki.description || "") + "\n\n" + (wiki.extract || "");
          result.fallback = "wikipedia";
        }
      }
    } catch (e) {
      console.warn("website fetch step error:", e.message || e);
    }

    // news fetch
    let rawArticles = [];
    try {
      if (NEWSAPI_KEY) {
        try {
          const url = buildTargetedNewsApiUrl(companyName, 12);
          const r = await axios.get(url, { timeout: 12000 });
          rawArticles = r.data && r.data.articles ? r.data.articles : [];
        } catch (e) {
          console.warn("targeted NewsAPI fetch failed:", e.message || e);
        }
      }
      if (!rawArticles.length) {
        rawArticles = await (async () => {
          try {
            return await fetchNews(companyName);
          } catch (e) {
            return [];
          }
        })();
      }
    } catch (e) {
      console.warn("news master fetch error:", e.message || e);
      rawArticles = [];
    }

    const filtered = filterAndScoreNews(rawArticles, companyName, 6);
    result.news = filtered;

    // Inline LLM for sales highlights with robust handling (only if creds and filtered articles)
    result.salesHighlights = null;
    if (AZURE_ENDPOINT && AZURE_KEY && filtered.length) {
      const useArticles = filtered.slice(0, SALES_TOP_K);
      let articlesText = "";
      useArticles.forEach((a, i) => {
        const title = safeTruncate(a.title || "(no title)", 200);
        const src = a.source || "unknown";
        const date = a.publishedAt || "";
        const url = a.url || "";
        const desc = safeTruncate(a.description || "", 300);
        articlesText += `\n[${
          i + 1
        }] TITLE: ${title}\nSOURCE: ${src}\nDATE: ${date}\nURL: ${url}\nDESC: ${desc}\n---\n`;
      });

      const header = `You are a sales assistant. Convert the following news into JSON sales highlights for ${companyName}. For each article return: title, url, one_line_summary (single sentence), sales_bullet (5-12 words), suggested_question (one specific question). Return ONLY valid JSON.`;
      const systemMsg = {
        role: "system",
        content: "You are a concise sales briefing generator.",
      };
      const userMsg = { role: "user", content: header + "\n\n" + articlesText };

      try {
        const ai = await callAzureChat(
          AZURE_DEPLOYMENT_NAME,
          [systemMsg, userMsg],
          SALES_MAX_TOKENS
        );
        if (ai && ai.usage)
          await logTokenUsage({
            source: "sales_highlights_inline",
            model: ai.model || AZURE_DEPLOYMENT_NAME,
            usage: ai.usage,
          });

        console.log(
          "Inline LLM initial response (truncated):",
          ai
            ? JSON.stringify(ai).slice(0, 2000) +
                (JSON.stringify(ai).length > 2000 ? "...[truncated]" : "")
            : "NULL"
        );
        // right after receiving `ai`
        console.log(
          "AI usage object:",
          ai.usage ? JSON.stringify(ai.usage) : "NO_USAGE_FIELD"
        );
        result.llmUsage = ai.usage || null;

        // log into token_logs (await it so we see failures)
        try {
          if (ai && ai.usage)
            await logTokenUsage({
              source: "sales_highlights_inline",
              model: ai.model || AZURE_DEPLOYMENT_NAME,
              usage: ai.usage,
            });
        } catch (e) {
          console.error("Failed to log token usage to token_logs:", e);
        }

        let aiContent = extractAiContent(ai) || "";
        let parsed = tryParseJsonFromModel(aiContent);

        if (!parsed) {
          console.warn("Inline LLM output not parseable -> attempt repair");
          const repairMsg = {
            role: "user",
            content:
              "Previous output was not valid JSON. NOW output only the JSON array/object matching the requested schema: [{title,url,one_line_summary,sales_bullet,suggested_question}]. Return only JSON and nothing else.",
          };
          try {
            const aiRepair = await callAzureChat(
              AZURE_DEPLOYMENT_NAME,
              [systemMsg, repairMsg],
              SALES_RETRY_MAX_TOKENS
            );
            if (aiRepair && aiRepair.usage)
              await logTokenUsage({
                source: "sales_highlights_inline_repair",
                model: aiRepair.model || AZURE_DEPLOYMENT_NAME,
                usage: aiRepair.usage,
              });
            console.log(
              "Inline LLM repair response (truncated):",
              aiRepair
                ? JSON.stringify(aiRepair).slice(0, 2000) + "...[truncated]"
                : "NULL"
            );
            const repairContent = extractAiContent(aiRepair) || "";
            parsed = tryParseJsonFromModel(repairContent);
            if (parsed) aiContent = repairContent;
          } catch (e) {
            console.warn(
              "Inline LLM repair call failed:",
              e.response ? e.response.data : e.message
            );
          }
        }

        if (!parsed) {
          const ping = await pingAzure(AZURE_DEPLOYMENT_NAME);
          if (!ping.ok) {
            console.error(
              "Azure ping failed or returned no content:",
              ping.error || JSON.stringify(ping.raw || "null")
            );
            result.salesHighlights = {
              error: "llm_no_response",
              details:
                ping.error || "empty response from model; see server logs",
            };
          } else {
            console.log("Azure ping OK:", ping.content);
            // small retry with first article
            const single = useArticles[0];
            const smallTitle = safeTruncate(single.title || "(no title)", 120);
            const smallDesc = safeTruncate(single.description || "", 200);
            const reducedText = `[1] TITLE: ${smallTitle}\nDESC: ${smallDesc}\nURL: ${
              single.url || ""
            }\n---\n`;
            const reducedUser = {
              role: "user",
              content: header + "\n\n" + reducedText + "\nReturn only JSON.",
            };
            try {
              const aiSmall = await callAzureChat(
                AZURE_DEPLOYMENT_NAME,
                [systemMsg, reducedUser],
                SALES_RETRY_MAX_TOKENS
              );
              if (aiSmall && aiSmall.usage)
                await logTokenUsage({
                  source: "sales_highlights_inline_retry_small",
                  model: aiSmall.model || AZURE_DEPLOYMENT_NAME,
                  usage: aiSmall.usage,
                });
              console.log(
                "Inline LLM small retry response (truncated):",
                aiSmall
                  ? JSON.stringify(aiSmall).slice(0, 2000) + "...[truncated]"
                  : "NULL"
              );
              const smallContent = extractAiContent(aiSmall) || "";
              const smallParsed = tryParseJsonFromModel(smallContent);
              if (smallParsed) {
                parsed = smallParsed;
                aiContent = smallContent;
              } else {
                result.salesHighlights = {
                  raw: aiContent || "",
                  warning: "could not parse JSON from LLM after retries",
                };
              }
            } catch (e) {
              console.warn(
                "Inline LLM small retry failed:",
                e.response ? e.response.data : e.message
              );
              result.salesHighlights = {
                error: "llm_retry_failed",
                details: e.response ? e.response.data : e.message,
              };
            }
          }
        }

        if (parsed) result.salesHighlights = parsed;
      } catch (e) {
        console.warn(
          "sales highlights LLM step failed:",
          e.response ? e.response.data : e.message
        );
        result.salesHighlights = { error: e.message || "llm_error" };
      }
    }

    // persist report
    try {
      const writeData = {
        companyName: result.companyName,
        domainUsed: result.domainUsed,
        website: result.website || null,
        website_text: result.website_text || null,
        news: result.news || [],
        salesHighlights: result.salesHighlights || null,
        llmUsage: result.llmUsage || null, // <-- NEW: store usage inside the report
        fallback: result.fallback || null,
        resolvedFrom: result.resolvedFrom || null,
        resolvedConfidence: result.resolvedConfidence || null,
        resolvedCandidates: result.resolvedCandidates || [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      const docRef = await db.collection("reports").add(writeData);
      result.firestoreId = docRef.id;
      await db
        .collection("resolution_audit")
        .add({
          companyName,
          domainRequested: rawDomain || null,
          resolvedDomain: domainSan,
          resolvedFrom: result.resolvedFrom,
          resolvedConfidence: result.resolvedConfidence,
          candidates: result.resolvedCandidates,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => null);
    } catch (e) {
      console.error("Firestore save failed:", e.message || e);
      result.firestoreError = true;
    }

    const elapsedMs = Date.now() - startTs;
    return res.json({ cached: false, elapsedMs, report: result });
  } catch (err) {
    console.error("POST /api/research internal error:", err);
    return res
      .status(500)
      .json({ error: "internal_server_error", details: err.message || err });
  }
});

/* ===================== START SERVER ===================== */
app.listen(PORT, () => {
  console.log(`Research Agent backend running on port ${PORT}`);
  console.log("Firebase project_id=", serviceAccount.project_id);
  console.log(
    "Azure endpoint present:",
    !!AZURE_ENDPOINT,
    "Azure key present:",
    !!AZURE_KEY
  );
  console.log(
    "SALES_TOP_K:",
    SALES_TOP_K,
    "SALES_MAX_TOKENS:",
    SALES_MAX_TOKENS
  );
});

/* ===================== SMALL FALLBACK fetchNews (kept here) ===================== */
// fallback news fetcher used above if NewsAPI not available
async function fetchNews(companyName) {
  if (!companyName) return [];
  const q = encodeURIComponent(companyName);
  try {
    const googleNewsUrl = `https://news.google.com/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
    const html = await fetchHtml(googleNewsUrl);
    const $ = cheerio.load(html);
    const articles = [];
    $("article")
      .slice(0, 10)
      .each((i, el) => {
        const title =
          $(el).find("h3").text().trim() || $(el).find("h4").text().trim();
        const linkRel = $(el).find("a").attr("href") || "";
        const link = linkRel.startsWith("./")
          ? "https://news.google.com" + linkRel.slice(1)
          : linkRel;
        const source = $(el).find("a > .SVJrMe").first().text().trim() || null;
        const time = $(el).find("time").attr("datetime") || null;
        if (title)
          articles.push({
            title,
            source,
            publishedAt: time,
            url: link,
            description: null,
          });
      });
    return articles;
  } catch (e) {
    console.warn("Google News fallback failed:", e.message || e);
  }
  return [];
}
