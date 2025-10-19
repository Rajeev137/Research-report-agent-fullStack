// frontend/src/screens/ReportScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator } from 'react-native';
import ActionBar from '../components/ActionBar';
import ReportCard from '../components/ReportCard';
import SlideLinks from '../components/SlideLinks';
import { getHistory, ensureHistoryReport } from '../lib/storage';
import { getApiBase } from '../config/apiBase';

const EXPO_PUBLIC_API_BASE_URL = getApiBase();

function computePdfFromWebView(webViewLink?: string | null): string | null {
  if (!webViewLink) return null;
  const m = webViewLink.match(/presentation\/d\/([^/]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://docs.google.com/presentation/d/${id}/export/pdf`;
}

export default function ReportScreen({ route }: any) {
  const initial = route?.params?.payload || {};
  const [data, setData] = useState<any>(initial);
  const [loading, setLoading] = useState<boolean>(false);

  const reportId = useMemo(() => data?.reportId || initial?.reportId, [data, initial]);

  console.log('[DEBUG REPORT] Mount. initial payload:', initial);
  console.log('[DEBUG REPORT] Computed reportId:', reportId);

  // Safety net: if history somehow doesn’t contain this report yet, add it
  useEffect(() => {
    (async () => {
      if (!reportId) {
        console.log('[DEBUG REPORT] No reportId — skipping ensureHistoryReport');
        return;
      }
      console.log('[DEBUG REPORT] ensureHistoryReport START');
      try {
        const title =
          data?.summary?.company ||
          data?.company ||
          data?.companyName ||
          'Report';
        await ensureHistoryReport(reportId, String(title));
        console.log('[DEBUG REPORT] ensureHistoryReport DONE');
      } catch (e: any) {
        console.log('[DEBUG REPORT] ensureHistoryReport ERROR:', e?.message || e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  // Fetch full payload (if needed) and normalize links
  useEffect(() => {
    (async () => {
      if (!reportId) return;

      // Check what we already have
      const presentSlidesLink =
        data?.slidesLink ||
        data?.slides?.link ||
        data?.slideLinks?.webViewLink ||
        null;

      const presentSlidesPdfLink =
        data?.slidesPdfLink ||
        data?.slides?.pdfLink ||
        data?.slideLinks?.webExportPdf ||
        computePdfFromWebView(data?.slideLinks?.webViewLink) ||
        null;

      const hasSlides = !!presentSlidesLink || !!presentSlidesPdfLink;
      const hasSummary = !!data?.summary || !!data?.slides || !!data?.highlights;

      console.log('[DEBUG REPORT] Pre-fetch check:', { hasSlides, hasSummary, presentSlidesLink, presentSlidesPdfLink });

      if (hasSlides && hasSummary) {
        setData((prev: any) => ({
          ...prev,
          slidesLink: presentSlidesLink,
          slidesPdfLink: presentSlidesPdfLink,
        }));
        console.log('[DEBUG REPORT] Enough data present — skipping fetch.');
        return;
      }

      setLoading(true);
      try {
        const base = (EXPO_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
        let full: any = null;

        console.log('[DEBUG REPORT] Fetching /api/reports/:id …', reportId);
        const r1 = await fetch(`${base}/api/reports/${encodeURIComponent(reportId)}`);
        if (r1.ok) {
          full = await r1.json();
          console.log('[DEBUG REPORT] /api/reports OK:', full);
        } else {
          console.log('[DEBUG REPORT] /api/reports NOT OK — trying /api/research?reportId=');
          const r2 = await fetch(`${base}/api/research?reportId=${encodeURIComponent(reportId)}`);
          if (r2.ok) {
            full = await r2.json();
            console.log('[DEBUG REPORT] /api/research OK:', full);
          } else {
            console.log('[DEBUG REPORT] Both fetches failed. r1 status=', r1.status, 'r2 status=', r2.status);
          }
        }

        if (full) {
          const normSlidesLink =
            full.slidesLink ||
            full.slides?.link ||
            full.slidesWebLink ||
            full.slideLinks?.webViewLink ||
            null;

          const normSlidesPdfLink =
            full.slidesPdfLink ||
            full.slides?.pdfLink ||
            full.slidesPdf ||
            full.slideLinks?.webExportPdf ||
            computePdfFromWebView(normSlidesLink) ||
            null;

          console.log('[DEBUG REPORT] Normalized links after fetch:', { normSlidesLink, normSlidesPdfLink });

          setData({
            reportId,
            ...full,
            slidesLink: normSlidesLink,
            slidesPdfLink: normSlidesPdfLink,
          });
        } else {
          console.log('[DEBUG REPORT] No full payload received — keeping current data.');
        }
      } catch (err: any) {
        console.log('[DEBUG REPORT] Fetch ERROR:', err?.message || err);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const slidesLink = data?.slidesLink || data?.slides?.link || data?.slideLinks?.webViewLink || null;
  const slidesPdfLink =
    data?.slidesPdfLink ||
    data?.slides?.pdfLink ||
    data?.slideLinks?.webExportPdf ||
    computePdfFromWebView(slidesLink) ||
    null;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <ActionBar reportId={reportId} payload={data} />

      {loading ? (
        <View style={{ paddingVertical: 12 }}>
          <ActivityIndicator />
          <Text style={{ textAlign: 'center', color: '#666', marginTop: 8 }}>
            Loading report details…
          </Text>
        </View>
      ) : null}

      <ReportCard payload={data} />
      <SlideLinks slidesLink={slidesLink} slidesPdfLink={slidesPdfLink} />

      {!slidesLink && !slidesPdfLink ? (
        <Text style={{ color: '#999', fontSize: 12 }}>
          Slides not available yet. If this was a brand-new run, they may appear in a few moments.
        </Text>
      ) : null}
    </ScrollView>
  );
}