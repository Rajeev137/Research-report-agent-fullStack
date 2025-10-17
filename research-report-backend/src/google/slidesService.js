// src/google/slidesService.js
// Builds a full slide deck:
// 1) Delete Google's default slide
// 2) Custom BLANK cover (company + Prepared by)
// 3) Presenter Intro (name, role, contact)
// 4) Company Intro (overview bullets)
// 5) Append 3 LLM slides (Key Facts, Opportunities, Questions)

const { google } = require("googleapis");
const { getOAuth2Client, loadSavedToken } = require("./auth");

const RAW_PARENT = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || "";

/** Extracts folder ID from URL or returns the value as-is if it's already an ID */
function extractFolderId(input) {
  if (!input) return null;
  const m = String(input).match(/(?:\/folders\/|[\?&]id=)([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return input;
}
const GOOGLE_DRIVE_PARENT_FOLDER_ID = extractFolderId(RAW_PARENT);

/** OAuth clients */
function getClients() {
  const auth = getOAuth2Client();
  if (!loadSavedToken(auth)) {
    throw new Error("Google token not found. Visit /google/auth to authorize first.");
  }
  const slides = google.slides({ version: "v1", auth });
  const drive  = google.drive({ version: "v3", auth });
  return { slides, drive };
}

/** Ensure a destination folder (or use configured parent) */
async function ensureFolder(drive, name = "Research-Decks") {
  if (GOOGLE_DRIVE_PARENT_FOLDER_ID) return GOOGLE_DRIVE_PARENT_FOLDER_ID;

  const q = "mimeType='application/vnd.google-apps.folder' and name='" +
            name.replace(/'/g,"\\'") + "' and trashed=false";
  const list = await drive.files.list({
    q, fields: "files(id,name)", pageSize: 1,
    supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  if (list.data.files?.length) return list.data.files[0].id;

  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder" },
    fields: "id", supportsAllDrives: true
  });
  return created.data.id;
}

/** Demo-friendly public share */
async function shareFilePublic(drive, fileId) {
  await drive.permissions.create({
    fileId, supportsAllDrives: true,
    requestBody: { role: "reader", type: "anyone" }
  });
}

/** “Prepared by …” (from session if available; env fallback) */
async function getPreparedByInfo(req) {
  const name  = req?.session?.user?.name  || process.env.FALLBACK_USER_NAME  || "RAJEEV SHARMA";
  const role  = req?.session?.user?.title || process.env.FALLBACK_USER_TITLE || "Sales Executive";
  const org   = process.env.FALLBACK_USER_ORG || "Otsuka";
  const email = req?.session?.user?.email || process.env.FALLBACK_USER_EMAIL || "";
  const phone = process.env.FALLBACK_USER_PHONE || "";
  return { name, role, org, email, phone };
}

/** Delete default first slide to avoid “Click to add title” */
async function deleteDefaultFirstSlide(slides, presentationId) {
  const pres = await slides.presentations.get({ presentationId });
  if (!pres?.data?.slides?.length) return null;
  const firstSlideId = pres.data.slides[0].objectId;

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: { requests: [{ deleteObject: { objectId: firstSlideId } }] }
  });
  return firstSlideId;
}

/** Utility to create a text box at (x,y) with size (w,h) */
function createTextBox({ objectId, pageObjectId, x=50, y=50, w=600, h=60 }) {
  return {
    createShape: {
      objectId,
      shapeType: "TEXT_BOX",
      elementProperties: {
        pageObjectId,
        size: { width: { magnitude: w, unit: "PT" }, height: { magnitude: h, unit: "PT" } },
        transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "PT" }
      }
    }
  };
}

/** COVER: BLANK slide with title + subtitle */
async function createCoverSlide(slides, presentationId, company, preparedBy) {
  const coverId   = `cover_${Date.now()}`;
  const headingId = `cover_title_${Date.now()}`;
  const subId     = `cover_sub_${Date.now()}`;

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: {
      requests: [
        { createSlide: { objectId: coverId, slideLayoutReference: { predefinedLayout: "BLANK" } } },
        createTextBox({ objectId: headingId, pageObjectId: coverId, x: 50, y: 80,  w: 620, h: 80 }),
        createTextBox({ objectId: subId,     pageObjectId: coverId, x: 50, y: 170, w: 620, h: 60 }),
      ]
    }
  });

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: {
      requests: [
        { insertText: { objectId: headingId, text: `${company} — Sales Brief` } },
        { updateTextStyle: { objectId: headingId, style: { bold: true, fontSize: { magnitude: 30, unit: "PT" } }, fields: "bold,fontSize" } },
        { insertText: { objectId: subId, text: `Prepared by ${preparedBy.name} — ${preparedBy.role}, ${preparedBy.org}` } },
        { updateTextStyle: { objectId: subId, style: { fontSize: { magnitude: 14, unit: "PT" } }, fields: "fontSize" } }
      ]
    }
  });

  return coverId;
}

