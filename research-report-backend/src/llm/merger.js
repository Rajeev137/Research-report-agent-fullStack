// src/llm/merger.js
// Merge per-article summaries into one final JSON for slides.
// Guarantees: strictly valid JSON, fixed slide titles, exactly 3 bullets per slide,
// robust against missing fields, with clear logs on why a fallback happened.

const axios = require("axios");
const Ajv = require("ajv");
const { unifiedPrompt } = require("./prompts");
const {
  AZURE_ENDPOINT,
  AZURE_KEY,
  AZURE_DEPLOYMENT_NAME,
  AZURE_API_VERSION,
  FINAL_MAX_COMPLETION_TOKENS,
  FINAL_RETRY_TOKENS,
} = require("../config/env");

// ---- Azure chat completions (gpt-5-mini: temperature must be 1) ----
const CHAT_URL = `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT_NAME}/chat/completions?api-version=${AZURE_API_VERSION}`;

// ---- JSON schema enforces final shape ----
const ajv = new Ajv({ allErrors: true, strict: false });
const FINAL_SCHEMA = {
  type: "object",
  required: ["company", "company_overview", "highlights", "slides"],
  properties: {
    company: { type: "string" },
    company_overview: { type: "string" },
    highlights: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["title", "url", "one_line_summary", "sales_bullet", "suggested_question"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          one_line_summary: { type: "string" },
          sales_bullet: { type: "string" },
          suggested_question: { type: "string" },
        },
        additionalProperties: true,
      },
    },
    slides: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        required: ["slide_number", "slide_title", "bullet_points"],
        properties: {
          slide_number: { type: "integer" },
          slide_title: { type: "string" },
          bullet_points: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
};
const validate = ajv.compile(FINAL_SCHEMA);

// ---------------- helpers ----------------
function isBlank(s) {
  return !s || (typeof s === "string" && s.trim().length === 0);
}

function tryParseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch {}
  // Fallback: extract first JSON object/array substring
  const m = str.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  return null;
}

