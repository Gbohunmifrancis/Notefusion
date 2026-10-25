/* The admin console's service worker: web push only. No caching, no fetch handler.
 *
 * Registered by src/lib/consolePush.ts when an admin turns notifications on in Settings. The API sends what needs a
 * look (a payment, a failed payment attempt, a wave of new accounts, a flood of transcriptions) as
 * {title, body, tag, url, kind}; the tag replaces the last notification of its kind. A click focuses a console tab on
 * that page, or opens one. Only console paths are opened.
 */
"use strict";

var ICON = "/brand/app-icon-192.png";

function notification(p) {
  p = p && typeof p === "object" ? p : {};
  var url = typeof p.url === "string" && /^\/(?!\/)/.test(p.url) ? p.url : "/";
  return {
    title: typeof p.title === "string" && p.title ? p.title : "NoteFusion console",
    options: {
      body: typeof p.body === "string" ? p.body : "",
      tag: typeof p.tag === "string" && p.tag ? p.tag : "nf-console",
      icon: ICON,
      badge: ICON,
      // A failed payment waits on screen until it is seen; the rest come and go as the system decides.
      requireInteraction: p.kind === "payment-failed",
      data: { url: url },
    },
  };
}

self.addEventListener("push", function (event) {
  var payload = null;
  try { payload = event.data ? event.data.json() : null; } catch (e) { payload = null; }
  var n = notification(payload);
  event.waitUntil(self.registration.showNotification(n.title, n.options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (tabs) {
      for (var i = 0; i < tabs.length; i++) {
        var tab = tabs[i];
        if ("focus" in tab) {
          return tab.focus().then(function (t) { return t && "navigate" in t ? t.navigate(url) : t; });
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : null;
    })
  );
});
