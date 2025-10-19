import React from 'react';
import { View, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export default function Gradient({
  children,
  padded = true,
}: React.PropsWithChildren<{ padded?: boolean }>) {
  return (
    <LinearGradient
      colors={['#0f2027', '#203a43', '#2c5364']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, padding: padded ? 16 : 0 }}>
        {children}
      </View>
    </LinearGradient>
  );
}