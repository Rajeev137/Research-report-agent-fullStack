import React from 'react';
import { View, Text } from 'react-native';
export default function ErrorView({ error }: { error: string }) {
  return (
    <View style={{ padding: 16 }}>
      <Text style={{ color: 'crimson', fontWeight: '600' }}>{error}</Text>
    </View>
  );
}