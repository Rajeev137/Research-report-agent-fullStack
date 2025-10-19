export function getApiBase(): string {
  // Always override in development
  if (__DEV__) {
    return 'http://127.0.0.1:4000';
  }

  // Production can use env
  const raw = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim();
  if (raw && /^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:4000';
}