import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen       from '../screens/HomeScreen';
import EnrollScreen     from '../screens/EnrollScreen';
import AuthScreen       from '../screens/AuthScreen';
import SyncScreen       from '../screens/SyncScreen';
import AdminPinScreen   from '../screens/AdminPinScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import UserListScreen   from '../screens/UserListScreen';
import UserDetailScreen from '../screens/UserDetailScreen';
import BulkEnrollScreen from '../screens/BulkEnrollScreen';
import LedgerScreen     from '../screens/LedgerScreen';
import TamperLabScreen  from '../screens/TamperLabScreen';
import RootLockoutScreen from '../screens/RootLockoutScreen';

export type RootStackParamList = {
  Onboarding:   undefined;
  Home:         undefined;
  AdminPin:     { onSuccess?: () => void; title?: string };
  Enroll:       { userId?: string; userName?: string; userRegistryId?: string };
  Auth:         undefined;
  Sync:         undefined;
  UserList:     undefined;
  UserDetail:   { userId: string };
  BulkEnroll:   undefined;
  Ledger:       undefined;
  TamperLab:    undefined;
  RootLockout:  undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const HDR = {
  headerStyle: { backgroundColor: '#0D1B2A' },
  headerTintColor: '#00E5FF',
  headerTitleStyle: { fontWeight: '700' as const, fontSize: 17 },
  contentStyle: { backgroundColor: '#0D1B2A' },
  animation: 'slide_from_right' as const,
};

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={HDR}>
      <Stack.Screen name="Onboarding"  component={OnboardingScreen}  options={{ headerShown: false }} />
      <Stack.Screen name="Home"        component={HomeScreen}         options={{ title: 'FaceAuth Offline' }} />
      <Stack.Screen name="AdminPin"    component={AdminPinScreen}     options={{ title: 'Admin Verification', presentation: 'modal' }} />
      <Stack.Screen name="Enroll"      component={EnrollScreen}       options={{ title: 'Enroll Face' }} />
      <Stack.Screen name="Auth"        component={AuthScreen}         options={{ title: 'Authenticate' }} />
      <Stack.Screen name="Sync"        component={SyncScreen}         options={{ title: 'Sync & Status' }} />
      <Stack.Screen name="UserList"    component={UserListScreen}     options={{ title: 'User Registry' }} />
      <Stack.Screen name="UserDetail"  component={UserDetailScreen}   options={{ title: 'User Profile' }} />
      <Stack.Screen name="BulkEnroll"  component={BulkEnrollScreen}   options={{ title: 'Bulk CSV Import' }} />
      <Stack.Screen name="Ledger"      component={LedgerScreen}       options={{ title: 'Chained Audit Ledger' }} />
      <Stack.Screen name="TamperLab"   component={TamperLabScreen}    options={{ title: 'Tamper Lab & Sync' }} />
      <Stack.Screen name="RootLockout" component={RootLockoutScreen}  options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
