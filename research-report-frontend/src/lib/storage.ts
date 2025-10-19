import AsyncStorage from '@react-native-async-storage/async-storage';

const EMAIL_KEY = 'auth:email';

const debug = (...args: any[]) => console.log('[DEBUG STORAGE]', ...args);

const keyForHistory = async (): Promise<string> => {
  const email = (await AsyncStorage.getItem(EMAIL_KEY)) || '__anon__';
  const key = `history:${email.toLowerCase()}`;
  debug('Using history key:', key);
  return key;
};

function safeParse<T>(raw: string | null, fallback: T): T {
  try {
    const parsed = raw ? JSON.parse(raw) : fallback;
    debug('safeParse → SUCCESS', parsed);
    return parsed as T;
  } catch (err) {
    debug('safeParse → ERROR, returning fallback. Raw=', raw);
    return fallback;
  }
}

export async function getHistory(): Promise<Array<{ reportId: string; title: string; ts: number }>> {
  const key = await keyForHistory();
  const raw = await AsyncStorage.getItem(key);
  debug('getHistory → RAW:', raw);
  const arr = safeParse<Array<{ reportId: string; title: string; ts: number }>>(raw, []);
  const out = Array.isArray(arr) ? arr : [];
  debug('getHistory → PARSED:', out);
  return out;
}

export async function addHistory(item: { reportId: string; title: string; ts: number }): Promise<void> {
  debug('addHistory CALLED with:', item);
  const key = await keyForHistory();

  const existing = await getHistory();
  debug('addHistory → existing before write:', existing);

  // De-dupe by reportId and cap at 5
  const dedup = existing.filter((h) => h.reportId !== item.reportId);
  const next = [item, ...dedup].slice(0, 5);

  await AsyncStorage.setItem(key, JSON.stringify(next));
  debug('addHistory → WRITE COMPLETE. New value:', next);
}

/**
 * Ensure a report exists in history (idempotent).
 * Good as a safety net when opening a report directly from a link/history restore.
 */
export async function ensureHistoryReport(reportId: string, title: string) {
  debug('ensureHistoryReport CALLED:', { reportId, title });
  const items = await getHistory();
  const exists = items.some((x) => x.reportId === reportId);
  debug('ensureHistoryReport → already exists?', exists);
  if (!exists) {
    await addHistory({ reportId, title, ts: Date.now() });
    debug('ensureHistoryReport → added new item.');
  }
}