// src/routes/calendar.js
// Schedule a calendar event (no Google Meet yet).
// Updated to support { dateISO, timeHHmm } from frontend properly

const router = require("express").Router();
const { google } = require("googleapis");
const { db } = require("../firestore/init");

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

// DEFAULTS — still kept as fallback logic
function toNoon(dateOnlyStr) {
  const d = dateOnlyStr ? new Date(dateOnlyStr) : new Date();
  if (isNaN(d.getTime())) return nextWeekNoon();
  d.setHours(12, 0, 0, 0);
  return d;
}
function nextWeekNoon() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(12, 0, 0, 0);
  return d;
}
function parseStartDateTime(input) {
  if (!input) return nextWeekNoon();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return toNoon(input);
  const d = new Date(input);
  return !isNaN(d.getTime()) ? d : nextWeekNoon();
}

router.post("/schedule", async (req, res) => {
  const started = Date.now();

  try {
    console.log("[CALENDAR] Incoming body:", req.body);

    const {
      reportId,
      dateISO,      // ✅ New fields from frontend
      timeHHmm,     // ✅ New fields from frontend
      durationMins = 30,
      title,
      attendees = [],
      timezone
    } = req.body || {};

    if (!reportId) return res.status(400).json({ error: "reportId required" });

    // Load report
    const doc = await db.collection("reports").doc(reportId).get();
    if (!doc.exists) return res.status(404).json({ error: "report not found" });
    const report = doc.data();

    // ✅ NEW LOGIC: Honor dateISO + timeHHmm properly
    let start;
    if (dateISO && timeHHmm) {
      start = new Date(`${dateISO}T${timeHHmm}:00`);
      console.log(`[CALENDAR] Using explicit date & time: ${start.toISOString()}`);
    } else if (dateISO) {
      start = new Date(`${dateISO}T12:00:00`);
      console.log(`[CALENDAR] Only date provided → defaulting to 12:00: ${start.toISOString()}`);
    } else {
      start = parseStartDateTime(null);
      console.log(`[CALENDAR] No date provided → fallback next week noon: ${start.toISOString()}`);
    }

    const end = new Date(start.getTime() + durationMins * 60000);

    const summary = title || `Intro: ${report.companyName} x Otsuka`;
    const description = `Discussion about ${report.companyName}.\nSlides: ${report.slidesWebLink || "N/A"}`;

    const guestList = (Array.isArray(attendees) && attendees.length ? attendees : ["ravtiraman041@gmail.com"])
      .filter(Boolean)
      .map(e => ({ email: e }));

    const cal = getCalendarClient();

    const event = {
      summary,
      description,
      start: { dateTime: start.toISOString(), timeZone: timezone || undefined },
      end: { dateTime: end.toISOString(), timeZone: timezone || undefined },
      attendees: guestList,
    };

    console.log("[CALENDAR] Creating Google Calendar event:", JSON.stringify(event, null, 2));

    const created = await cal.events.insert({
      calendarId: "primary",
      requestBody: event,
      sendUpdates: "all"
    });

    const data = created.data;

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
    console.error("[CALENDAR] Error:", e);
    const status = e?.response?.status || 500;
    const details = e?.response?.data?.error || e.message || String(e);

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