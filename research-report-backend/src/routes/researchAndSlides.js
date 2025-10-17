// Combines: /api/research  -> then /api/slides/from-report
// into ONE single endpoint.

const router = require("express").Router();
const axios = require("axios");
const { PORT } = require("../config/env");

router.post("/", async (req, res) => {
  try {
    // Step 1: Trigger research
    const researchResponse = await axios.post(
      `http://localhost:${PORT}/api/research`,
      req.body,
      { timeout: 180000 }
    );

    const report = researchResponse.data?.report;
    const cached = researchResponse.data?.cached || false;

    if (!report?.firestoreId) {
      return res.status(500).json({
        error: "research_failed_or_no_report_id",
        details: researchResponse.data
      });
    }

    // Step 2: Trigger slide generation
    const slidesResponse = await axios.post(
      `http://localhost:${PORT}/api/slides/from-report`,
      { reportId: report.firestoreId },
      { timeout: 180000 }
    );

    return res.json({
      ok: true,
      cached,
      reportId: report.firestoreId,
      reportSummary: report.summary,
      slideLinks: slidesResponse.data, // contains { presentationId, webViewLink, webExportPdf, ... }
    });

  } catch (err) {
    console.error("research-and-slides FAILED:", err);
    return res.status(500).json({
      error: "research_and_slides_failed",
      details: err.message
    });
  }
});

module.exports = router;