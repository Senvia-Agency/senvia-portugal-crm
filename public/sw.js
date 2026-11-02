// Minimal push-notification service worker.
// Does NOT cache anything — avoids stale-shell issues from old vite-plugin-pwa.
// Only handles push events and notification clicks.

self.addEventListener("install", (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      await self.clients.claim();
      // Clean up any old caches from previous PWA builds
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    })()
  );
});

// Show push notification
self.addEventListener("push", (e) => {
  let data = { title: "Senvia OS", body: "Nova notificação", url: "/dashboard" };

  try {
    if (e.data) {
      const payload = e.data.json();
      data = { ...data, ...payload };
    }
  } catch (_) {
    // If payload is plain text
    if (e.data) {
      data.body = e.data.text();
    }
  }

  e.waitUntil(
    (async () => {
      // Every push MUST show a notification. iPhone and iPad (WebKit) revoke the
      // device's push subscription when a push ends without one, and from then on
      // that device gets no notifications at all. Skipping inbox pushes while the
      // inbox was open did exactly that. Now, with the inbox open and focused (the
      // in-app sound/badge already covers it), the notification is shown silently
      // and closed at once: the rule is kept and nothing pops up.
      let quiet = false;
      if (data.url && data.url.startsWith("/inbox")) {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        quiet = clients.some(
          (c) => c.focused && c.visibilityState === "visible" && new URL(c.url).pathname.startsWith("/inbox")
        );
      }
      const options = {
        body: data.body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: data.url || "/dashboard" },
        vibrate: [200, 100, 200],
      };
      if (quiet) {
        // A tag of its own, so closing it never touches another notification.
        const tag = `quiet-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await self.registration.showNotification(data.title, { ...options, tag, silent: true, vibrate: undefined });
        const shown = await self.registration.getNotifications({ tag });
        shown.forEach((n) => n.close());
        return;
      }
      await self.registration.showNotification(data.title, options);
    })()
  );
});

// Handle notification click — open or focus the app
self.addEventListener("notificationclick", (e) => {
  e.notification.close();

  const url = e.notification.data?.url || "/dashboard";

  e.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus existing window if available
        for (const client of clients) {
          if (new URL(client.url).origin === self.location.origin && "focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Otherwise open new window
        return self.clients.openWindow(url);
      })
  );
});

// Clear notifications when the web app marks messages as read
self.addEventListener("message", (e) => {
  if (e.data?.type === "CLEAR_NOTIFICATIONS") {
    self.registration.getNotifications().then((notifications) => {
      notifications.forEach((n) => {
        if (n.data?.url?.startsWith("/inbox")) n.close();
      });
    });
  }
});

// Pass-through fetch — no caching at all
self.addEventListener("fetch", () => {});
