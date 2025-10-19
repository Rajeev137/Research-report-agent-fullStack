import React, { createContext, useContext } from 'react';
import { getApiBase } from '../config/apiBase';
const EXPO_PUBLIC_API_BASE_URL = getApiBase();

type AppConfig = { apiBaseUrl: string };
const Ctx = createContext<AppConfig>({ apiBaseUrl: EXPO_PUBLIC_API_BASE_URL || 'http://127.0.0.1:4000' });

export const AppConfigProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  return (
    <Ctx.Provider value={{ apiBaseUrl: EXPO_PUBLIC_API_BASE_URL || 'http://127.0.0.1:4000' }}>
      {children}
    </Ctx.Provider>
  );
};

export function useAppConfig() { return useContext(Ctx); }