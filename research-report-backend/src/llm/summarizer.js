const { callAzureChat, extractAiContent, tryParseJsonFromModel } = require("./azureClient");
const { PER_ARTICLE_MAX_TOKENS } = require("../config/env");
const { logTokenUsage } = require("../firestore/tokenLog");
const { safeTruncate } = require("../services/webService");

async function summarizeArticleForSales(article, companyName) {
  const systemMsg = { role: "system", content: "You are a concise sales summarizer. Output ONLY valid JSON." };
  const userMsg = {
    role: "user",
    content:
`COMPANY: ${companyName}
TITLE: ${safeTruncate(article.title || "", 240)}
URL: ${article.url || ""}
SOURCE: ${article.source || ""}
PUBLISHED_AT: ${article.publishedAt || ""}
DESCRIPTION: ${safeTruncate(article.description || "", 500)}

INSTRUCTIONS:
Return ONLY a JSON object:
{ "id": "${article.id || ""}", "title":"${safeTruncate(article.title || "", 200)}", "short_summary":"<1-2 sentence sales-focused summary>", "sales_bullet":"<5-12 word sales takeaway>", "url":"${article.url || ""}" }`
  };

  try {
    const ai = await callAzureChat([systemMsg, userMsg], PER_ARTICLE_MAX_TOKENS);
    if (ai?.usage) await logTokenUsage({ source: "per_article_initial", model: ai.model || "gpt-5-mini", usage: ai.usage });
    const txt = extractAiContent(ai) || "";
    const parsed = tryParseJsonFromModel(txt);
    if (parsed?.short_summary) {
      return { id: parsed.id || (article.id || ""), title: parsed.title || article.title || "", short_summary: parsed.short_summary, sales_bullet: parsed.sales_bullet || "", url: parsed.url || article.url || "" };
    }
  } catch (e) {
    console.warn("per-article LLM error:", e.message || e);
  }

  // fallback
  const fallbackSummary = safeTruncate((article.title || "") + " — " + (article.description || ""), 220);
  const fallbackBullet = safeTruncate((article.title || "").split(":")[0] || "Potential sales lead", 60);
  return { id: article.id || "", title: article.title || "", short_summary: fallbackSummary, sales_bullet: fallbackBullet, url: article.url || "" };
}

module.exports = { summarizeArticleForSales };