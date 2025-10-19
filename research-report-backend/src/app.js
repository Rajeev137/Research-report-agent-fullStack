const express = require("express");
const cors = require("cors");

const healthRoute = require("./routes/health");     
const researchRoute = require("./routes/research");
const googleRoute = require("./google/routes");    
const slidesRoute = require("./routes/slides"); 
const researchAndSlidesRoute = require("./routes/researchAndSlides");    
const emailRoute = require("./routes/email");
const calendarRoute = require("./routes/calendar");

const app = express();
app.use(cors({
  origin: ['http://localhost:8081', 'http://127.0.0.1:8081'],
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));

app.use("/health", healthRoute);

app.use("/api/research", researchRoute);
app.use("/api/research-and-slides", researchAndSlidesRoute);

// Google auth + slides
app.use("/google", googleRoute);
app.use("/api/slides", slidesRoute);
app.use("/api/email", emailRoute);   
app.use("/api/calendar", calendarRoute);

module.exports = app;