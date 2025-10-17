// src/firestore/tokenLog.js
const { db, admin } = require("./init");

/**
 * Create a token log document linked to a report.
 * @param {Object} opts
 * @param {string} opts.reportId
 * @param {"map"|"merge"|"slides"|"other"} opts.stage
 * @param {string} opts.operation
 * @param {string|null} [opts.model]
 * @param {Object} [opts.usage]
 * @param {Object} [opts.meta]
 * @returns {Promise<string|null>} logId
 */
async function logTokenUsage({ reportId, stage, operation, model, usage = {}, meta = {} }) {
  try {
    const payload = {
      reportId: reportId || null,
      stage: stage || "other",
      operation: operation || "unknown",
      model: model || null,
      usage: usage || {},
      meta: meta || {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = await db.collection("token_logs").add(payload);
    return ref.id;
  } catch (e) {
    console.warn("logTokenUsage failed:", e.message);
    return null;
  }
}

module.exports = { logTokenUsage };