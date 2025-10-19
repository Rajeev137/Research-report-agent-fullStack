const router = require("express").Router();
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { getOAuth2Client, loadSavedToken, saveToken, getAuthUrl } = require("./auth");

// Launch Google OAuth
router.get("/auth", (_req, res) => {
  try {
    const url = getAuthUrl();
    return res.redirect(url);
  } catch (e) {
    return res.status(500).json({ error: "oauth_init_failed", details: e.message });
  }
});
router.get("/debug", (req, res) => {
  res.json({
    env_REDIRECT: process.env.GOOGLE_REDIRECT_URI,
    final_expected: `https://${req.get("host")}/google/oauth2callback`,
    note: "Whatever env_REDIRECT is MUST be added in Google Cloud Console EXACTLY."
  });
});
// OAuth callback: exchange code -> save token
router.get("/oauth2callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");
    const oauth2Client = getOAuth2Client();

    const { tokens } = await oauth2Client.getToken(code);
    saveToken(tokens);
    oauth2Client.setCredentials(tokens);

    // Mark server-side as connected (sessionless detection for mobile app)
    globalThis.googleConnected = true;

    // Optional: fetch user profile (requires userinfo scopes)
    try {
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const me = await oauth2.userinfo.get();
      const name = me?.data?.name || me?.data?.given_name || "Google User";
      const email = me?.data?.email || "unknown@example.com";
      globalThis.googleProfile = { name, email };
    } catch {
      // If scopes didn't include userinfo or call failed, leave profile null
      globalThis.googleProfile = globalThis.googleProfile || null;
    }

    return res.send("Google auth success. Token saved. You can close this tab.");
  } catch (e) {
    return res.status(500).send("OAuth error: " + e.message);
  }
});

// Status endpoint: returns sessionless connection state
router.get("/status", (_req, res) => {
  try {
    const oauth2Client = getOAuth2Client();
    const ok = loadSavedToken(oauth2Client); // token file present & usable

    const connected = !!globalThis.googleConnected || !!ok;
    const authed = !!ok; // keep your original 'authed' for backwards compatibility
    const profile = globalThis.googleProfile || null; // { name, email } if available

    return res.json({ connected, authed, profile });
  } catch (e) {
    return res.status(500).json({ connected: false, authed: false, error: e.message });
  }
});

router.post("/revoke", async (_req, res) => {
  try {
    const tokenPath = path.resolve(process.env.GOOGLE_TOKEN_PATH || "./google_token.json");
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
    }
    // Clear server flags so /google/status won't report connected
    globalThis.googleConnected = false;
    globalThis.googleProfile = null;
    return res.json({ revoked: true });
  } catch (e) {
    return res.status(500).json({ revoked: false, error: e.message });
  }
});

module.exports = router;