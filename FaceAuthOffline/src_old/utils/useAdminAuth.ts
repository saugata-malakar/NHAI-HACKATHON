/**
 * useAdminAuth Hook
 * Intercepts navigation to administrative screens.
 * Automatically redirects to the Admin PIN keypad if the session has expired (> 5 minutes).
 */

import { useEffect } from 'react';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { AdminSession } from './AdminSession';

export function useAdminAuth() {
  const nav = useNavigation<any>();
  const state = useNavigationState(s => s);

  useEffect(() => {
    if (!AdminSession.isAuthenticated()) {
      // Fetch the current intercepted route name and parameters for post-login return redirections
      const currentRoute = state?.routes[state.index];
      const targetName = currentRoute?.name;
      const targetParams = currentRoute?.params;

      console.log(`[useAdminAuth] Session expired or unauthenticated. Intercepting navigation to administrative route: ${targetName}`);
      
      // Redirect to Admin PIN verification keyboard
      nav.navigate('AdminPin', {
        returnTo: targetName,
        returnParams: targetParams,
      });
    }
  }, [nav, state]);

  return {
    isAuthenticated: AdminSession.isAuthenticated(),
  };
}
