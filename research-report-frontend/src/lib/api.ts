import axios from "axios";
import { getApiBase } from '../config/apiBase';
const RAW_BASE = getApiBase();


if (!RAW_BASE || !/^https?:\/\//i.test(RAW_BASE)) {
  console.warn('[API] Missing or invalid EXPO_PUBLIC_API_BASE_URL. Set it before starting Expo!');
}
// NOTE: research → merge → build slides often exceeds 20s.
// Bump generously to avoid client-side timeout before backend finishes.
export const api = axios.create({
  baseURL: RAW_BASE || 'http://INVALID-BASE',
  timeout: 240000, // 4 minutes
});

api.interceptors.response.use(
  r => r,
  err => {
    const status = err?.response?.status;
    const path = err?.config?.url;
    const data = err?.response?.data;
    return Promise.reject(err);
  }
);

// -------- High-level convenience --------------

export async function researchAndSlides(payload: {
  companyName: string;
  domain?: string;
  force?: boolean;
}) {
  const r = await api.post("/api/research-and-slides", payload);
  return r.data;
}

// Fallback step 1: research only (returns report + firestoreId)
export async function runResearch(payload: {
  companyName: string;
  domain?: string;
  force?: boolean;
}) {
  const r = await api.post("/api/research", payload);
  return r.data as {
    cached: boolean;
    elapsedMs?: number;
    report?: any;
    firestoreId?: string; // some shapes embed id in report.firestoreId
  };
}

// Fallback step 2: slides from reportId
export async function buildSlidesFromReport(reportId: string) {
  const r = await api.post("/api/slides/from-report", { reportId });
  return r.data as {
    ok: boolean;
    presentationId: string;
    webViewLink?: string;
    webExportPdf?: string;
    folderId?: string;
  };
}