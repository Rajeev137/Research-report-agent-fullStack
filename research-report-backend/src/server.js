const app = require("./app");
const { serviceAccount } = require("./firestore/init");
const { PORT, AZURE_ENDPOINT, AZURE_KEY, SALES_TOP_K, PER_ARTICLE_MAX_TOKENS, FINAL_MAX_COMPLETION_TOKENS } = require("./config/env");

app.listen(PORT, () => {
  console.log(`Hybrid Research Agent listening on port ${PORT}`);
  try { console.log("Firebase project_id=", serviceAccount.project_id); } catch {}
  console.log("Azure endpoint present:", !!AZURE_ENDPOINT, "Azure key present:", !!AZURE_KEY);
  console.log("SALES_TOP_K:", SALES_TOP_K, "PER_ARTICLE_MAX_TOKENS:", PER_ARTICLE_MAX_TOKENS, "FINAL_MAX_COMPLETION_TOKENS:", FINAL_MAX_COMPLETION_TOKENS);
});