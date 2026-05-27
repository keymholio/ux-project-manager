import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import type { Notification } from "../lib/types";
import { useAuth } from "./AuthContext";

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAllRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(
  undefined,
);

// How far back we fetch notifications. 30 days matches the history window
// we decided on — notifications never truly disappear (no auto-delete),
// but anything older than this isn't shown in the panel.
const HISTORY_DAYS = 30;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!profile) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", profile.id)
      .gte("created_at", cutoff.toISOString())
      .order("created_at", { ascending: false });

    if (!error) {
      setNotifications((data ?? []) as Notification[]);
    }
    setLoading(false);
  }, [profile]);

  // Initial load + realtime subscription.
  useEffect(() => {
    if (!profile) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchNotifications();

    // Subscribe to INSERT events on the notifications table filtered to this
    // user. We only need INSERT (new notifications arriving) — UPDATE (marking
    // read) is driven client-side optimistically and doesn't need a round-trip.
    const channel = supabase
      .channel(`notifications-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          // Prepend the new notification so it appears at the top of the list.
          setNotifications((prev) => {
            const incoming = payload.new as Notification;
            // Dedupe in case the fetch races the realtime event.
            if (prev.some((n) => n.id === incoming.id)) return prev;
            return [incoming, ...prev];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, fetchNotifications]);

  // Mark every unread notification as read. Called when the user opens the
  // panel. We optimistically update local state first so the badge clears
  // immediately, then fire the DB update in the background.
  const markAllRead = useCallback(async () => {
    if (!profile) return;
    const unreadIds = notifications
      .filter((n) => !n.read)
      .map((n) => n.id);
    if (unreadIds.length === 0) return;

    // Optimistic update.
    setNotifications((prev) =>
      prev.map((n) => (n.read ? n : { ...n, read: true })),
    );

    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", profile.id)
      .eq("read", false);
  }, [notifications, profile]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, loading, markAllRead }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx)
    throw new Error(
      "useNotifications must be used inside <NotificationProvider>",
    );
  return ctx;
}
