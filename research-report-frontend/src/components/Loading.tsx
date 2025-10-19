import React from 'react';
import { ActivityIndicator, View, Text } from 'react-native';

export default function Loading({ text='Loading...' }) {
  return (
    <View style={{
      marginTop: 16,
      padding: 16,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      backgroundColor: 'rgba(2,6,23,0.6)',
      borderRadius: 12
    }}>
      <ActivityIndicator />
      <Text style={{ marginTop: 8, color: '#cbd5e1' }}>{text}</Text>
    </View>
  );
}