// Light safety cap to prevent pathological lengths
function clip(str, max) {
  if (typeof str !== "string") return str;
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// Build compact article objects for the merger prompt (keep generous caps)
function buildArticlesCompact(perArticleSummaries, k) {
  const MAX_TITLE = 220;
  const MAX_OLS   = 260;  // one_line_summary
  const MAX_SS    = 520;  // short_summary
  const MAX_SALES = 120;   // sales_bullet
  const MAX_Q     = 140;   // suggested_question

  return (perArticleSummaries || [])
    .slice(0, k)
    .map(a => ({
      id: a?.id ?? null,
      title: clip(a?.title ?? "", MAX_TITLE),
      url: a?.url ?? "",
      one_line_summary: clip(a?.one_line_summary ?? "", MAX_OLS),
      short_summary: clip(a?.short_summary ?? "", MAX_SS),
      sales_bullet: clip(a?.sales_bullet ?? "", MAX_SALES),
      suggested_question: clip(a?.suggested_question ?? "", MAX_Q),
    }));
}

function fixedSlideTitle(i) {
  return ["Key Facts & Summary", "Sales Opportunities & Risks", "Questions & Next Steps"][i] || `Slide ${i+1}`;
}

function to3Bullets(arr) {
  const items = Array.isArray(arr) ? arr.map(v => String(v || "").trim()).filter(Boolean) : [];
  // pad or slice to exactly 3
  while (items.length < 3) items.push("•");
  return items.slice(0, 3);
}

/**
 * Sanitize model JSON BEFORE AJV validation:
 * - Coerce types
 * - Force slide titles to fixed set
 * - Force EXACTLY 3 bullets per slide (derive if needed)
 * - Never index highlights without safety checks
 */
function sanitizeMerged(companyName, obj, k = 3) {
  if (!obj || typeof obj !== "object") obj = {};

  // Normalize highlights to at most k items and coerce strings
  let highlights = Array.isArray(obj.highlights)
    ? obj.highlights.slice(0, k).map(h => ({
        title: String(h?.title || "").trim(),
        url: String(h?.url || "").trim(),
        one_line_summary: String(h?.one_line_summary || h?.short_summary || "").trim(),
        sales_bullet: String(h?.sales_bullet || "").trim(),
        suggested_question: String(h?.suggested_question || "").trim(),
      }))
    : [];

  if (highlights.length < 1) {
    highlights = [{
      title: companyName || "Company",
      url: "",
      one_line_summary: "Recent development relevant to sales engagement.",
      sales_bullet: "Potential opportunity—align solution & timing",
      suggested_question: `Any impact on ${companyName}'s priorities?`,
    }];
  }

  const company = String(obj.company || companyName || "").trim();

  let company_overview = String(obj.company_overview || "").trim();
  if (isBlank(company_overview)) {
    const seed = highlights.map(h => h.one_line_summary).filter(Boolean).slice(0, 2).join(" ");
    company_overview = seed
      ? `${company}: ${seed}`
      : `${company}: recent developments with potential commercial impact.`;
  }

  // Start from model slides, enforce exactly 3 with fixed titles & 3 bullets each
  const modelSlides = Array.isArray(obj.slides) ? obj.slides.slice(0, 3) : [];
  const base = [modelSlides[0] || {}, modelSlides[1] || {}, modelSlides[2] || {}];

  // Derived bullet pools (safe access with ?. and defaults)
  const h0 = highlights[0] || {};
  const h1 = highlights[1] || {};
  const h2 = highlights[2] || {};

  const derivedFacts = [
    h0.one_line_summary || h0.title || company_overview,
    h1.one_line_summary || h1.title || "Key development noted",
    h2.one_line_summary || h2.title || `${highlights.length} highlight(s) extracted`,
  ];

  const derivedOpps = [
    h0.sales_bullet || "Potential opportunity—align solution & timing",
    h1.sales_bullet || "Assess budget/timeline window",
    h2.sales_bullet || "Check risk/compliance drivers",
  ];

  const derivedQs = [
    h0.suggested_question || `What impact on ${company}'s roadmap?`,
    h1.suggested_question || "Who are the stakeholders & decision timeline?",
    h2.suggested_question || "Any integration/compliance constraints?",
  ];

  const slides = [0,1,2].map(i => {
    const raw = base[i] || {};
    let bullets = to3Bullets(raw.bullet_points);
    const onlyDots = bullets.every(b => b === "•");
    if (onlyDots) {
      if (i === 0) bullets = to3Bullets(derivedFacts);
      if (i === 1) bullets = to3Bullets(derivedOpps);
      if (i === 2) bullets = to3Bullets(derivedQs);
    }
    return {
      slide_number: Number.isInteger(raw.slide_number) ? raw.slide_number : (i + 1),
      slide_title: fixedSlideTitle(i),
      bullet_points: to3Bullets(bullets),
    };
  });

  return { company, company_overview, highlights, slides };
}

/** Local no-LLM fallback so summary is never null; still enforces 3 bullets per slide */
function localMergeFallback(companyName, perArticleSummaries, k = 3) {
  const top = (perArticleSummaries || []).slice(0, Math.max(1, k));
  const highlights = top.map((a) => ({
    title: a?.title || "",
    url: a?.url || "",
    one_line_summary: a?.one_line_summary || a?.short_summary || "",
    sales_bullet: a?.sales_bullet || "Potential opportunity—align solution & timing",
    suggested_question: a?.suggested_question || `Any impact on ${companyName}'s plans?`,
  }));

  const seed = top.map((a) => a?.one_line_summary || a?.short_summary).filter(Boolean).slice(0, 2).join(" ");
  const company_overview = seed
    ? `${companyName}: ${seed}`
    : `${companyName}: recent developments with potential commercial impact.`;

  const h0 = highlights[0] || {};
  const h1 = highlights[1] || {};
  const h2 = highlights[2] || {};

  const slides = [
    {
      slide_number: 1,
      slide_title: fixedSlideTitle(0),
      bullet_points: to3Bullets([
        company_overview,
        h1.one_line_summary || "Key development noted",
        h0.one_line_summary || h0.title || "Key development noted",
      ]),
    },
    {
      slide_number: 2,
      slide_title: fixedSlideTitle(1),
      bullet_points: to3Bullets([
        h0.sales_bullet || "Potential opportunity—align solution & timing",
        h1.sales_bullet || "Assess budget/timeline window",
        h2.sales_bullet || "Check risk/compliance drivers",
      ]),
    },
    {
      slide_number: 3,
      slide_title: fixedSlideTitle(2),
      bullet_points: to3Bullets([
        h0.suggested_question || `What impact on ${companyName}'s roadmap?`,
        h1.suggested_question || "Who are the stakeholders & decision timeline?",
        h2.suggested_question || "Any integration/compliance constraints?",
      ]),
    },
  ];

  return {
    company: companyName,
    company_overview,
    highlights: highlights.length ? highlights : [{
      title: companyName,
      url: "",
      one_line_summary: "Recent news potentially relevant to sales engagement.",
      sales_bullet: "Explore alignment and timing",
      suggested_question: `What impact on ${companyName}'s priorities?`,
    }],
    slides,
  };
}

async function callAzure(messages, maxTokens) {
  const body = {
    messages,
    temperature: 1,
    max_completion_tokens: maxTokens,
    response_format: { type: "json_object" },
  };
  const r = await axios.post(CHAT_URL, body, {
    headers: { "api-key": AZURE_KEY, "Content-Type": "application/json" },
    timeout: 90000, // bump a bit for larger outputs
  });
  return r.data;
}

// ---------------- main ----------------
async function mergeSummariesToFinal(companyName, perArticleSummaries, salesTopK = 3) {
  const articlesCompact = buildArticlesCompact(perArticleSummaries, salesTopK);
  const sys = unifiedPrompt || "You are a sales analysis assistant. Output strictly valid JSON. No commentary.";

  const usr = `
COMPANY: ${companyName}

ARTICLES (Top ${salesTopK}):
${JSON.stringify(articlesCompact, null, 2)}

Return a single JSON object with EXACTLY these keys:
{
  "company": "<string>",
  "company_overview": "<concise paragraph>",
  "highlights": [
    { "title":"", "url":"", "one_line_summary":"", "sales_bullet":"", "suggested_question":"" }
  ],
  "slides": [
    { "slide_number": 1, "slide_title": "Key Facts & Summary", "bullet_points": ["...", "...", "..."] },
    { "slide_number": 2, "slide_title": "Sales Opportunities & Risks", "bullet_points": ["...", "...", "..."] },
    { "slide_number": 3, "slide_title": "Questions & Next Steps", "bullet_points": ["...", "...", "..."] }
  ]
}
- Return ONLY JSON (no prose, no backticks).
- Each slide must have EXACTLY 3 short, punchy bullet points.
  `.trim();

  // ---- Initial attempt
  let ai = null;
  try {
    ai = await callAzure(
      [{ role: "system", content: sys }, { role: "user", content: usr }],
      Math.max(600, Math.min(FINAL_MAX_COMPLETION_TOKENS, 2200)) // keep room for repair
    );

    const content = ai?.choices?.[0]?.message?.content || "";
    if (!content) {
      console.warn("[merger] initial: empty content from model");
      throw new Error("empty_content");
    }

    const parsed = tryParseJson(content);
    if (!parsed) {
      console.warn("[merger] initial: JSON parse failed");
      throw new Error("json_parse_failed");
    }

    const fixed = sanitizeMerged(companyName, parsed, salesTopK);
    const ok = validate(fixed);
    if (!ok) {
      console.warn("[merger] initial: AJV validation failed:", validate.errors);
      throw new Error("schema_invalid");
    }

    return { parsed: fixed, usage: ai?.usage || null, model: ai?.model || null, fallback: false };
  } catch (e) {
    console.warn("[merger] initial attempt failed:", e.message || e);
  }

  // ---- Repair attempt
  try {
    const repairSys = "You MUST output valid JSON that conforms to the schema. No commentary, no backticks.";
    const repairUsr = `
The previous output failed validation.

REQUIREMENTS:
- Object with keys: company (string), company_overview (string),
  highlights (array of objects with title,url,one_line_summary,sales_bullet,suggested_question),
  slides (array of exactly 3 slides with slide_number, slide_title, bullet_points[3]).
- Slide titles must be:
  1) Key Facts & Summary
  2) Sales Opportunities & Risks
  3) Questions & Next Steps
- Each slide must have EXACTLY 3 bullet points (short, punchy).
- Return ONLY JSON.

Rebuild based on these articles:
${JSON.stringify(articlesCompact, null, 2)}
    `.trim();

    const repair = await callAzure(
      [{ role: "system", content: repairSys }, { role: "user", content: repairUsr }],
      Math.max(400, Math.min(FINAL_RETRY_TOKENS, 1200))
    );

    const rContent = repair?.choices?.[0]?.message?.content || "";
    if (!rContent) {
      console.warn("[merger] repair: empty content from model");
      const lf = localMergeFallback(companyName, perArticleSummaries, salesTopK);
      return { parsed: lf, usage: repair?.usage || null, model: repair?.model || null, fallback: true, error: "empty_content_repair" };
    }

    const rParsed = tryParseJson(rContent);
    if (!rParsed) {
      console.warn("[merger] repair: JSON parse failed");
      const lf = localMergeFallback(companyName, perArticleSummaries, salesTopK);
      return { parsed: lf, usage: repair?.usage || null, model: repair?.model || null, fallback: true, error: "json_parse_failed_repair" };
    }

    const fixed = sanitizeMerged(companyName, rParsed, salesTopK);
    const ok = validate(fixed);
    if (!ok) {
      console.warn("[merger] repair: AJV validation failed:", validate.errors);
      const lf = localMergeFallback(companyName, perArticleSummaries, salesTopK);
      return { parsed: lf, usage: repair?.usage || null, model: repair?.model || null, fallback: true, error: "merge_output_invalid_after_repair" };
    }

    return { parsed: fixed, usage: repair?.usage || null, model: repair?.model || null, fallback: false };
  } catch (e) {
    console.warn("[merger] repair attempt failed:", e.message || e);
    const lf = localMergeFallback(companyName, perArticleSummaries, salesTopK);
    return { parsed: lf, usage: null, model: null, fallback: true, error: String(e?.message || e) };
  }
}

module.exports = {
  mergeSummariesToFinal,
  validate: (obj) => validate(obj),
};