// src/llm/summarizer.js
// Purpose: Summarize a single news article into sales-ready fields with high reliability.
// Strategy: strict JSON output -> if any field is empty, do a tiny repair pass -> if still empty, force-fill heuristically (no extra tokens).

const axios = require("axios");
const {
  AZURE_ENDPOINT,
  AZURE_KEY,
  AZURE_DEPLOYMENT_NAME,
  AZURE_API_VERSION,
  PER_ARTICLE_MAX_TOKENS,
  PER_ARTICLE_RETRY_TOKENS,
} = require("../config/env");

// Build Azure Chat Completions endpoint
const CHAT_URL = `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT_NAME}/chat/completions?api-version=${AZURE_API_VERSION}`;

// ---------- helpers ----------
function tryParseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch {}
  const m = str.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  return null;
}

function isBlank(x) {
  return x == null || (typeof x === "string" && x.trim() === "");
}

// Simple heuristics to force non-empty fields without extra LLM calls
function forceFill(article, companyName, obj) {
  const title = (article.title || "").trim();
  const desc  = (article.description || "").trim();
  const url   = article.url || "";
  const both  = (title + " " + desc).toLowerCase();

  const out = { ...obj };
  if (isBlank(out.id)) out.id = article.id || null;
  if (isBlank(out.title)) out.title = title;
  if (isBlank(out.url)) out.url = url;

  if (isBlank(out.one_line_summary)) {
    const base = (desc || title).replace(/\s+/g, " ").trim();
    out.one_line_summary = base ? base.split(/(?<=\.)\s/)[0] : `Update relevant to ${companyName}`;
  }

  if (isBlank(out.short_summary)) {
    const base = desc || title;
    out.short_summary = base
      ? `${base} This may influence ${companyName}'s roadmap or procurement timing.`
      : `Recent development potentially relevant to ${companyName}'s commercial plans.`;
  }

  if (isBlank(out.sales_bullet)) {
    if (/(partnership|deal|contract|agreement|acquire|acquisition)/i.test(both)) {
      out.sales_bullet = "New partnership/contract—time a solution pitch";
    } else if (/(funding|investment|raise|earnings|revenue|profit|guidance)/i.test(both)) {
      out.sales_bullet = "Financial momentum—budget window to engage";
    } else if (/(launch|product|platform|feature|service|rollout)/i.test(both)) {
      out.sales_bullet = "New launch—attach integration/value add";
    } else if (/(regulation|compliance|security|risk|breach)/i.test(both)) {
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

async function callAzure(messages, maxTokens) {
  const body = {
    messages,
    temperature: 1,                          // gpt-5-mini requires 1
    max_completion_tokens: maxTokens,        // budget from env
    response_format: { type: "json_object" } // force JSON
  };
  const r = await axios.post(CHAT_URL, body, {
    headers: { "api-key": AZURE_KEY, "Content-Type": "application/json" },
    timeout: 30000
  });
  return r.data;
}

// ---------- main ----------
async function summarizeArticleForSales(article, companyName) {
  const sys = "You are a concise sales research assistant. Respond ONLY with valid JSON.";
  const usr = `
Company: ${companyName}

Article:
${JSON.stringify({
  id: article.id || null,
  title: article.title || "",
  url: article.url || "",
  description: article.description || "", 
  source: article.source || "",
  publishedAt: article.publishedAt || ""
}, null, 2)}

Task:
Return a JSON object with exactly these keys:
{
  "id": "<string or number>",
  "title": "<string>",
  "url": "<string>",
  "one_line_summary": "<one sentence, crisp>",
  "short_summary": "<2-3 sentences, factual, no fluff>",
  "sales_bullet": "<5-12 words, sales angle>",
  "suggested_question": "<one question a sales rep should ask>"
}
No extra commentary. JSON only.
  `.trim();

  let ai1 = null;
  try {
    // First pass (strict)
    ai1 = await callAzure(
      [{ role: "system", content: sys }, { role: "user", content: usr }],
      PER_ARTICLE_MAX_TOKENS
    );
    const content1 = ai1?.choices?.[0]?.message?.content || "";
    let parsed = tryParseJson(content1) || {};

    // Check empties
    const needsRepair =
      isBlank(parsed.one_line_summary) ||
      isBlank(parsed.short_summary) ||
      isBlank(parsed.sales_bullet) ||
      isBlank(parsed.suggested_question);

    if (!needsRepair) {
      return { ...parsed, _usage: ai1?.usage || null, _model: ai1?.model || null };
    }

    // Repair pass (only fill empties)
    const repSys = "You must output ONLY JSON with the required keys. Fill missing text tersely.";
    const repUsr = `
Fill any EMPTY fields below using the title/description context. JSON only.

Required keys:
id, title, url, one_line_summary, short_summary, sales_bullet, suggested_question.

Context:
Company: ${companyName}
Title: ${article.title || ""}
Description: ${article.description || ""}
URL: ${article.url || ""}
    `.trim();

    let ai2 = null;
    try {
      ai2 = await callAzure(
        [{ role: "system", content: repSys }, { role: "user", content: repUsr }],
        PER_ARTICLE_RETRY_TOKENS
      );
      const content2 = ai2?.choices?.[0]?.message?.content || "";
      const parsed2 = tryParseJson(content2) || parsed;

      // If still empty, force-fill heuristically without extra tokens
      const finalObj = forceFill(article, companyName, parsed2);
      return {
        ...finalObj,
        _usage: ai2?.usage || ai1?.usage || null,
        _model: ai2?.model || ai1?.model || null
      };
    } catch {
      // If repair call fails, force-fill from first pass + article metadata
      const finalObj = forceFill(article, companyName, parsed);
      return {
        ...finalObj,
        _usage: ai1?.usage || null,
        _model: ai1?.model || null
      };
    }
  } catch (e) {
    // Hard fail: return forced object from article metadata so merger still has substance
    const stub = forceFill(article, companyName, {
      id: article.id || null,
      title: article.title || "",
      url: article.url || "",
      one_line_summary: "",
      short_summary: "",
      sales_bullet: "",
      suggested_question: ""
    });
    return {
      ...stub,
      _usage: ai1?.usage || null,
      _model: ai1?.model || AZURE_DEPLOYMENT_NAME,
      _error: String(e?.response?.data?.error?.message || e.message || e),
    };
  }
}

module.exports = { summarizeArticleForSales };