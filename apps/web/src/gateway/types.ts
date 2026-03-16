export type GatewayErrorCode =
  | "aborted"
  | "already_exists"
  | "canceled"
  | "data_loss"
  | "deadline_exceeded"
  | "failed_precondition"
  | "internal"
  | "invalid_argument"
  | "not_found"
  | "out_of_range"
  | "permission_denied"
  | "resource_exhausted"
  | "unauthenticated"
  | "unavailable"
  | "unimplemented"
  | "unknown";

export interface Profile {
  id: string;
  login: string;
  nickname: string;
  avatarUrl: string | null;
  bio: string | null;
  timezone: string | null;
  profileAccent: string | null;
  statusText: string | null;
  birthday: string | null;
  country: string | null;
  city: string | null;
  readReceiptsEnabled: boolean;
  presenceEnabled: boolean;
  typingVisibilityEnabled: boolean;
  keyBackupStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface Session {
  id: string;
  deviceId: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface CurrentAuth {
  profile: Profile;
  device: Device | null;
  session: Session | null;
  sessionToken: string;
}

export interface RegisterInput {
  login: string;
  password: string;
  nickname: string;
  deviceLabel: string;
}

export interface LoginInput {
  login: string;
  password: string;
  deviceLabel: string;
}

export interface UpdateCurrentProfileInput {
  nickname: string;
  avatarUrl: string;
  bio: string;
  timezone: string;
  profileAccent: string;
  statusText: string;
  birthday: string;
  country: string;
  city: string;
}

export interface GatewayClient {
  register(input: RegisterInput): Promise<CurrentAuth>;
  login(input: LoginInput): Promise<CurrentAuth>;
  logoutCurrentSession(token: string): Promise<void>;
  getCurrentProfile(token: string): Promise<Profile>;
  updateCurrentProfile(
    token: string,
    input: UpdateCurrentProfileInput,
  ): Promise<Profile>;
}

export class GatewayError extends Error {
  code: GatewayErrorCode;
  httpStatus: number;

  constructor(code: GatewayErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isGatewayErrorCode(
  error: unknown,
  code: GatewayErrorCode,
): boolean {
  return error instanceof GatewayError && error.code === code;
}

export function describeGatewayError(
  error: unknown,
  fallbackMessage: string,
): string {
  if (!(error instanceof GatewayError)) {
    if (error instanceof Error && error.message.trim() !== "") {
      return error.message;
    }

    return fallbackMessage;
  }

  switch (error.code) {
    case "invalid_argument":
      return error.message || "Проверьте заполнение полей и повторите попытку.";
    case "unauthenticated":
      return "Сессия недействительна. Войдите снова.";
    case "permission_denied":
      return "Доступ к этому действию запрещён.";
    case "unavailable":
      return "Gateway сейчас недоступен. Повторите попытку позже.";
    default:
      return error.message || fallbackMessage;
  }
}
