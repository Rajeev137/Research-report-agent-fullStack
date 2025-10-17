require("dotenv").config();

const config = {
  PORT: process.env.PORT || 4000,
  SERVICE_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json",

  // Azure OpenAI
  AZURE_ENDPOINT: (process.env.AZURE_ENDPOINT || "").replace(/\/+$/, ""),
  AZURE_KEY: process.env.AZURE_KEY || process.env.AZURE_KEY || null,
  AZURE_DEPLOYMENT_NAME: process.env.AZURE_DEPLOYMENT_NAME || "gpt-5-mini",
  AZURE_API_VERSION: process.env.AZURE_API_VERSION || "2025-04-01-preview",

  // News
  NEWSAPI_KEY: process.env.NEWSAPI_KEY || "",

  // Pipeline knobs
  SALES_TOP_K: parseInt(process.env.SALES_TOP_K || "3", 10),
  PER_ARTICLE_MAX_TOKENS: parseInt(process.env.PER_ARTICLE_MAX_TOKENS || "300", 10),
  PER_ARTICLE_RETRY_TOKENS: parseInt(process.env.PER_ARTICLE_RETRY_TOKENS || "120", 10),
  FINAL_MAX_COMPLETION_TOKENS: parseInt(process.env.FINAL_MAX_COMPLETION_TOKENS || "3000", 10),
  FINAL_RETRY_TOKENS: parseInt(process.env.FINAL_RETRY_TOKENS || "400", 10),
};

module.exports = config;