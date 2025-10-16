# Research Report Agent (Phase 1)

A mobile-ready backend that fetches company news, summarizes with a hybrid LLM pipeline, and produces a 3-slide sales brief — all cached in Firestore.

## ✅ Current Status (16 Oct 2025)
- **Hybrid LLM pipeline** (rank → per-article summary → final merge) with clean JSON
- **Firestore**: reports caching, token usage logs
- **Unified prompt** integrated for consistent, high-quality final output
- **Azure OpenAI** configuration fixed and stable

## 🚀 What’s Next
- **Google Slides generation**: create a live deck from the JSON slides and save the link
- **Google OAuth**: one-time consent and token storage for Slides/Drive
- **(Planned) Lightweight RAG**: ground the LLM on fetched web content/news to reduce hallucinations

> Order I propose: Slides + OAuth next (user-facing win), then a minimal RAG layer (chunk + retrieve) before UI polish.

---

## Tech Stack
- **Node.js**, **Express**
- **Azure OpenAI** (`gpt-5-mini`) — chat completions (`max_completion_tokens` only)
- **Firestore** via `firebase-admin`
- **NewsAPI** + **Google News** fallback (scrape)
- **AJV** for JSON schema validation

---

## Folder Structure
src/
app.js                # express app wiring
server.js             # server start
config/env.js         # env + pipeline knobs
firestore/
init.js             # firebase-admin init
cache.js            # prefer exact-domain cached report
tokenLog.js         # token usage logger
llm/
azureClient.js      # Azure chat wrapper + JSON parsing
summarizer.js       # per-article summarizer (map)
merger.js           # final merge (reduce) + repair
schema.js           # AJV final schema
prompts.js          # unified prompt (final merge)
services/
newsService.js      # NewsAPI + Google News, ranking
webService.js       # website fetch + text extraction
routes/
research.js         # POST /api/research
health.js           # GET /health

---

## Setup

### 1) Install
```bash
npm install
# if not done yet:
npm i express axios cheerio cors firebase-admin ajv dotenv

2) Environment

Create .env:
PORT=4000
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json

# Azure OpenAI
AZURE_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_KEY=<your-azure-key>
AZURE_DEPLOYMENT_NAME=gpt-5-mini
AZURE_API_VERSION=2025-04-01-preview

# News
NEWSAPI_KEY=<optional-but-recommended>

# Pipeline knobs
SALES_TOP_K=3
PER_ARTICLE_MAX_TOKENS=500
FINAL_MAX_COMPLETION_TOKENS=3000
PER_ARTICLE_RETRY_TOKENS=128
FINAL_RETRY_TOKENS=512

Put your Firebase service account at ./serviceAccountKey.json (or update the path).

3) Run
node src/server.js

API

Health
GET /health
→ { ok: true, ts: "..." }

Research
POST /api/research
Body:
{
  "companyName": "Siemens AG",
  "domain": "www.siemens.com",   // optional, improves website fetch & cache key
  "force": true                  // optional; skip cache if true
}

Response (abridged):
{
  "cached": false,
  "elapsedMs": 12345,
  "report": {
    "companyName": "Siemens AG",
    "domainUsed": "www.siemens.com",
    "website": "https://www.siemens.com",
    "website_text": "....",
    "news": [{ "title":"...", "url":"...", "relevanceScore": 7.1 }],
    "perArticleSummaries": [
      { "id":"...", "title":"...", "short_summary":"...", "sales_bullet":"...", "url":"..." }
    ],
    "summary": {
      "company": "Siemens AG",
      "company_overview": "...",
      "highlights": [
        { "id":"...", "title":"...", "url":"...", "one_line_summary":"...", "sales_bullet":"...", "suggested_question":"..." }
      ],
      "slides": [
        { "slide_number":1, "slide_title":"Key Facts & Summary", "bullet_points":["..."] },
        { "slide_number":2, "slide_title":"Sales Opportunities & Risks", "bullet_points":["..."] },
        { "slide_number":3, "slide_title":"Questions & Next Steps", "bullet_points":["..."] }
      ]
    },
    "firestoreId": "..."
  }
}

Firestore Collections
	•	reports: one doc per generated report (input, news, summaries, final JSON, links later)
	•	token_logs: one doc per LLM call with usage stats

RAG (Planned)

Goal: reduce hallucinations and improve grounding.
	•	Minimal plan: chunk website_text + top news pages → embed (small model) → store vectors (Pinecone or local/Chroma) → during final merge, retrieve top chunks and pass as context.
	•	Why after Slides/Auth? Slides+OAuth deliver an immediate, visible win; RAG then improves accuracy without blocking demos.

Troubleshooting
	•	Azure error / fallback JSON
	•	Check .env: endpoint must be like https://<name>.openai.azure.com (no trailing /openai)
	•	AZURE_DEPLOYMENT_NAME must match your deployment name in Azure
	•	AZURE_API_VERSION=2025-04-01-preview
	•	Don’t send temperature for gpt-5-mini (defaults to 1)
	•	Cache not hit
	•	Cache prefers exact domain; pass domain consistently
	•	Weird news
	•	We rank with sales keywords + source freshness; tune SALES_KEYWORDS if needed

License

MIT