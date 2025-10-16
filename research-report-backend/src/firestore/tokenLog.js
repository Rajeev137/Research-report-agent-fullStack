const { admin, db } = require("./init");

async function logTokenUsage({ source = "unknown", model = "unknown", usage = {} }) {
  try {
    const r = await db.collection("token_logs").add({
      source, model, usage,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return r.id;
  } catch (e) {
    console.warn("logTokenUsage failed:", e.message || e);
    return null;
  }
}

module.exports = { logTokenUsage };