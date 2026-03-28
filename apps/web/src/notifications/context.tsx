/* eslint-disable react-refresh/only-export-components */
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useAuth } from "../auth/useAuth";
import { gatewayClient } from "../gateway/runtime";

const serviceWorkerPath = "/aerochat-notifications-sw.js";

type BrowserNotificationPermission = NotificationPermission | "unsupported";
type SubscriptionStatus = "idle" | "syncing" | "active" | "inactive";

export interface WebNotificationsContextValue {
  isSupported: boolean;
  permission: BrowserNotificationPermission;
  subscriptionStatus: SubscriptionStatus;
  error: string | null;
  ensureBrowserPush(token: string): Promise<boolean>;
  disableBrowserPush(token?: string): Promise<void>;
  clearError(): void;
}

const WebNotificationsContext = createContext<WebNotificationsContextValue | null>(null);

export function WebNotificationsProvider({ children }: PropsWithChildren) {
  const auth = useAuth();
  const [permission, setPermission] = useState<BrowserNotificationPermission>(
    getBrowserNotificationPermission(),
  );
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const previousTokenRef = useRef<string | null>(null);

  const disableBrowserPush = useCallback(async (token?: string) => {
    if (!isWebPushSupported()) {
      setPermission("unsupported");
      setSubscriptionStatus("inactive");
      return;
    }

    setSubscriptionStatus("syncing");
    setPermission(getBrowserNotificationPermission());

    try {
      const registration = await getNotificationServiceWorkerRegistration();
      if (registration === undefined) {
        setSubscriptionStatus("inactive");
        setError(null);
        return;
      }

      const subscription = await registration.pushManager.getSubscription();
      if (subscription !== null) {
        if (token && token.trim() !== "") {
          try {
            await gatewayClient.deleteWebPushSubscription(token, subscription.endpoint);
          } catch {
            // Удаление subscription остаётся best-effort, локальный unsubscribe важнее.
          }
        }
        await subscription.unsubscribe();
      }

      setSubscriptionStatus("inactive");
      setError(null);
    } catch (nextError) {
      setSubscriptionStatus("inactive");
      setError(
        nextError instanceof Error && nextError.message.trim() !== ""
          ? nextError.message
          : "Не удалось отключить browser push на этом устройстве.",
      );
    }
  }, []);

  const syncSubscription = useCallback(
    async (
      token: string,
      options: {
        requestPermission: boolean;
        silent: boolean;
      },
    ): Promise<boolean> => {
      if (!isWebPushSupported()) {
        setPermission("unsupported");
        setSubscriptionStatus("inactive");
        if (!options.silent) {
          setError(
            "Этот браузер не поддерживает push-уведомления.",
          );
        }
        return false;
      }

      setSubscriptionStatus("syncing");
      setError(null);

      try {
        const currentPermission = getBrowserNotificationPermission();
        setPermission(currentPermission);

        let resolvedPermission = currentPermission;
        if (resolvedPermission === "default" && options.requestPermission) {
          resolvedPermission = await Notification.requestPermission();
          setPermission(resolvedPermission);
        }

        if (resolvedPermission !== "granted") {
          setSubscriptionStatus("inactive");
          if (!options.silent) {
            setError(
              resolvedPermission === "denied"
                ? "Браузер уже запретил уведомления для AeroChat."
                : "Разрешение на уведомления не было выдано.",
            );
          }
          return false;
        }

        const publicKey = await gatewayClient.getWebPushPublicKey(token);
        if (publicKey === "") {
          setSubscriptionStatus("inactive");
          if (!options.silent) {
            setError("Push-ключ сервера пока не настроен.");
          }
          return false;
        }

        const registration = await registerNotificationServiceWorker();
        let subscription = await registration.pushManager.getSubscription();
        if (subscription === null) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: decodeBase64URL(publicKey),
          });
        }

        const payload = serializePushSubscription(subscription);
        if (payload === null) {
          setSubscriptionStatus("inactive");
          if (!options.silent) {
            setError("Браузер вернул неполную push subscription.");
          }
          return false;
        }

        await gatewayClient.upsertWebPushSubscription(token, {
          ...payload,
          userAgent:
            typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
              ? navigator.userAgent
              : null,
        });

        setSubscriptionStatus("active");
        setError(null);
        return true;
      } catch (nextError) {
        setSubscriptionStatus("inactive");
        if (!options.silent) {
          setError(
            nextError instanceof Error && nextError.message.trim() !== ""
              ? nextError.message
              : "Не удалось подготовить browser push на этом устройстве.",
          );
        }
        return false;
      }
    },
    [],
  );

  const ensureBrowserPush = useCallback(async (token: string) => {
    return syncSubscription(token, {
      requestPermission: true,
      silent: false,
    });
  }, [syncSubscription]);

  useEffect(() => {
    async function syncAuthSubscription() {
      const previousToken = previousTokenRef.current;
      if (auth.state.status !== "authenticated") {
        if (previousToken !== null) {
          await disableBrowserPush(previousToken);
        }
        previousTokenRef.current = null;
        return;
      }

      previousTokenRef.current = auth.state.token;
      if (auth.state.profile.pushNotificationsEnabled !== true) {
        await disableBrowserPush(auth.state.token);
        return;
      }

      if (getBrowserNotificationPermission() !== "granted") {
        setSubscriptionStatus("inactive");
        return;
      }

      await syncSubscription(auth.state.token, {
        requestPermission: false,
        silent: true,
      });
    }

    void syncAuthSubscription();
  }, [auth.state, disableBrowserPush, syncSubscription]);

  const value = useMemo<WebNotificationsContextValue>(
    () => ({
      isSupported: isWebPushSupported(),
      permission,
      subscriptionStatus,
      error,
      ensureBrowserPush,
      disableBrowserPush,
      clearError() {
        setError(null);
      },
    }),
    [
      disableBrowserPush,
      ensureBrowserPush,
      error,
      permission,
      subscriptionStatus,
    ],
  );

  return (
    <WebNotificationsContext.Provider value={value}>
      {children}
    </WebNotificationsContext.Provider>
  );
}

export function useWebNotifications() {
  const context = useContext(WebNotificationsContext);
  if (context === null) {
    throw new Error("useWebNotifications must be used within WebNotificationsProvider");
  }

  return context;
}

function isWebPushSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (!isWebPushSupported()) {
    return "unsupported";
  }

  return Notification.permission;
}

async function registerNotificationServiceWorker() {
  const registration = await navigator.serviceWorker.register(serviceWorkerPath, {
    scope: "/",
  });
  await navigator.serviceWorker.ready;
  return registration;
}

async function getNotificationServiceWorkerRegistration() {
  return navigator.serviceWorker.getRegistration(serviceWorkerPath);
}

function serializePushSubscription(subscription: PushSubscription) {
  const p256dhKey = subscription.getKey("p256dh");
  const authSecret = subscription.getKey("auth");
  if (p256dhKey === null || authSecret === null) {
    return null;
  }

  return {
    endpoint: subscription.endpoint,
    p256dhKey: encodeBase64URL(p256dhKey),
    authSecret: encodeBase64URL(authSecret),
    expirationTime:
      typeof subscription.expirationTime === "number"
        ? new Date(subscription.expirationTime).toISOString()
        : null,
  };
}

function decodeBase64URL(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
}

function encodeBase64URL(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