/** PRESENTER INTRO: name, role, org, contact */
async function createPresenterIntroSlide(slides, presentationId, preparedBy, insertionIndex = 1) {
  const slideId  = `presenter_${Date.now()}`;
  const titleId  = `${slideId}_title`;
  const bodyId   = `${slideId}_body`;

  const bullets = [
    `${preparedBy.role}, ${preparedBy.org}`,
    preparedBy.email ? `Email: ${preparedBy.email}` : null,
    preparedBy.phone ? `Phone: ${preparedBy.phone}` : null,
  ].filter(Boolean).join("\n");

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: {
      requests: [
        { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: "BLANK" }, insertionIndex } },
        createTextBox({ objectId: titleId, pageObjectId: slideId, x: 50, y: 50,  w: 640, h: 60 }),
        { insertText: { objectId: titleId, insertionIndex: 0, text: `About the Presenter — ${preparedBy.name}` } },
        createTextBox({ objectId: bodyId,  pageObjectId: slideId, x: 50, y: 130, w: 640, h: 360 }),
        { insertText: { objectId: bodyId, insertionIndex: 0, text: bullets || `${preparedBy.role}, ${preparedBy.org}` } },
        { createParagraphBullets: { objectId: bodyId, textRange: { type: "ALL" }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } },
      ]
    }
  });

  return slideId;
}

/** COMPANY INTRO: overview paragraph split into bullets */
function splitOverviewToBullets(text, maxBullets = 4) {
  if (!text) return [];
  const parts = text.replace(/\s+/g, " ").split(/(?<=\.)\s+/).filter(Boolean);
  if (!parts.length) return [text];
  return parts.slice(0, maxBullets);
}

async function createCompanyIntroSlide(slides, presentationId, company, overview, insertionIndex = 2) {
  const slideId = `company_${Date.now()}`;
  const titleId = `${slideId}_title`;
  const bodyId  = `${slideId}_body`;
  const bullets = splitOverviewToBullets(overview);

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: {
      requests: [
        { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: "BLANK" }, insertionIndex } },
        createTextBox({ objectId: titleId, pageObjectId: slideId, x: 50, y: 50,  w: 640, h: 60 }),
        { insertText: { objectId: titleId, insertionIndex: 0, text: `${company} — Company Overview` } },
        createTextBox({ objectId: bodyId,  pageObjectId: slideId, x: 50, y: 130, w: 640, h: 360 }),
        { insertText: { objectId: bodyId, insertionIndex: 0, text: (bullets.length ? bullets.join("\n") : "Overview unavailable.") } },
        { createParagraphBullets: { objectId: bodyId, textRange: { type: "ALL" }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } },
      ]
    }
  });

  return slideId;
}

/** Build batch requests for LLM slides; startIndex positions them AFTER our two intro slides */
function buildLLMSlidesRequests(slidesData, startIndex = 3) {
  const reqs = [];
  slidesData.forEach((s, idx) => {
    const slideNumber  = startIndex + idx; // 3,4,5...
    const slideId      = `slide_${slideNumber}`;
    const titleShapeId = `${slideId}_title`;
    const bodyShapeId  = `${slideId}_body`;

    reqs.push({ createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: "BLANK" }, insertionIndex: slideNumber } });
    reqs.push(createTextBox({ objectId: titleShapeId, pageObjectId: slideId, x: 50, y: 50,  w: 640, h: 60 }));
    reqs.push({ insertText: { objectId: titleShapeId, insertionIndex: 0, text: s.slide_title || `Slide ${slideNumber}` } });
    reqs.push(createTextBox({ objectId: bodyShapeId,  pageObjectId: slideId, x: 50, y: 130, w: 640, h: 360 }));

    const bullets = (s.bullet_points || []).filter(Boolean).join("\n");
    if (bullets) {
      reqs.push({ insertText: { objectId: bodyShapeId, insertionIndex: 0, text: bullets } });
      reqs.push({ createParagraphBullets: { objectId: bodyShapeId, textRange: { type: "ALL" }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } });
    }
  });
  return reqs;
}

/** Main: create deck from report (now with 2 new intro slides) */
async function createDeckFromReport(report, opts = {}) {
  if (!report?.summary?.slides?.length) {
    throw new Error("Report has no slides in summary");
  }

  const { slides: slidesApi, drive } = getClients();
  const folderId = await ensureFolder(drive);
  const company  = report.summary.company || report.companyName;
  const title    = opts.title || `${company} — Sales Brief`;

  // 1) Create blank presentation (Google auto-adds a title slide)
  const pres = await slidesApi.presentations.create({ requestBody: { title } });
  const presentationId = pres.data.presentationId;

  // 2) Move to folder
  await drive.files.update({
    fileId: presentationId, addParents: folderId, fields: "id,parents", supportsAllDrives: true
  });

  // 3) Remove default title slide
  await deleteDefaultFirstSlide(slidesApi, presentationId);

  // 4) Custom Cover
  const preparedBy = opts.preparedBy || { name: "RAJEEV SHARMA", role: "Sales Executive", org: "Otsuka" };
  await createCoverSlide(slidesApi, presentationId, company, preparedBy);

  // 5) Presenter Intro (insertionIndex=1 => right after cover)
  await createPresenterIntroSlide(slidesApi, presentationId, preparedBy, 1);

  // 6) Company Intro (insertionIndex=2)
  const overview = report.summary.company_overview || "";
  await createCompanyIntroSlide(slidesApi, presentationId, company, overview, 2);

  // 7) Append LLM slides starting at index=3
  const contentReqs = buildLLMSlidesRequests(report.summary.slides, 3);
  if (contentReqs.length) {
    await slidesApi.presentations.batchUpdate({
      presentationId, requestBody: { requests: contentReqs }
    });
  }

  // 8) Share (demo)
  await shareFilePublic(drive, presentationId);

  const webViewLink  = `https://docs.google.com/presentation/d/${presentationId}/edit`;
  const webExportPdf = `https://docs.google.com/presentation/d/${presentationId}/export/pdf`;
  return { presentationId, webViewLink, webExportPdf, folderId };
}

module.exports = {
  createDeckFromReport,
  getPreparedByInfo, // used by route for personalization
};