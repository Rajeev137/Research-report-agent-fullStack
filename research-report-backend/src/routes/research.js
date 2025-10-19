const crypto = require("crypto");
const router = require("express").Router();

const { admin, db } = require("../firestore/init");
const { checkRecentReport } = require("../firestore/cache");
const { logTokenUsage } = require("../firestore/tokenLog");

const {
  sanitizeDomainInput,
  fetchHtml,
  extractTextFromHtml,
} = require("../services/webService");

const {
  fetchNewsViaNewsApi,
  fetchNewsGoogleFallback,
  filterAndRankArticles,
} = require("../services/newsService");

const { summarizeArticleForSales } = require("../llm/summarizer");
const { mergeSummariesToFinal } = require("../llm/merger");
const { SALES_TOP_K } = require("../config/env");

// -------------------- helpers --------------------

/** in-process lock to avoid concurrent double-writes in this node instance */
const inFlight = new Set();

/** deterministic id per (company, domain, hour) — used only when force=false */
function makeDeterministicId(companyName, domainUsed) {
  const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const raw = `${(companyName || "").toLowerCase()}|${(
    domainUsed || ""
  ).toLowerCase()}|${hourBucket}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

function isBlank(x) {
  return x == null || (typeof x === "string" && x.trim() === "");
}

/**
 * Force-fill empty summarizer fields WITHOUT extra LLM calls.
 * This prevents starving the merge stage when the map-stage returned blanks.
 */
function forceFillSummary(article, companyName, objIn) {
  const out = { ...objIn };

  const title = (article.title || "").trim();
  const desc = (article.description || "").trim();
  const url = article.url || "";
  const both = (title + " " + desc).trim();

  if (isBlank(out.id)) out.id = article.id || null;
  if (isBlank(out.title)) out.title = title;
  if (isBlank(out.url)) out.url = url;

  if (isBlank(out.one_line_summary)) {
    const first = (desc || title).replace(/\s+/g, " ").trim();
    out.one_line_summary = first
      ? first.split(/(?<=\.)\s/)[0]
      : `Update relevant to ${companyName}`;
  }

  if (isBlank(out.short_summary)) {
    const base = desc || title;
    out.short_summary = base
      ? `${base} This development may influence ${companyName}'s roadmap, partners, or procurement timing.`
      : `Recent development potentially relevant to ${companyName}'s commercial plans.`;
  }

  if (isBlank(out.sales_bullet)) {
    if (/partnership|deal|contract|agreement|acquire|acquisition/i.test(both)) {
      out.sales_bullet = "New partnership/contract—time a solution pitch";
    } else if (
      /funding|investment|raise|earnings|revenue|profit|guidance/i.test(both)
    ) {
      out.sales_bullet = "Financial momentum—budget window to engage";
    } else if (/launch|product|platform|feature|service|rollout/i.test(both)) {
      out.sales_bullet = "New launch—attach integration/value add";
    } else if (/regulation|compliance|security|risk|breach/i.test(both)) {
      out.sales_bullet = "Compliance/security driver—solution fit";
    } else {
      out.sales_bullet = "Potential opportunity—explore fit and timing";
    }
  }

  if (isBlank(out.suggested_question)) {
    out.suggested_question = `What impact does this have on ${companyName}'s priorities and timelines?`;
  }

  return out;
}

// -------------------- route --------------------
// ================= READ-BY-ID via GET /api/research?reportId=... =================
router.get("/", async (req, res) => {
  try {
    const { reportId } = req.query || {};
    if (!reportId) {
      // If no reportId is provided, just DO NOTHING here
      // We will let POST "/" handle generation logic.
      return res.status(400).json({ error: "missing_reportId" });
    }

    const snap = await db.collection("reports").doc(String(reportId)).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "report_not_found", reportId });
    }

    // Normalize response shape so frontend always gets slidesLink/slidesPdfLink cleanly
    const data = snap.data() || {};
    const slidesLink = data.slidesLink || data.slides?.link || data.slides_url || null;
    const slidesPdfLink = data.slidesPdfLink || data.slides?.pdfLink || data.slides_pdf_url || null;

    return res.json({
      reportId,
      ...data,
      slidesLink,
      slidesPdfLink
    });
  } catch (err) {
    console.error("[GET /api/research?reportId] error:", err);
    return res.status(500).json({ error: "read_failed", details: err.message });
  }
});

