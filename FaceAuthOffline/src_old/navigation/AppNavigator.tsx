import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import EncryptedStorage from 'react-native-encrypted-storage';
import HomeScreen from '../screens/HomeScreen';
import EnrollScreen from '../screens/EnrollScreen';
import AuthScreen from '../screens/AuthScreen';
import SyncScreen from '../screens/SyncScreen';
import AdminPinScreen from '../screens/AdminPinScreen';
import UserListScreen from '../screens/UserListScreen';
import UserDetailScreen from '../screens/UserDetailScreen';
import BulkEnrollScreen from '../screens/BulkEnrollScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import RootLockoutScreen from '../screens/RootLockoutScreen';

export type RootStackParamList = {
  Home: undefined;
  Enroll: { userId?: string; userName?: string };
  Auth: undefined;
  Sync: undefined;
  AdminPin: { returnTo?: string; returnParams?: any };
  UserList: undefined;
  UserDetail: { userId: string };
  BulkEnroll: undefined;
  Onboarding: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const [loading, setLoading] = useState(true);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [isJailbroken, setIsJailbroken] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const JailMonkey = require('react-native-jail-monkey').default;
        setIsJailbroken(JailMonkey.isJailBroken());
      } catch {
        setIsJailbroken(false);
      }

      try {
        const complete = await EncryptedStorage.getItem('onboarding_complete');
        setIsOnboarded(complete === 'true');
      } catch {
        setIsOnboarded(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (isJailbroken) {
    return <RootLockoutScreen />;
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0D1B2A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#00E5FF" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={isOnboarded ? "Home" : "Onboarding"}
      screenOptions={{
        headerStyle: { backgroundColor: '#0D1B2A' },
        headerTintColor: '#00E5FF',
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        contentStyle: { backgroundColor: '#0D1B2A' },
        animation: 'slide_from_right',
      }}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'FaceAuth Offline' }} />
      <Stack.Screen name="Enroll" component={EnrollScreen} options={{ title: 'Enroll Face' }} />
      <Stack.Screen name="Auth" component={AuthScreen} options={{ title: 'Authenticate' }} />
      <Stack.Screen name="Sync" component={SyncScreen} options={{ title: 'Sync & Status' }} />
      <Stack.Screen name="AdminPin" component={AdminPinScreen} options={{ title: 'Admin Verification', headerLeft: () => null }} />
      <Stack.Screen name="UserList" component={UserListScreen} options={{ title: 'Personnel Registry' }} />
      <Stack.Screen name="UserDetail" component={UserDetailScreen} options={{ title: 'Personnel Details' }} />
      <Stack.Screen name="BulkEnroll" component={BulkEnrollScreen} options={{ title: 'Bulk Import' }} />
    </Stack.Navigator>
  );
}
