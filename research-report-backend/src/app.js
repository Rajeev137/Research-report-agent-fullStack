const express = require("express");
const cors = require("cors");
const researchRoute = require("./routes/research");
const healthRoute = require("./routes/health");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/research", researchRoute);
app.use("/health", healthRoute);

module.exports = app;