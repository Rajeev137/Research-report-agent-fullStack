// frontend/src/screens/SettingsScreen.tsx
import React from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ color: '#e2e8f0', fontSize: 22, fontWeight: '800', marginBottom: 6 }}>Settings</Text>

      <View style={{
        gap: 6,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(2,6,23,0.6)',
        padding: 14,
        borderRadius: 12
      }}>
        <Text style={{ color: '#cbd5e1' }}>Name: <Text style={{ color: '#e2e8f0', fontWeight: '700' }}>{user?.name || '-'}</Text></Text>
        <Text style={{ color: '#cbd5e1' }}>Email: <Text style={{ color: '#e2e8f0', fontWeight: '700' }}>{user?.email || '-'}</Text></Text>
      </View>

      <Pressable
        onPress={async () => {
          await signOut();
          Alert.alert('Signed out', 'Come back anytime.');
        }}
        style={{
          backgroundColor: '#ef4444',
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 12,
          alignItems: 'center',
          marginTop: 8
        }}
      >
        <Text style={{ color: '#fee2e2', fontWeight: '800' }}>Sign out</Text>
      </Pressable>
    </View>
  );
}