self.addEventListener("push", (event) => {
  event.waitUntil(handlePushEvent(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(handleNotificationClick(event));
});

async function handlePushEvent(event) {
  const payload = readPushPayload(event);
  if (payload === null) {
    return;
  }

  const visibleClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  if (visibleClients.some((client) => client.visibilityState === "visible")) {
    return;
  }

  const title = resolveNotificationTitle(payload);
  const body = resolveNotificationBody(payload);
  if (title === "" && body === "") {
    return;
  }

  await self.registration.showNotification(title, {
    body,
    tag: payload.tag || `aerochat:${payload.kind || "generic"}`,
    timestamp: resolveNotificationTimestamp(payload.sentAt),
    icon: "/android-chrome-192x192.png",
    badge: "/favicon-32x32.png",
    data: {
      route: typeof payload.route === "string" ? payload.route : "/app",
    },
  });
}

async function handleNotificationClick(event) {
  const route =
    typeof event.notification?.data?.route === "string" &&
    event.notification.data.route.trim() !== ""
      ? event.notification.data.route
      : "/app";
  const targetUrl = new URL(route, self.location.origin).toString();
  const clientsList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of clientsList) {
    if ("focus" in client) {
      await client.focus();
    }
    if ("navigate" in client) {
      await client.navigate(targetUrl);
      return;
    }
  }

  await self.clients.openWindow(targetUrl);
}

function readPushPayload(event) {
  if (!event.data) {
    return null;
  }

  try {
    const payload = event.data.json();
    return typeof payload === "object" && payload !== null ? payload : null;
  } catch {
    return null;
  }
}

function resolveNotificationTitle(payload) {
  if (typeof payload.title === "string" && payload.title.trim() !== "") {
    return payload.title;
  }

  if (payload.kind === "friend_request") {
    return "Новая заявка в друзья";
  }

  return "AeroChat";
}

function resolveNotificationBody(payload) {
  const sentAtLabel = formatSentAt(payload.sentAt);
  switch (payload.kind) {
    case "direct_message":
      return joinNotificationParts([truncateNotificationText(payload.preview), sentAtLabel]);
    case "group_message":
      return joinNotificationParts([
        payload.actorName,
        truncateNotificationText(payload.preview),
        sentAtLabel,
      ]);
    case "friend_request":
      return joinNotificationParts([payload.actorName, sentAtLabel]);
    default:
      return joinNotificationParts([truncateNotificationText(payload.preview), sentAtLabel]);
  }
}

function truncateNotificationText(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117).trimEnd()}...`;
}

function joinNotificationParts(parts) {
  return parts
    .filter((part) => typeof part === "string" && part.trim() !== "")
    .join(" · ");
}

function formatSentAt(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function resolveNotificationTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return Date.now();
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}
