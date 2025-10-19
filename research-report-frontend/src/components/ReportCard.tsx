import React, { useMemo } from 'react';
import { View, Text } from 'react-native';

type Highlight = {
  title?: string; url?: string;
  one_line_summary?: string;
  sales_bullet?: string;
  suggested_question?: string;
};

type SlideItem = {
  slide_number?: number;
  slide_title?: string;
  bullet_points?: string[];
};

export default function ReportCard({ payload }: { payload: any }) {
  const safeStr = (v: any, def = ''): string => typeof v === 'string' && v.trim().length > 0 ? v : def;
  const nonEmptyArray = (a: any) => Array.isArray(a) && a.length > 0;

  const company = useMemo(() => {
    return safeStr(payload?.summary?.company) ||
           safeStr(payload?.companyName) ||
           safeStr(payload?.company) ||
           'Company';
  }, [payload]);

  const overview = useMemo(() => {
    return safeStr(payload?.summary?.company_overview) ||
           safeStr(payload?.summary) || '';
  }, [payload]);

  const highlights: Highlight[] = useMemo(() => {
    if (nonEmptyArray(payload?.perArticleSummaries)) {
      return payload.perArticleSummaries.map((a: any) => ({
        title: safeStr(a?.title),
        url: safeStr(a?.url),
        one_line_summary: safeStr(a?.one_line_summary) || safeStr(a?.short_summary),
        sales_bullet: safeStr(a?.sales_bullet),
        suggested_question: safeStr(a?.suggested_question),
      }));
    }
    return [];
  }, [payload]);

  const slides: SlideItem[] = useMemo(() => {
    if (nonEmptyArray(payload?.summary?.slides)) return payload.summary.slides;
    if (nonEmptyArray(payload?.slides)) return payload.slides;
    return [];
  }, [payload]);

  return (
    <View style={{ gap: 14 }}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: '#e2e8f0' }}>{company}</Text>

      {overview ? (
        <View style={{ padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(2,6,23,0.6)', borderRadius: 12 }}>
          <Text style={{ fontWeight: '700', color: '#cbd5e1', marginBottom: 6 }}>Overview</Text>
          <Text style={{ color: '#e2e8f0', lineHeight: 20 }}>{overview}</Text>
        </View>
      ) : null}

      {highlights.length ? (
        <View style={{ padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(2,6,23,0.6)', borderRadius: 12, gap: 8 }}>
          <Text style={{ fontWeight: '700', color: '#cbd5e1' }}>Highlights</Text>
          {highlights.slice(0, 5).map((h, idx) => (
            <View key={idx} style={{ gap: 2 }}>
              {h.title ? <Text style={{ fontWeight: '600', color: '#e2e8f0' }}>{h.title}</Text> : null}
              {h.one_line_summary ? <Text style={{ color: '#cbd5e1' }}>{h.one_line_summary}</Text> : null}
              {h.suggested_question ? <Text style={{ color: '#a5b4fc', fontStyle: 'italic' }}>Q: {h.suggested_question}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {slides.length ? (
        <View style={{ padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(2,6,23,0.6)', borderRadius: 12, gap: 10 }}>
          <Text style={{ fontWeight: '700', color: '#cbd5e1' }}>Slides Preview</Text>
          {slides.slice(0, 3).map((s, i) => {
            const title = s?.slide_title || `Slide ${s?.slide_number ?? (i + 1)}`;
            const bullets = Array.isArray(s?.bullet_points) ? s.bullet_points : [];
            return (
              <View key={i} style={{ gap: 4 }}>
                <Text style={{ fontWeight: '600', color: '#e2e8f0' }}>
                  {s?.slide_number ?? (i + 1)}. {title}
                </Text>
                {bullets.length ? bullets.map((b, bi) => (
                  <Text key={bi} style={{ color: '#cbd5e1' }}>• {b}</Text>
                )) : <Text style={{ color: '#64748b' }}>No bullet points available.</Text>}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={{ color: '#94a3b8', fontSize: 12 }}>Slides preview not available yet.</Text>
      )}
    </View>
  );
}