router.post("/", async (req, res) => {
  const rid = Math.random().toString(36).slice(2, 8); // request id for tracing
  const start = Date.now();

  try {
    const rawCompanyName = req.body?.companyName;
    const rawDomain = req.body?.domain;
    const force =
      req.body?.force === true ||
      (typeof req.body?.force === "string" &&
        req.body.force.toLowerCase() === "true");

    if (!rawCompanyName) {
      return res.status(400).json({ error: "companyName is required" });
    }

    const companyName = rawCompanyName.trim();
    const userProvidedDomain = rawDomain
      ? sanitizeDomainInput(rawDomain)
      : null;

    console.log("REQ /api/research rid=", rid, {
      companyName,
      rawDomain,
      force,
    });

    // ---------- CACHE (company-only if domain not provided) ----------
    if (!force) {
      const cached = await checkRecentReport(
        companyName,
        userProvidedDomain,
        7 * 24
      );
      if (cached) {
        return res.json({
          cached: true,
          firestoreId: cached.id,
          report: cached.data,
        });
      }
    }

    // ---------- Report scaffold (no DB write yet) ----------
    const report = {
      companyName,
      domainUsed:
        userProvidedDomain ||
        `${companyName.replace(/\s+/g, "").toLowerCase()}.com`,
      website: null,
      website_text: null,
      news: [],
      perArticleSummaries: [],
      summary: null,
      createdAt: new Date().toISOString(),
      resolvedFrom: userProvidedDomain ? "user-provided" : "guessed",
    };

    // Token usage accumulators for logging after write
    const pendingMapUsages = []; // { usage, model, article {id,title,url} }
    let pendingMergeUsage = null; // { usage, model, meta }

    // ---------- Website best-effort ----------
    try {
      const host = report.domainUsed
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "");
      const candidates = [
        `https://${host}`,
        `https://www.${host}`,
        `http://${host}`,
      ];
      for (const u of candidates) {
        try {
          const html = await fetchHtml(u);
          if (html && html.length > 200) {
            report.website = u;
            report.website_text = extractTextFromHtml(html).website_text;
            break;
          }
        } catch {
          /* continue */
        }
      }
    } catch (e) {
      console.warn("website fetch failed:", e.message || e);
    }

    // ---------- News fetch & rank ----------
    let rawArticles = await fetchNewsViaNewsApi(companyName, 12);
    if (!rawArticles?.length)
      rawArticles = await fetchNewsGoogleFallback(companyName);
    report.rawArticlesCount = rawArticles.length;

    const topK = filterAndRankArticles(rawArticles, companyName, SALES_TOP_K);
    report.news = topK;

    // ---------- Stage 1: per-article summaries + force-fill ----------
    for (const a of topK) {
      const s = await summarizeArticleForSales(a, companyName);

      // keep usage for token logs
      if (s && s._usage) {
        pendingMapUsages.push({
          usage: s._usage,
          model: s._model || null,
          article: {
            id: s.id || a.id || null,
            title: a.title || null,
            url: a.url || null,
          },
        });
      }

      const sFixed = forceFillSummary(a, companyName, s || {});
      report.perArticleSummaries.push(sFixed);
    }

    // ---------- Stage 2: merge ----------
    const merged = await mergeSummariesToFinal(
      companyName,
      report.perArticleSummaries,
      SALES_TOP_K,
    );

    report.summary = merged.parsed || null;
    if (merged?.fallback) report.fallback = true;
    if (merged?.error) report.mergeError = merged.error;

    if (merged && merged.usage) {
      pendingMergeUsage = {
        usage: merged.usage,
        model: merged.model || "gpt-5-mini",
        meta: {
          articlesCount: report.perArticleSummaries.length,
          topK: topK.length,
        },
      };
    }

    // ---------- Embedded tokenUsage BEFORE write ----------
    let totalTokens = 0;
    const mapStageEmbed = pendingMapUsages.map((pm) => {
      const t = Number(pm.usage?.total_tokens || 0);
      totalTokens += t;
      return {
        logId: null, // fill after logs are written
        tokens: t,
        articleId: pm.article.id || null,
        title: pm.article.title || null,
      };
    });
    const mergeTokens = Number(pendingMergeUsage?.usage?.total_tokens || 0);
    totalTokens += mergeTokens;

    let tokenUsageEmbed = {
      mapStage: mapStageEmbed,
      mergeStage: pendingMergeUsage
        ? { logId: null, tokens: mergeTokens }
        : null,
      slidesStage: null,
      totalTokens,
    };

    // ---------- Write report (respect force flag) ----------
    const coll = db.collection("reports");

    const write = {
      companyName: report.companyName,
      domainUsed: report.domainUsed,
      website: report.website || null,
      website_text: report.website_text || null,
      news: report.news || [],
      perArticleSummaries: report.perArticleSummaries || [],
      summary: report.summary || null,
      tokenUsage: tokenUsageEmbed, // embed w/o logIds for now
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    let createdNew = false;
    let firestoreId = null;

    if (force) {
      // BYPASS DEDUPE WHEN FORCE = TRUE — always create a new doc
      const ref = await coll.add(write);
      firestoreId = ref.id;
      createdNew = true;
      console.log(
        "WRITE /reports FORCE=TRUE -> created id=",
        firestoreId,
        "rid=",
        rid
      );
    } else {
      // deterministic-id + in-process lock (dedupe) when NOT forced
      const dedupeId = makeDeterministicId(
        report.companyName,
        report.domainUsed
      );
      while (inFlight.has(dedupeId)) {
        await new Promise((r) => setTimeout(r, 40));
      }
      inFlight.add(dedupeId);

      try {
        await coll.doc(dedupeId).create(write);
        firestoreId = dedupeId;
        createdNew = true;
        console.log("WRITE /reports CREATED id=", dedupeId, "rid=", rid);
      } catch (e) {
        if (
          String(e.code).includes("ALREADY") ||
          /already/i.test(String(e.message))
        ) {
          const snap = await coll.doc(dedupeId).get();
          if (snap.exists) {
            inFlight.delete(dedupeId);
            const existing = snap.data();
            const elapsedMs = Date.now() - start;
            return res.json({
              cached: true,
              elapsedMs,
              report: { ...existing, firestoreId: dedupeId },
            });
          }
          // Rare fallback when exists-check races
          const ref = await coll.add(write);
          firestoreId = ref.id;
          createdNew = true;
          console.log("WRITE /reports FALLBACK id=", firestoreId, "rid=", rid);
        } else {
          inFlight.delete(dedupeId);
          throw e;
        }
      } finally {
        // leave locked until after token patch? We release now; patching is idempotent.
        inFlight.delete(
          makeDeterministicId(report.companyName, report.domainUsed)
        );
      }
    }

    report.firestoreId = firestoreId;

    // ---------- Create token_logs and patch logIds into report.tokenUsage ----------
    try {
      const mapLogIds = [];
      for (const pm of pendingMapUsages) {
        const logId = await logTokenUsage({
          reportId: firestoreId,
          stage: "map",
          operation: "perArticleSummary",
          model: pm.model || null,
          usage: pm.usage || {},
          meta: pm.article || {},
        });
        mapLogIds.push(logId);
      }

      let mergeLogId = null;
      if (pendingMergeUsage) {
        mergeLogId = await logTokenUsage({
          reportId: firestoreId,
          stage: "merge",
          operation: "finalMerge",
          model: pendingMergeUsage.model || null,
          usage: pendingMergeUsage.usage || {},
          meta: pendingMergeUsage.meta || {},
        });
      }

      let totalAgain = 0;
      const mapStageUpdated = tokenUsageEmbed.mapStage.map((m, i) => {
        totalAgain += Number(m.tokens || 0);
        return { ...m, logId: mapLogIds[i] || null };
      });
      const mergeStageUpdated = tokenUsageEmbed.mergeStage
        ? { ...tokenUsageEmbed.mergeStage, logId: mergeLogId }
        : null;
      totalAgain += Number(mergeStageUpdated?.tokens || 0);

      await coll.doc(firestoreId).update({
        tokenUsage: {
          mapStage: mapStageUpdated,
          mergeStage: mergeStageUpdated,
          slidesStage: tokenUsageEmbed.slidesStage || null,
          totalTokens: totalAgain,
        },
      });
    } catch (e) {
      console.warn("tokenUsage patch failed:", e.message);
    }

    const elapsedMs = Date.now() - start;
    return res.json({ cached: false, elapsedMs, report });
  } catch (err) {
    console.error("POST /api/research error:", err);
    return res.status(500).json({
      error: "internal_server_error",
      details: err.message || String(err),
    });
  }
});

module.exports = router;
