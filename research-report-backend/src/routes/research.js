const { admin, db } = require("../firestore/init");
const { checkRecentReport } = require("../firestore/cache");
const { sanitizeDomainInput, fetchHtml, extractTextFromHtml } = require("../services/webService");
const { fetchNewsViaNewsApi, fetchNewsGoogleFallback, filterAndRankArticles } = require("../services/newsService");
const { summarizeArticleForSales } = require("../llm/summarizer");
const { mergeSummariesToFinal } = require("../llm/merger");
const { validateFinal } = require("../llm/schema");
const { SALES_TOP_K } = require("../config/env");

const router = require("express").Router();

router.post("/", async (req, res) => {
  const start = Date.now();
  try {
    const rawCompanyName = req.body?.companyName;
    const rawDomain = req.body?.domain;
    const force = req.body?.force === true || (typeof req.body?.force === "string" && req.body.force.toLowerCase() === "true");
    if (!rawCompanyName) return res.status(400).json({ error: "companyName is required" });

    const companyName = rawCompanyName.trim();
    const domainSan = sanitizeDomainInput(rawDomain || `${companyName}.com`);

    // cache
    if (!force) {
      const cached = await checkRecentReport(companyName, domainSan, 7 * 24);
      if (cached) return res.json({ cached: true, firestoreId: cached.id, report: cached.data });
    }

    // Build report envelope
    const report = {
      companyName,
      domainUsed: domainSan,
      website: null,
      website_text: null,
      news: [],
      perArticleSummaries: [],
      summary: null,
      createdAt: new Date().toISOString(),
    };

    // Try fetch website text (best effort)
    try {
      const candidates = [
        `https://${domainSan}`,
        `https://www.${domainSan.replace(/^www\./, "")}`,
        `http://${domainSan}`,
      ];
      for (const u of candidates) {
        try {
          const html = await fetchHtml(u);
          if (html && html.length > 200) {
            report.website = u;
            report.website_text = extractTextFromHtml(html).website_text;
            break;
          }
        } catch {}
      }
    } catch (e) {
      console.warn("website fetch failed:", e.message || e);
    }

    // Fetch news and rank
    let rawArticles = await fetchNewsViaNewsApi(companyName, 12);
    if (!rawArticles?.length) rawArticles = await fetchNewsGoogleFallback(companyName);
    report.rawArticlesCount = rawArticles.length;

    const topK = filterAndRankArticles(rawArticles, companyName, SALES_TOP_K);
    report.news = topK;

    // Stage 1: per-article summaries
    for (const a of topK) {
      const s = await summarizeArticleForSales(a, companyName);
      report.perArticleSummaries.push(s);
    }

    // Stage 2: merge to final
    const merged = await mergeSummariesToFinal(companyName, report.perArticleSummaries);
    report.summary = merged.parsed || null;
    if (merged.usage) report.usage = merged.usage;
    if (merged.fallback) report.fallback = true;
    if (merged.error) report.mergeError = merged.error;

    // Validate final & persist
    let validationErrors = [];
    try {
      const ok = validateFinal(report.summary || {});
      if (!ok) validationErrors = validateFinal.errors || [];
    } catch (e) {
      validationErrors = [{ message: "validation threw", detail: e.message || String(e) }];
    }

    try {
      const write = {
        companyName: report.companyName,
        domainUsed: report.domainUsed,
        website: report.website || null,
        website_text: report.website_text || null,
        news: report.news || [],
        perArticleSummaries: report.perArticleSummaries || [],
        summary: report.summary || null,
        validationErrors,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      const docRef = await db.collection("reports").add(write);
      report.firestoreId = docRef.id;
    } catch (e) {
      console.error("Firestore write failed:", e.message || e);
      report.firestoreError = true;
    }

    const elapsed = Date.now() - start;
    return res.json({ cached: false, elapsedMs: elapsed, report });

  } catch (err) {
    console.error("POST /api/research error:", err);
    return res.status(500).json({ error: "internal_server_error", details: err.message || String(err) });
  }
});

module.exports = router;