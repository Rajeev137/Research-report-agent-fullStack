const router = require("express").Router();
const { google } = require("googleapis");
const { getOAuth2Client, loadSavedToken, saveToken, getAuthUrl } = require("./auth");

router.get("/auth", (_req, res) => {
  try {
    const url = getAuthUrl();
    return res.redirect(url);
  } catch (e) {
    return res.status(500).json({ error: "oauth_init_failed", details: e.message });
  }
});

router.get("/oauth2callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    saveToken(tokens);
    return res.send("Google auth success. Token saved. You can close this tab.");
  } catch (e) {
    return res.status(500).send("OAuth error: " + e.message);
  }
});

router.get("/status", (_req, res) => {
  try {
    const oauth2Client = getOAuth2Client();
    const ok = loadSavedToken(oauth2Client);
    return res.json({ authed: !!ok });
  } catch (e) {
    return res.status(500).json({ authed: false, error: e.message });
  }
});

module.exports = router;