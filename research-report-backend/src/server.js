require("dotenv").config();
const http = require("http");
const app = require("./app");
const { admin } = require("./firestore/init");

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "127.0.0.1";

// Optional: env checks just for logging
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_KEY;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_DEPLOYMENT_NAME || "gpt-5-mini";
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  console.log(`\n🚀 Research Agent backend listening on http://${HOST}:${PORT}`);
  try {
    console.log(`Firebase project_id = ${admin.app().options.credential.projectId || "unknown"}`);
  } catch {
    console.log("Firebase project_id = (unavailable)");
  }
  console.log(
    `Azure endpoint present: ${!!AZURE_OPENAI_ENDPOINT}  key present: ${!!AZURE_OPENAI_API_KEY}  deployment: ${AZURE_OPENAI_DEPLOYMENT}`
  );
  console.log(
    `Google OAuth configured: ${!!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET && !!GOOGLE_REDIRECT_URI}`
  );
});

