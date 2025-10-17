require("dotenv").config();
const app = require("./app");

const { admin } = require("./firestore/init");

const PORT = process.env.PORT || 4000;

// Azure env checks
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_KEY;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_DEPLOYMENT_NAME || "gpt-5-mini";

// Google env checks
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

app.listen(PORT, () => {
  console.log(`\n🚀 Research Agent backend running on port ${PORT}`);
  console.log(`Firebase project_id = ${admin.app().options.credential.projectId || "unknown"}`);

  console.log(`Azure endpoint present: ${!!AZURE_OPENAI_ENDPOINT}  key present: ${!!AZURE_OPENAI_API_KEY}  deployment: ${AZURE_OPENAI_DEPLOYMENT}`);
  console.log(`Google OAuth configured: ${!!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET && !!GOOGLE_REDIRECT_URI}`);

});