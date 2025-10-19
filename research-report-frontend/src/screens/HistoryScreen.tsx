import React, { useCallback, useState } from 'react';
import { ScrollView, Pressable, View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getHistory } from '../lib/storage';
import { fmtDate } from '../lib/formatters';

export default function HistoryScreen({ navigation }: any) {
  const [items, setItems] = useState<Array<{ reportId: string; title: string; ts: number }>>([]);

  const load = useCallback(() => {
    (async () => {
      const h = await getHistory();
      setItems(h);
    })();
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ color: '#e2e8f0', fontSize: 22, fontWeight: '800', marginBottom: 6 }}>History</Text>

      {items.length === 0 ? (
        <Text style={{ color: '#94a3b8' }}>No history yet.</Text>
      ) : null}

      {items.map((it) => (
        <Pressable
          key={it.reportId}
          onPress={() => navigation.navigate('Report', { payload: { reportId: it.reportId } })}
        >
          <View style={{
            padding: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
            backgroundColor: 'rgba(2,6,23,0.6)',
            borderRadius: 12
          }}>
            <Text style={{ fontWeight: '700', color: '#e2e8f0' }}>{it.title}</Text>
            <Text style={{ color: '#94a3b8' }}>{fmtDate(it.ts)}</Text>
          </View>
        </Pressable>
      ))}

      {items.length >= 5 ? (
        <Text style={{ color: '#94a3b8', fontSize: 12, paddingTop: 8 }}>Showing latest 5 reports.</Text>
      ) : null}
    </ScrollView>
  );
}