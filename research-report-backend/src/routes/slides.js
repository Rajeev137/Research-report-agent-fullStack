const router = require("express").Router();
const { db, admin } = require("../firestore/init");
const { createDeckFromReport, getPreparedByInfo } = require("../google/slidesService");

router.post("/from-report", async (req, res) => {
  try {
    const { reportId } = req.body || {};
    if (!reportId) return res.status(400).json({ error: "reportId required" });

    // Load report
    const doc = await db.collection("reports").doc(reportId).get();
    if (!doc.exists) return res.status(404).json({ error: "report not found" });

    const report = doc.data();
    if (!report?.summary?.slides) {
      return res.status(400).json({ error: "report has no slides in summary" });
    }

    // Personalized "Prepared by …"
    const preparedBy = await getPreparedByInfo(req);

    // Create deck
    const meta = await createDeckFromReport(report, {
      title: `${report.companyName} — Sales Brief`,
      preparedBy
    });

    // Store links back on the report
    await db.collection("reports").doc(reportId).update({
      slidesFileId: meta.presentationId,
      slidesWebLink: meta.webViewLink,
      slidesPdfLink: meta.webExportPdf,
      slidesFolderId: meta.folderId || null,
      slidesCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true, ...meta });
  } catch (e) {
    console.error("slides/from-report failed:", e);
    return res.status(500).json({
      error: "slides_generation_failed",
      details: e.message || String(e),
    });
  }
});

module.exports = router;