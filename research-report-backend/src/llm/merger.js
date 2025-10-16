const { unifiedPrompt } = require("./prompts");
const {
  callAzureChat,
  extractAiContent,
  tryParseJsonFromModel,
} = require("./azureClient");
const {
  FINAL_MAX_COMPLETION_TOKENS,
  FINAL_RETRY_TOKENS,
} = require("../config/env");
const { validateFinal } = require("./schema");
const { logTokenUsage } = require("../firestore/tokenLog");
const { safeTruncate } = require("../services/webService");

async function mergeSummariesToFinal(companyName, perArticleSummaries) {
  const systemMsg = { role: "system", content: unifiedPrompt };

  const userMsg = {
    role: "user",
    content: `COMPANY: ${companyName}

ARTICLES (as JSON):
${JSON.stringify(perArticleSummaries, null, 2)}

Return ONLY valid JSON as per the OUTPUT FORMAT in the system prompt.`,
  };

  // initial attempt
  try {
    const ai = await callAzureChat(
      [systemMsg, userMsg],
      FINAL_MAX_COMPLETION_TOKENS
    );
    const raw = extractAiContent(ai) || "";
    if (ai?.usage)
      await logTokenUsage({
        source: "final_initial",
        model: ai.model || "gpt-5-mini",
        usage: ai.usage,
      });

    const parsed = tryParseJsonFromModel(raw);
    if (parsed) {
      const valid = validateFinal(parsed);
      if (!valid) parsed._validationErrors = validateFinal.errors;
      return {
        parsed,
        raw,
        usage: ai.usage || null,
        validated: validateFinal(parsed),
      };
    }

    // repair attempt
    const example = {
      company: companyName,
      company_overview: `${companyName} is an example company...`,
      highlights: perArticleSummaries.map((s) => ({
        title: s.title || "",
        url: s.url || "",
        one_line_summary: safeTruncate(s.short_summary || "", 200),
        sales_bullet: s.sales_bullet || "",
        suggested_question: "Who is procurement lead?",
      })),
      slides: [
        {
          slide_number: 1,
          slide_title: "Key Facts",
          bullet_points: perArticleSummaries.map((s) =>
            safeTruncate(s.short_summary || "", 80)
          ),
        },
        {
          slide_number: 2,
          slide_title: "Opportunities & Risks",
          bullet_points: perArticleSummaries.map((s) =>
            safeTruncate(s.sales_bullet || "", 80)
          ),
        },
        {
          slide_number: 3,
          slide_title: "Questions & Next Steps",
          bullet_points: [
            "Who owns procurement?",
            "Next action: outreach",
            "Request product roadmap",
          ],
        },
      ],
    };
    const repairMsg = {
      role: "user",
      content: `The previous output was not valid JSON.

BROKEN OUTPUT (truncated):
${safeTruncate(raw, 2000)}

Please re-emit ONLY valid JSON exactly matching the OUTPUT FORMAT from the system prompt.`,
    };

    const aiRepair = await callAzureChat(
      [systemMsg, repairMsg],
      FINAL_RETRY_TOKENS
    );
    const repairRaw = extractAiContent(aiRepair) || "";
    if (aiRepair?.usage)
      await logTokenUsage({
        source: "final_repair",
        model: aiRepair.model || "gpt-5-mini",
        usage: aiRepair.usage,
      });
    const repairParsed = tryParseJsonFromModel(repairRaw);
    if (repairParsed) {
      const valid2 = validateFinal(repairParsed);
      if (!valid2) repairParsed._validationErrors = validateFinal.errors;
      return {
        parsed: repairParsed,
        raw: repairRaw,
        usage: aiRepair.usage || null,
        validated: validateFinal(repairParsed),
      };
    }

    // fallback object
    const fallback = {
      company: companyName,
      company_overview: `${companyName} — summary generated from article summaries.`,
      highlights: perArticleSummaries.map((s) => ({
        title: s.title || "",
        url: s.url || "",
        one_line_summary: safeTruncate(s.short_summary || "", 200),
        sales_bullet: s.sales_bullet || "",
        suggested_question: "Can you share procurement contacts?",
      })),
      slides: [
        {
          slide_number: 1,
          slide_title: "Key Facts",
          bullet_points: perArticleSummaries.map((s) =>
            safeTruncate(s.short_summary || "", 80)
          ),
        },
        {
          slide_number: 2,
          slide_title: "Opportunities & Risks",
          bullet_points: perArticleSummaries.map((s) =>
            safeTruncate(s.sales_bullet || "", 80)
          ),
        },
        {
          slide_number: 3,
          slide_title: "Questions & Next Steps",
          bullet_points: [
            "Who owns procurement?",
            "Next action: outreach",
            "Follow-up",
          ],
        },
      ],
    };
    return { parsed: fallback, raw, usage: ai?.usage || null, fallback: true };
  } catch (e) {
    console.warn("mergeSummariesToFinal error:", e.message || e);
    const fallback = {
      company: companyName,
      company_overview: `${companyName} — fallback summary due to LLM error.`,
      highlights: perArticleSummaries.map((s) => ({
        title: s.title || "",
        url: s.url || "",
        one_line_summary: s.short_summary || "",
        sales_bullet: s.sales_bullet || "",
        suggested_question: "Can you share procurement contacts?",
      })),
      slides: [
        {
          slide_number: 1,
          slide_title: "Key Facts",
          bullet_points: perArticleSummaries.map((s) =>
            safeTruncate(s.short_summary || "", 80)
          ),
        },
        {
          slide_number: 2,
          slide_title: "Opportunities",
          bullet_points: perArticleSummaries.map((s) =>
            safeTruncate(s.sales_bullet || "", 80)
          ),
        },
        {
          slide_number: 3,
          slide_title: "Questions",
          bullet_points: ["Who is procurement?", "Next action", "Follow up"],
        },
      ],
    };
    return {
      parsed: fallback,
      raw: "",
      usage: null,
      error: e.message || e,
      fallback: true,
    };
  }
}

module.exports = { mergeSummariesToFinal };
