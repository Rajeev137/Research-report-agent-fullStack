const axios = require("axios");
const {
  AZURE_ENDPOINT, AZURE_KEY, AZURE_DEPLOYMENT_NAME, AZURE_API_VERSION,
  PER_ARTICLE_MAX_TOKENS
} = require("../config/env");

async function callAzureChat(messages, maxTokens = PER_ARTICLE_MAX_TOKENS, deployment = AZURE_DEPLOYMENT_NAME) {
  if (!AZURE_ENDPOINT || !AZURE_KEY) throw new Error("Azure OpenAI not configured");
  const url = `${AZURE_ENDPOINT}/openai/deployments/${deployment}/chat/completions?api-version=${AZURE_API_VERSION}`;
  const body = { messages, max_completion_tokens: maxTokens };
  const resp = await axios.post(url, body, {
    headers: { "Content-Type": "application/json", "api-key": AZURE_KEY },
    timeout: 60000,
  });
  return resp.data;
}

function extractAiContent(ai) {
  if (!ai) return "";
  try {
    if (ai.choices?.length) {
      const ch = ai.choices[0];
      if (ch.message?.content) return ch.message.content;
      if (typeof ch.text === "string") return ch.text;
    }
  } catch {}
  return "";
}

function tryParseJsonFromModel(content) {
  if (!content || typeof content !== "string") return null;
  try { return JSON.parse(content); } catch {}
  const m = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/m);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

module.exports = { callAzureChat, extractAiContent, tryParseJsonFromModel };