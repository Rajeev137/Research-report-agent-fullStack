// frontend/src/screens/SignInScreen.tsx
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';

export default function SignInScreen() {
  const { signIn } = useAuth();

  return (
    <LinearGradient
      colors={['#0f172a', '#0b2f4e', '#0a3f5f']}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <View style={{ width: '100%', maxWidth: 420, gap: 16, alignItems: 'center' }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: '#e2e8f0' }}>Sales Brief Builder</Text>
        <Text style={{ color: '#94a3b8', textAlign: 'center' }}>
          Sign in with Google to generate tailored reports and auto-build slides.
        </Text>

        <Pressable
          onPress={signIn}
          style={{
            marginTop: 10,
            backgroundColor: '#fef08a',
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 12,
            width: '100%',
            alignItems: 'center'
          }}
        >
          <Text style={{ fontWeight: '800', color: '#1f2937' }}>Sign in with Google</Text>
        </Pressable>
      </View>
    </LinearGradient>
  );
}