// src/routes/email.js
// Sends an email via Gmail API using your saved OAuth token.
// - Accepts reportId + optional to/subject/body
// - Builds a sane default email if subject/body omitted
// - Logs result to Firestore (emails collection) for traceability

const router = require("express").Router();
const { google } = require("googleapis");
const { db } = require("../firestore/init");

// Reuse your existing OAuth helper
function getGmailClient() {
  const { getOAuth2Client, loadSavedToken } = require("../google/auth");
  const auth = getOAuth2Client();
  const ok = loadSavedToken(auth);
  if (!ok) {
    const msg = "Google token missing. Visit /google/auth to grant access.";
    const err = new Error(msg);
    err.code = "NO_GOOGLE_TOKEN";
    throw err;
  }
  return google.gmail({ version: "v1", auth });
}

// Build an RFC 5322 (RFC822) email and base64url-encode it for Gmail API.
function buildRawEmail({ to, from, subject, html, text }) {
  const lines = [
    `To: ${to}`,
    `From: ${from || "me"}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    text
      ? "Content-Type: text/plain; charset=UTF-8"
      : "Content-Type: text/html; charset=UTF-8",
    "",
    text || html || "",
  ].join("\r\n");

  // Base64url (RFC 4648 §5) — Gmail requires -/_ and no padding
  return Buffer.from(lines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// helper: generate a default message from a report
function defaultEmailFromReport(report) {
  const company = report?.companyName || "your company";
  const slides = report?.slidesWebLink || "";
  const bullets =
    report?.summary?.slides?.[1]?.bullet_points?.slice(0, 3) || []; // Opportunities/Risks from slide 2

  const html = `
    <p>Hi,</p>
    <p>I'd like to schedule a short introduction regarding <b>${company}</b>.</p>
    ${slides ? `<p>Slides: <a href="${slides}">${slides}</a></p>` : ""}
    ${
      bullets.length
        ? `<p><b>Key points:</b></p><ul>${bullets
            .map((b) => `<li>${b}</li>`)
            .join("")}</ul>`
        : ""
    }
    <p>Best regards,</p>
  `.trim();

  const subject = `Intro meeting re: ${company}`;
  return { subject, html };
}

router.post("/send", async (req, res) => {
  const started = Date.now();
  try {
    const { reportId, to, subject, bodyHtml, bodyText } = req.body || {};
    if (!reportId) {
      return res.status(400).json({ error: "reportId required" });
    }

    // 1) Load report (for default subject/body and links)
    const doc = await db.collection("reports").doc(reportId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "report not found" });
    }
    const report = doc.data();

    // Recipient (demo default)
    const recipient = to || "ravtiraman041@gmail.com";

    // Build content
    let subj = subject;
    let html = bodyHtml;
    let text = bodyText;

    if (!subj || (!html && !text)) {
      const def = defaultEmailFromReport(report);
      subj = subj || def.subject;
      html = html || def.html;
    }

    const gmail = getGmailClient();
    const raw = buildRawEmail({
      to: recipient,
      from: process.env.FALLBACK_USER_EMAIL || "me", // "me" uses the authorized account
      subject: subj,
      html,
      text,
    });

    // 2) Send email
    const sendResp = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    // 3) Log to Firestore (emails collection)
    const log = {
      reportId,
      to: recipient,
      subject: subj,
      gmailMessageId: sendResp?.data?.id || null,
      threadId: sendResp?.data?.threadId || null,
      status: "sent",
      createdAt: new Date(),
      latencyMs: Date.now() - started,
    };
    const logRef = await db.collection("emails").add(log);

    return res.json({
      ok: true,
      gmailMessageId: log.gmailMessageId,
      threadId: log.threadId,
      emailLogId: logRef.id,
      latencyMs: log.latencyMs,
    });
  } catch (e) {
    // Granular error to help you debug quickly
    const status = e?.response?.status || 500;
    const apiErr = e?.response?.data?.error || e.message || String(e);

    // Log failure too (so you can inspect later)
    try {
      await db.collection("emails").add({
        reportId: req.body?.reportId || null,
        to: req.body?.to || null,
        subject: req.body?.subject || null,
        status: "failed",
        error: typeof apiErr === "string" ? apiErr : JSON.stringify(apiErr),
        createdAt: new Date(),
      });
    } catch (_) {}

    return res
      .status(status >= 400 && status < 600 ? status : 500)
      .json({ error: "email_send_failed", details: apiErr });
  }
});

module.exports = router;