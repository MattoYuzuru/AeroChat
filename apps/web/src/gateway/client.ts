import type {
  CurrentAuth,
  Device,
  GatewayClient,
  GatewayErrorCode,
  Profile,
  Session,
} from "./types";
import { GatewayError } from "./types";

const identityServicePath = "aerochat.identity.v1.IdentityService";

interface FetchLike {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface ConnectErrorPayload {
  code?: string;
  message?: string;
}

interface TimestampedWire {
  createdAt?: string;
  lastSeenAt?: string;
  revokedAt?: string;
  updatedAt?: string;
}

interface ProfileWire extends TimestampedWire {
  id?: string;
  login?: string;
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  timezone?: string;
  profileAccent?: string;
  statusText?: string;
  birthday?: string;
  country?: string;
  city?: string;
  readReceiptsEnabled?: boolean;
  presenceEnabled?: boolean;
  typingVisibilityEnabled?: boolean;
  keyBackupStatus?: string;
}

interface DeviceWire extends TimestampedWire {
  id?: string;
  label?: string;
}

interface SessionWire extends TimestampedWire {
  id?: string;
  deviceId?: string;
}

interface CurrentAuthWire {
  profile?: ProfileWire;
  device?: DeviceWire;
  session?: SessionWire;
  sessionToken?: string;
}

interface RegisterResponseWire {
  auth?: CurrentAuthWire;
}

interface LoginResponseWire {
  auth?: CurrentAuthWire;
}

interface GetCurrentProfileResponseWire {
  profile?: ProfileWire;
}

interface UpdateCurrentProfileResponseWire {
  profile?: ProfileWire;
}

export function createGatewayClient(
  fetchImpl: FetchLike,
  baseUrl = resolveGatewayBaseUrl(),
): GatewayClient {
  return {
    async register(input) {
      const response = await unaryCall<RegisterResponseWire>(fetchImpl, baseUrl, "Register", {
        login: input.login.trim(),
        password: input.password,
        nickname: input.nickname.trim(),
        deviceLabel: normalizeOptionalString(input.deviceLabel),
      });

      return normalizeCurrentAuth(response.auth);
    },

    async login(input) {
      const response = await unaryCall<LoginResponseWire>(fetchImpl, baseUrl, "Login", {
        login: input.login.trim(),
        password: input.password,
        deviceLabel: normalizeOptionalString(input.deviceLabel),
      });

      return normalizeCurrentAuth(response.auth);
    },

    async logoutCurrentSession(token) {
      await unaryCall(fetchImpl, baseUrl, "LogoutCurrentSession", {}, token);
    },

    async getCurrentProfile(token) {
      const response = await unaryCall<GetCurrentProfileResponseWire>(
        fetchImpl,
        baseUrl,
        "GetCurrentProfile",
        {},
        token,
      );

      return normalizeProfile(response.profile);
    },

    async updateCurrentProfile(token, input) {
      const response = await unaryCall<UpdateCurrentProfileResponseWire>(
        fetchImpl,
        baseUrl,
        "UpdateCurrentProfile",
        {
          nickname: input.nickname.trim(),
          avatarUrl: input.avatarUrl,
          bio: input.bio,
          timezone: input.timezone,
          profileAccent: input.profileAccent,
          statusText: input.statusText,
          birthday: input.birthday,
          country: input.country,
          city: input.city,
        },
        token,
      );

      return normalizeProfile(response.profile);
    },
  };
}

export function resolveGatewayBaseUrl(): string {
  const env = import.meta.env as ImportMetaEnv & {
    VITE_GATEWAY_BASE_URL?: string;
    VITE_API_BASE_URL?: string;
  };
  const value = env.VITE_GATEWAY_BASE_URL ?? env.VITE_API_BASE_URL ?? "/api";
  const trimmed = value.trim();

  if (trimmed === "") {
    return "/api";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function unaryCall<TResponse>(
  fetchImpl: FetchLike,
  baseUrl: string,
  method: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<TResponse> {
  const response = await fetchImpl(
    buildPath(baseUrl, identityServicePath, method),
    {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(body),
    },
  );

  const payload = await readPayload(response);

  if (!response.ok) {
    throw createGatewayError(response.status, payload);
  }

  return payload as TResponse;
}

function buildPath(baseUrl: string, service: string, method: string): string {
  return `${baseUrl}/${service}/${method}`;
}

function buildHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Connect-Protocol-Version": "1",
    "Content-Type": "application/json",
  };

  if (typeof token === "string" && token.trim() !== "") {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      code: "unknown",
      message: `Gateway вернул некорректный JSON при статусе ${response.status}.`,
    } satisfies ConnectErrorPayload;
  }
}

function createGatewayError(status: number, payload: unknown): GatewayError {
  const connectError = payload as ConnectErrorPayload | null;
  const code = normalizeErrorCode(connectError?.code);
  const message =
    typeof connectError?.message === "string" && connectError.message.trim() !== ""
      ? connectError.message
      : `Gateway request failed with HTTP ${status}.`;

  return new GatewayError(code, message, status);
}

function normalizeErrorCode(value: string | undefined): GatewayErrorCode {
  switch (value) {
    case "aborted":
    case "already_exists":
    case "canceled":
    case "data_loss":
    case "deadline_exceeded":
    case "failed_precondition":
    case "internal":
    case "invalid_argument":
    case "not_found":
    case "out_of_range":
    case "permission_denied":
    case "resource_exhausted":
    case "unauthenticated":
    case "unavailable":
    case "unimplemented":
      return value;
    default:
      return "unknown";
  }
}

function normalizeCurrentAuth(input: CurrentAuthWire | undefined): CurrentAuth {
  return {
    profile: normalizeProfile(input?.profile),
    device: input?.device ? normalizeDevice(input.device) : null,
    session: input?.session ? normalizeSession(input.session) : null,
    sessionToken: input?.sessionToken ?? "",
  };
}

function normalizeProfile(input: ProfileWire | undefined): Profile {
  return {
    id: input?.id ?? "",
    login: input?.login ?? "",
    nickname: input?.nickname ?? "",
    avatarUrl: normalizeNullableString(input?.avatarUrl),
    bio: normalizeNullableString(input?.bio),
    timezone: normalizeNullableString(input?.timezone),
    profileAccent: normalizeNullableString(input?.profileAccent),
    statusText: normalizeNullableString(input?.statusText),
    birthday: normalizeNullableString(input?.birthday),
    country: normalizeNullableString(input?.country),
    city: normalizeNullableString(input?.city),
    readReceiptsEnabled: input?.readReceiptsEnabled ?? false,
    presenceEnabled: input?.presenceEnabled ?? false,
    typingVisibilityEnabled: input?.typingVisibilityEnabled ?? false,
    keyBackupStatus: input?.keyBackupStatus ?? "KEY_BACKUP_STATUS_UNSPECIFIED",
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeDevice(input: DeviceWire): Device {
  return {
    id: input.id ?? "",
    label: input.label ?? "",
    createdAt: input.createdAt ?? "",
    lastSeenAt: input.lastSeenAt ?? "",
    revokedAt: normalizeNullableString(input.revokedAt),
  };
}

function normalizeSession(input: SessionWire): Session {
  return {
    id: input.id ?? "",
    deviceId: input.deviceId ?? "",
    createdAt: input.createdAt ?? "",
    lastSeenAt: input.lastSeenAt ?? "",
    revokedAt: normalizeNullableString(input.revokedAt),
  };
}

function normalizeNullableString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value === "" ? null : value;
}

function normalizeOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
