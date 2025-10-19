import React, { useState } from "react";
import { ScrollView, Alert, View, Text } from "react-native";
import CompanyForm from "../components/CompanyForm";
import Loading from "../components/Loading";
import Toast from "react-native-toast-message";
import { addHistory } from "../lib/storage";
import { getApiBase } from '../config/apiBase';
import {
  researchAndSlides,
  runResearch,
  buildSlidesFromReport,
} from "../lib/api";

const EXPO_PUBLIC_API_BASE_URL = getApiBase();

function computePdfFromWebView(webViewLink?: string | null): string | null {
  if (!webViewLink) return null;
  const m = webViewLink.match(/presentation\/d\/([^/]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://docs.google.com/presentation/d/${id}/export/pdf`;
}

export default function HomeScreen({ navigation }: any) {
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "research+slides" | "fallback-research" | "fallback-slides"
  >("idle");

  async function onSubmit(v: {
    companyName: string;
    domain?: string;
    force: boolean;
  }) {
    console.log("[DEBUG HOME] onSubmit CALLED with:", v);
    setLoading(true);
    setPhase("research+slides");

    try {
      // 1) Preferred: single endpoint that blocks until slides are built
      console.log("[DEBUG HOME] Calling researchAndSlides()…", {
        baseURL: EXPO_PUBLIC_API_BASE_URL,
      });
      const resp = await researchAndSlides(v);
      console.log("[DEBUG HOME] researchAndSlides() RESPONSE:", resp);

      if (!resp?.reportId) throw new Error("No reportId returned from backend");

      const slidesLink = resp?.slideLinks?.webViewLink || null;
      const slidesPdfLink =
        resp?.slideLinks?.webExportPdf ||
        computePdfFromWebView(slidesLink) ||
        null;

      console.log("[DEBUG HOME] Extracted links:", {
        slidesLink,
        slidesPdfLink,
      });

      const payload = {
        reportId: resp.reportId,
        summary: resp.reportSummary || null,
        slidesLink,
        slidesPdfLink,
        slideLinks: resp.slideLinks || null,
        cached: !!resp.cached,
        companyName: v.companyName,
      };

      // History first (so History tab updates even if user never opens Report)
      try {
        console.log("[DEBUG HOME] addHistory() START");
        await addHistory({
          reportId: resp.reportId,
          title: v.companyName,
          ts: Date.now(),
        });
        console.log("[DEBUG HOME] addHistory() DONE");
      } catch (histErr: any) {
        console.log(
          "[DEBUG HOME] addHistory() FAILED:",
          histErr?.message || histErr
        );
      }

      Toast.show({ type: "success", text1: "Research & slides ready" });
      console.log(
        "[DEBUG HOME] Navigating to Report with reportId:",
        resp.reportId
      );
      setTimeout(() => {
        navigation.navigate("Report", { payload });
        setLoading(false); // only stop loader after nav is triggered
        setPhase("idle");
        console.log("[DEBUG HOME] Navigation triggered, loading stopped");
      }, 0);

      return; // prevent falling into the catch/finally paths
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.log("[DEBUG HOME] researchAndSlides FAILED:", msg);

      const isTimeout =
        /timeout/i.test(msg) ||
        /ECONNABORTED/i.test(msg) ||
        e?.code === "ECONNABORTED";

      if (!isTimeout) {
        Alert.alert(
          "Error",
          e?.response?.data?.details?.message || msg || "Something went wrong"
        );
        setLoading(false);
        setPhase("idle");
        return;
      }

      try {
        // ---- Fallback Phase 1: run research (get reportId) ----
        setPhase("fallback-research");
        console.log("[DEBUG HOME] FALLBACK: calling /api/research …");
        const re = await runResearch(v);
        const reportId = re?.firestoreId || re?.report?.firestoreId || null;

        console.log(
          "[DEBUG HOME] FALLBACK research response:",
          re,
          "derived reportId:",
          reportId
        );

        if (!reportId)
          throw new Error("Fallback: research did not return a reportId");

        // ---- Fallback Phase 2: build slides for that reportId ----
        setPhase("fallback-slides");
        console.log("[DEBUG HOME] FALLBACK: calling /api/slides/from-report …");
        const sl = await buildSlidesFromReport(reportId);
        if (!sl?.ok) throw new Error("Fallback: slides generation failed");

        const slidesLink = sl?.webViewLink || null;
        const slidesPdfLink =
          sl?.webExportPdf || computePdfFromWebView(slidesLink) || null;

        console.log("[DEBUG HOME] FALLBACK links:", {
          slidesLink,
          slidesPdfLink,
        });

        const payload = {
          reportId,
          summary: re?.report?.summary || null,
          slidesLink,
          slidesPdfLink,
          slideLinks: sl || null,
          cached: !!re?.cached,
          companyName: v.companyName,
        };

        try {
          console.log("[DEBUG HOME] FALLBACK addHistory() START");
          await addHistory({ reportId, title: v.companyName, ts: Date.now() });
          console.log("[DEBUG HOME] FALLBACK addHistory() DONE");
        } catch (histErr: any) {
          console.log(
            "[DEBUG HOME] FALLBACK addHistory() FAILED:",
            histErr?.message || histErr
          );
        }

        Toast.show({ type: "success", text1: "Slides ready (fallback path)" });
        console.log(
          "[DEBUG HOME] FALLBACK navigating to Report with reportId:",
          reportId
        );
        setTimeout(() => {
          navigation.navigate("Report", { payload });
          setLoading(false); // stop after nav
          setPhase("idle");
          console.log(
            "[DEBUG HOME] FALLBACK navigation triggered, loading stopped"
          );
        }, 0);

        return;
      } catch (fallbackErr: any) {
        console.log(
          "[DEBUG HOME] FALLBACK ERROR:",
          fallbackErr?.response?.data || fallbackErr?.message || fallbackErr
        );
        Alert.alert(
          "Error",
          fallbackErr?.response?.data?.details?.message ||
            fallbackErr?.message ||
            "Something went wrong"
        );
      } finally {
        setLoading(false);
        setPhase("idle");
      }
    } finally {
      console.log("[DEBUG HOME] onSubmit FINALLY (outer) — loading:", false);
    }
  }

  // Small phase caption under the loader to know where we are
  const loadingCaption =
    phase === "research+slides"
      ? "Running research & generating slides…"
      : phase === "fallback-research"
      ? "Fallback: running research…"
      : phase === "fallback-slides"
      ? "Fallback: building slides…"
      : "Loading…";

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text
        style={{
          color: "#e2e8f0",
          fontSize: 22,
          fontWeight: "800",
          marginBottom: 6,
        }}
      >
        Home
      </Text>
      <CompanyForm onSubmit={onSubmit} loading={loading} />
      {loading ? (
        <Loading text={loadingCaption} />
      ) : (
        <View style={{ height: 12 }} />
      )}
    </ScrollView>
  );
}
