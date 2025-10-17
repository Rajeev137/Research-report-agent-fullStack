const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_TOKEN_PATH = "./google_token.json",
} = process.env;

function getOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth env vars missing");
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function loadSavedToken(oauth2Client) {
  const p = path.resolve(GOOGLE_TOKEN_PATH);
  if (fs.existsSync(p)) {
    const token = JSON.parse(fs.readFileSync(p, "utf8"));
    oauth2Client.setCredentials(token);
    return true;
  }
  return false;
}

function saveToken(token) {
  const p = path.resolve(GOOGLE_TOKEN_PATH);
  fs.writeFileSync(p, JSON.stringify(token, null, 2), "utf8");
}

function getAuthUrl(scopes = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events"
]) {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });
}

module.exports = {
  getOAuth2Client,
  loadSavedToken,
  saveToken,
  getAuthUrl,
};