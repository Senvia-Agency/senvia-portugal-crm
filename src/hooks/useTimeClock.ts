import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { EntryStatus, PunchAction, TimeClockEntry } from "@/lib/timeclock";

const ENTRY_COLUMNS = "id, organization_id, user_id, action, punched_at, source, status, employee_note, admin_note, created_at";

export interface TimeClockHistoryRow {
  id: string;
  entry_id: string;
  user_id: string;
  action: "create" | "update" | "void" | "restore" | "approve" | "reject";
  changed_fields: string[];
  old_data: Partial<TimeClockEntry> | null;
  new_data: Partial<TimeClockEntry> | null;
  reason: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

export interface WorkSchedule {
  reminders: boolean;
  days: number[];
  start_time: string;
  end_time: string;
  lunch_start: string | null;
  lunch_end: string | null;
  tolerance_min: number;
}

export const DEFAULT_SCHEDULE: WorkSchedule = {
  reminders: true, days: [1, 2, 3, 4, 5], start_time: "09:00", end_time: "18:00",
  lunch_start: "13:00", lunch_end: "14:00", tolerance_min: 10,
};

/** Everyone's view of the clock refreshes together after any punch. */
const invalidateClock = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ["time-clock"] });

/** My entries from `fromIso` (default: the last 36 hours, enough for today's shift) to `toIso`. */
export function useMyTimeClock(fromIso?: string, toIso?: string) {
  const { user, organization } = useAuth();
  // Rounded to the hour: a value that changed every render would be a new query each time.
  const from = fromIso ?? new Date((Math.floor(Date.now() / 3600_000) - 36) * 3600_000).toISOString();
  return useQuery({
    queryKey: ["time-clock", "mine", organization?.id, user?.id, from, toIso ?? null],
    enabled: !!organization?.id && !!user?.id,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<TimeClockEntry[]> => {
      let query = supabase.from("time_clock_entries").select(ENTRY_COLUMNS)
        .eq("organization_id", organization!.id).eq("user_id", user!.id).gte("punched_at", from);
      if (toIso) query = query.lt("punched_at", toIso);
      const { data, error } = await query.order("punched_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TimeClockEntry[];
    },
  });
}

/** The whole organization's entries in a period (admins; RLS returns only one's own otherwise). */
export function useOrgTimeClock(fromIso: string, toIso: string, enabled = true) {
  const { organization } = useAuth();
  return useQuery({
    queryKey: ["time-clock", "org", organization?.id, fromIso, toIso],
    enabled: enabled && !!organization?.id,
    queryFn: async (): Promise<TimeClockEntry[]> => {
      const rows: TimeClockEntry[] = [];
      // Paged: a month of a large team passes the 1000-row default.
      for (let page = 0; ; page++) {
        const { data, error } = await supabase.from("time_clock_entries").select(ENTRY_COLUMNS)
          .eq("organization_id", organization!.id).gte("punched_at", fromIso).lt("punched_at", toIso)
          .order("punched_at", { ascending: true }).range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        rows.push(...((data ?? []) as TimeClockEntry[]));
        if (!data || data.length < 1000) break;
      }
      return rows;
    },
  });
}

export function usePendingTimeClock(enabled = true) {
  const { organization } = useAuth();
  return useQuery({
    queryKey: ["time-clock", "pending", organization?.id],
    enabled: enabled && !!organization?.id,
    queryFn: async (): Promise<TimeClockEntry[]> => {
      const { data, error } = await supabase.from("time_clock_entries").select(ENTRY_COLUMNS)
        .eq("organization_id", organization!.id).eq("status", "pending").order("punched_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TimeClockEntry[];
    },
  });
}

export function useTimeClockHistory(fromIso: string, entryId?: string, enabled = true) {
  const { organization } = useAuth();
  return useQuery({
    queryKey: ["time-clock", "history", organization?.id, fromIso, entryId ?? null],
    enabled: enabled && !!organization?.id,
    queryFn: async (): Promise<TimeClockHistoryRow[]> => {
      let query = supabase.from("time_clock_entry_history")
        .select("id, entry_id, user_id, action, changed_fields, old_data, new_data, reason, changed_by, changed_by_name, changed_at")
        .eq("organization_id", organization!.id).order("changed_at", { ascending: false }).limit(500);
      query = entryId ? query.eq("entry_id", entryId) : query.gte("changed_at", fromIso);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as TimeClockHistoryRow[];
    },
  });
}

export function usePunch() {
  const { organization } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, note, at }: { action: PunchAction; note?: string; at?: string }) => {
      const { data, error } = await supabase.rpc("time_clock_punch", {
        _organization_id: organization!.id, _action: action, _note: note || null, _at: at ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateClock(qc),
  });
}

export function useCorrectEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ entryId, at, reason }: { entryId: string; at: string; reason: string }) => {
      const { error } = await supabase.rpc("time_clock_correct_entry", { _entry_id: entryId, _at: at, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => invalidateClock(qc),
  });
}

export function useAdminSaveEntry() {
  const { organization } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entryId: string | null; userId: string | null; action: PunchAction; punchedAt: string; reason: string; note?: string }) => {
      const { error } = await supabase.rpc("time_clock_admin_save_entry", {
        _organization_id: organization!.id, _entry_id: input.entryId, _user_id: input.userId, _action: input.action,
        _punched_at: input.punchedAt, _reason: input.reason, _note: input.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateClock(qc),
  });
}

export function useAdminSetStatus() {
  const { organization } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ entryIds, status, reason }: { entryIds: string[]; status: Exclude<EntryStatus, "pending">; reason?: string }) => {
      const { data, error } = await supabase.rpc("time_clock_admin_set_status", {
        _organization_id: organization!.id, _entry_ids: entryIds, _status: status, _reason: reason || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateClock(qc),
  });
}

export function useMySchedule() {
  const { user, organization } = useAuth();
  return useQuery({
    queryKey: ["work-schedule", organization?.id, user?.id],
    enabled: !!organization?.id && !!user?.id,
    queryFn: async (): Promise<WorkSchedule | null> => {
      const { data, error } = await supabase.from("work_schedules")
        .select("reminders, days, start_time, end_time, lunch_start, lunch_end, tolerance_min")
        .eq("organization_id", organization!.id).eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const hhmm = (t: string | null) => t?.slice(0, 5) ?? null;
      return { ...data, start_time: hhmm(data.start_time)!, end_time: hhmm(data.end_time)!, lunch_start: hhmm(data.lunch_start), lunch_end: hhmm(data.lunch_end) };
    },
  });
}

export function useSaveMySchedule() {
  const { user, organization } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (schedule: WorkSchedule) => {
      const { error } = await supabase.from("work_schedules").upsert({
        ...schedule, user_id: user!.id, organization_id: organization!.id, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,organization_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-schedule"] }),
  });
}
