import React, { useMemo } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';

function computePdfFromWebView(webViewLink?: string | null): string | null {
  if (!webViewLink) return null;
  const m = webViewLink.match(/presentation\/d\/([^/]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://docs.google.com/presentation/d/${id}/export/pdf`;
}

export default function SlideLinks({
  slidesLink,
  slidesPdfLink,
}: {
  slidesLink?: string | null;
  slidesPdfLink?: string | null;
}) {
  const pdf = useMemo(() => slidesPdfLink || computePdfFromWebView(slidesLink), [slidesLink, slidesPdfLink]);
  if (!slidesLink && !pdf) return null;

  const LinkBtn = ({ title, url }: { title: string; url: string }) => (
    <Pressable onPress={() => Linking.openURL(url)} style={{
      backgroundColor: '#0891b2',
      paddingVertical: 10, paddingHorizontal: 14,
      borderRadius: 10
    }}>
      <Text style={{ color: '#e0f2fe', fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 10, flexDirection: 'row', flexWrap: 'wrap' }}>
      {slidesLink ? <LinkBtn title="Open in Browser" url={slidesLink} /> : null}
      {pdf ? <LinkBtn title="Download PDF" url={pdf} /> : null}
    </View>
  );
}