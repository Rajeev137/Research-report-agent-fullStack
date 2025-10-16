const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const { SERVICE_PATH } = require("../config/env");

if (!fs.existsSync(SERVICE_PATH)) {
  console.error("FIREBASE SERVICE ACCOUNT JSON NOT FOUND at", SERVICE_PATH);
  process.exit(1);
}
const serviceAccount = require(path.resolve(SERVICE_PATH));
try {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (e) {
  console.warn("Firebase init warning:", e.message || e);
}

const db = admin.firestore();

module.exports = { admin, db, serviceAccount };