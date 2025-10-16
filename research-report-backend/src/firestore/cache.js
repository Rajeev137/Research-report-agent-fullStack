const { db } = require("./init");

// prefer exact domain match, otherwise most recent for company
async function checkRecentReport(companyName, domain = null, maxAgeHours = 7 * 24) {
  try {
    const q = await db.collection("reports")
      .where("companyName", "==", companyName)
      .orderBy("createdAt", "desc")
      .limit(8)
      .get();

    if (q.empty) return null;
    const now = Date.now();

    const normalizeDomain = (d) =>
      (d || "").toString().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");

    for (const doc of q.docs) {
      const data = doc.data();
      const createdAtMs = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().getTime() : null;
      const ageHours = createdAtMs ? (now - createdAtMs) / (1000 * 60 * 60) : Number.POSITIVE_INFINITY;
      if (createdAtMs && ageHours > maxAgeHours) continue;

      if (domain) {
        if (normalizeDomain(data.domainUsed) === normalizeDomain(domain)) {
          return { id: doc.id, data };
        }
      } else {
        return { id: doc.id, data };
      }
    }
    return null;
  } catch (e) {
    console.warn("checkRecentReport error:", e.message || e);
    return null;
  }
}

module.exports = { checkRecentReport };