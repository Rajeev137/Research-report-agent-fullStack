# Research Report Agent — AI-Powered Sales Intelligence Platform

An end-to-end AI-driven research automation tool that fetches live news on a company, summarizes insights, generates polished PPT reports, enables one-click Gmail outreach, and even schedules follow-up meetings on Google Calendar — all from a single streamlined interface.

## Features Overview
Module																					Description
--------------------------------------------------------------------------------------------------------------------
AI News Research							Fetches company-related news using NewsAPI, processes articles using Azure OpenAI GPT-5 pipeline with retry logic & token optimization
Smart Report Generation						Generates structured sales-intelligence presentations (PowerPoint) with market positioning, insights, and opportunities
Automated Email Outreach					Sends follow-up outreach via Gmail API with generated pitch based on report context
Calendar Scheduling							Creates Google Calendar events with selected date & attendees — logged to backend with tracking
Firestore Integration						Stores reports, user profiles, history, and meeting logs with timestamp and latency tracking
Frontend Mobile/Web UI						Built using React Native (Expo) with a clean UI and complete flow integration
History & Logs								Every report generation and meeting is logged and retrievable in the History tab

## Tech Stack
Layer												Technologies Used
Frontend							React Native (Expo), Context API, AsyncStorage
Backend								Node.js (Express), Firebase Firestore, Google OAuth, Google APIs (Drive, Gmail, Calendar, Slides)
AI Layer							Azure OpenAI GPT Models with hybrid retry logic and multi-stage summarization
Auth & OAuth						Google OAuth 2.0 with refresh token storage & validation
Database							Firestore (reports, meetings, email logs)
File Generation						Google Slides API & custom PPT builder
News Aggregation					NewsAPI, multi-language support (en)
Deployment-ready					ENV-driven configuration, modular API routes

## Environment Variables (Backend)

	PORT=4000
	HOST=127.0.0.1
	
	# Firebase
	FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
	
	# NewsAPI
	NEWSAPI_KEY=
	NEWS_LANGUAGE=en,jp
	
	# Azure OpenAI
	AZURE_ENDPOINT=
	AZURE_KEY=
	AZURE_DEPLOYMENT_NAME=gpt-5-mini
	AZURE_API_VERSION=2025-04-01-preview
	
	# Token Strategy
	SALES_TOP_K=3
	PER_ARTICLE_MAX_TOKENS=800
	FINAL_MAX_COMPLETION_TOKENS=2200
	PER_ARTICLE_RETRY_TOKENS=400
	FINAL_RETRY_TOKENS=900
	
	# Google OAuth
	GOOGLE_CLIENT_ID=
	GOOGLE_CLIENT_SECRET=
	GOOGLE_REDIRECT_URI=http://127.0.0.1:4000/google/oauth2callback
	GOOGLE_TOKEN_PATH=./google_token.json
	GOOGLE_DRIVE_PARENT_FOLDER_ID=
	FALLBACK_USER_EMAIL=

## Running Locally

	cd research-report-backend
	npm install
	node src/server.js

## Frontend (Expo)
	
	cd research-report-frontend
	npm install
	npx expo start -c
	
	Make sure .env in frontend has:
	EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4000

## Typical Workflow

1.	Enter target company name → Generate report
2.	AI fetches news → Summarizes → Builds PowerPoint → Saves to Firestore
3.	From Action Bar:
	•	Send email → Gmail API
	•	Schedule follow-up → Google Calendar API
4.	All actions logged in History Tab.

## Difficulties Faced

•	OAuth callback issues across mobile vs localhost
•	Expo Go networking & ngrok-based redirect URI mismatch troubleshooting
•	Token optimization strategy to avoid Azure API overruns
•	Async UI polling for auth completion in mobile context
•	Handling Google APIs rate limits & event logging reliability


## Credits

Made with 🤍 by Rajeev Sharma
With help from Azure GPT-5 API, Google Cloud APIs, and a lot of debugging.







