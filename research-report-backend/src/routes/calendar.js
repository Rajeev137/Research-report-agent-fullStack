// src/routes/calendar.js
// Schedule a calendar event (no Google Meet yet).
// Defaults:
//  - No date provided -> next week at 12:00 (noon) local server time
//  - Date without time -> that date at 12:00 (noon)
//  - durationMins default 30
//  - attendees default to your test email
//
// Request body:
//  {
//    "reportId": "abc123", // required
//    "date": "2025-10-28", // optional (YYYY-MM-DD) or ISO "2025-10-28T12:00:00+05:30"
//    "durationMins": 30,    // optional
//    "title": "Intro: <Company> x Otsuka", // optional (fallback built from report)
//    "attendees": ["someone@example.com"]   // optional
//    "timezone": "Asia/Kolkata"             // optional (default: server local tz via Date ISO output)
//  }

const router = require("express").Router();
const { google } = require("googleapis");
const { db } = require("../firestore/init");

// Reuse your OAuth helper
function getCalendarClient() {
  const { getOAuth2Client, loadSavedToken } = require("../google/auth");
  const auth = getOAuth2Client();
  if (!loadSavedToken(auth)) {
    const err = new Error("Google token missing. Visit /google/auth to grant access.");
    err.code = "NO_GOOGLE_TOKEN";
    throw err;
  }
  return google.calendar({ version: "v3", auth });
}

// Set to noon if only date is provided ("YYYY-MM-DD")
function toNoon(dateOnlyStr, tz) {
  // We’ll interpret date-only in server local timezone and set 12:00:00
  const d = dateOnlyStr ? new Date(dateOnlyStr) : new Date();
  // If dateOnlyStr was invalid, Date will be "Invalid Date"; fall back to nextWeekNoon()
  if (isNaN(d.getTime())) return nextWeekNoon();
  d.setHours(12, 0, 0, 0);
  return d;
}

// If nothing provided, schedule one week from now at noon
function nextWeekNoon() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(12, 0, 0, 0);
  return d;
}

// Parse date input:
// - ISO datetime -> use as-is
// - YYYY-MM-DD -> set noon
// - missing/invalid -> next week noon
function parseStartDateTime(input, tz) {
  if (!input) return nextWeekNoon();

  // Looks like YYYY-MM-DD only
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return toNoon(input, tz);
  }

  // Try ISO or other formats accepted by Date
  const d = new Date(input);
  if (!isNaN(d.getTime())) return d;

  // Fallback
  return nextWeekNoon();
}

router.post("/schedule", async (req, res) => {
  const started = Date.now();
  try {
    const { reportId, date, durationMins = 30, title, attendees = [], timezone } = req.body || {};
    if (!reportId) return res.status(400).json({ error: "reportId required" });

    // Load report to build a default title/description
    const doc = await db.collection("reports").doc(reportId).get();
    if (!doc.exists) return res.status(404).json({ error: "report not found" });
    const report = doc.data();

    const start = parseStartDateTime(date, timezone);
    const end = new Date(start.getTime() + durationMins * 60000);

    const summary = title || `Intro: ${report.companyName} x Otsuka`;
    const description = `Discussion about ${report.companyName}.\nSlides: ${report.slidesWebLink || "N/A"}`;

    // Default attendee (your test email) if none provided
    const guestList = (Array.isArray(attendees) && attendees.length ? attendees : [ "ravtiraman041@gmail.com" ])
      .filter(Boolean)
      .map(e => ({ email: e }));

    const cal = getCalendarClient();

    // Build event without Google Meet (no conferenceData)
    const event = {
      summary,
      description,
      start: { dateTime: start.toISOString(), timeZone: timezone || undefined },
      end:   { dateTime: end.toISOString(),   timeZone: timezone || undefined },
      attendees: guestList,
      // No conferenceData here (Meet intentionally skipped)
    };

    const created = await cal.events.insert({
      calendarId: "primary",
      requestBody: event,
      sendUpdates: "all" // emails attendees
    });

    const data = created.data;

    // Log to Firestore "meetings"
    const log = {
      reportId,
      eventId: data.id,
      htmlLink: data.htmlLink || null,
      start: start.toISOString(),
      end: end.toISOString(),
      durationMins,
      attendees: guestList.map(a => a.email),
      summary,
      description,
      createdAt: new Date(),
      latencyMs: Date.now() - started
    };

    const ref = await db.collection("meetings").add(log);

    return res.json({
      ok: true,
      eventId: data.id,
      htmlLink: data.htmlLink || null,
      meetingLogId: ref.id,
      start: log.start,
      end: log.end,
      attendees: log.attendees
    });
  } catch (e) {
    const status = e?.response?.status || 500;
    const details = e?.response?.data?.error || e.message || String(e);

    // Log failures too for debugging history
    try {
      await db.collection("meetings").add({
        reportId: req.body?.reportId || null,
        status: "failed",
        error: typeof details === "string" ? details : JSON.stringify(details),
        payload: req.body || null,
        createdAt: new Date()
      });
    } catch (_) {}

    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: "calendar_schedule_failed",
      details
    });
  }
});

module.exports = router;