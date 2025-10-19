//@ts-nocheck
console.log("🚨 RAW ENV in App.tsx =", process.env.EXPO_PUBLIC_API_BASE_URL);
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, View, ActivityIndicator, Text, Pressable } from 'react-native';

import { AuthProvider, useAuth } from './src/context/AuthContext';

// Screens
import SignInScreen from './src/screens/SignInScreen';
import HomeScreen from './src/screens/HomeScreen';
import ReportScreen from './src/screens/ReportScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator();

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: 'transparent' },
};

function Splash() {
  return (
    <LinearGradient colors={['#0f172a', '#1e293b']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
        <Text style={{ color: '#fff', marginTop: 12, fontSize: 16 }}>Loading…</Text>
      </SafeAreaView>
    </LinearGradient>
  );
}

function InnerApp() {
  const { user, restored } = useAuth();

  if (!restored) return <Splash />;

  return (
    <LinearGradient colors={['#0f172a', '#1e293b']} style={{ flex: 1 }}>
      <NavigationContainer theme={theme}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: '#0f172a' },
            headerTintColor: '#fff',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        >
          {user ? (
            <>
              <Stack.Screen
                name="Home"
                component={HomeScreen}
                options={({ navigation }) => ({
                  title: 'Sales Briefs',
                  headerRight: () => (
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Pressable
                        onPress={() => navigation.navigate('History')}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(148,163,184,0.18)' }}
                      >
                        <Text style={{ color: '#e2e8f0', fontWeight: '700' }}>History</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => navigation.navigate('Settings')}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(148,163,184,0.18)' }}
                      >
                        <Text style={{ color: '#e2e8f0', fontWeight: '700' }}>Settings</Text>
                      </Pressable>
                    </View>
                  ),
                })}
              />
              <Stack.Screen name="Report" component={ReportScreen} options={{ title: 'Report' }} />
              <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'History' }} />
              <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
            </>
          ) : (
            <Stack.Screen name="SignIn" component={SignInScreen} options={{ headerShown: false }} />
          )}
        </Stack.Navigator>
        <StatusBar style="light" />
      </NavigationContainer>
    </LinearGradient>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <InnerApp />
    </AuthProvider>
  );
}