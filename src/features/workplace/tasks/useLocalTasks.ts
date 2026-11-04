import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { taskListSchema, taskStorageKey, type WorkTask } from './model';

const eventName = 'senvia-workplace-tasks';
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(eventName, callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener(eventName, callback); };
}
export function useLocalTasks() {
  const { organization, user } = useAuth();
  const key = organization && user ? taskStorageKey(organization.id, user.id) : null;
  const [writeError, setWriteError] = useState<string | null>(null);
  const snapshot = useCallback(() => {
    if (!key) return null;
    try { return localStorage.getItem(key); }
    catch (error) { if (error instanceof DOMException) return 'storage-unavailable'; throw error; }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const parsed = useMemo(() => {
    if (!raw) return { tasks: [], error: null };
    try {
      const result = taskListSchema.safeParse(JSON.parse(raw));
      return result.success ? { tasks: result.data, error: null } : { tasks: [], error: 'Os dados locais não são válidos. Não foram substituídos.' };
    } catch (error) {
      if (error instanceof SyntaxError) return { tasks: [], error: 'Não foi possível ler as tarefas locais. Os dados foram preservados.' };
      throw error;
    }
  }, [raw]);
  const save = (task: WorkTask): boolean => {
    if (!key || parsed.error) return false;
    try {
      localStorage.setItem(key, JSON.stringify([...parsed.tasks.filter(t => t.id !== task.id), task]));
      setWriteError(null); window.dispatchEvent(new Event(eventName)); return true;
    } catch (error) {
      if (error instanceof DOMException) { setWriteError('Não foi possível guardar neste navegador. Mantém esta janela aberta e tenta novamente.'); return false; }
      throw error;
    }
  };
  return { tasks: parsed.tasks, save, error: writeError ?? parsed.error, scopeKey: key };
}
