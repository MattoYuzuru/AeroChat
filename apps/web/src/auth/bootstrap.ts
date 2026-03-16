import type { GatewayClient, Profile } from "../gateway/types";
import { describeGatewayError, isGatewayErrorCode } from "../gateway/types";
import type { SessionStore } from "./session-store";

export type BootstrapResult =
  | {
      status: "anonymous";
      notice: string | null;
    }
  | {
      status: "authenticated";
      token: string;
      profile: Profile;
      notice: string | null;
    }
  | {
      status: "error";
      token: string;
      message: string;
    };

export async function bootstrapAuthSession(
  client: GatewayClient,
  sessionStore: SessionStore,
): Promise<BootstrapResult> {
  const token = sessionStore.read();
  if (token === null) {
    return {
      status: "anonymous",
      notice: null,
    };
  }

  try {
    const profile = await client.getCurrentProfile(token);

    return {
      status: "authenticated",
      token,
      profile,
      notice: null,
    };
  } catch (error) {
    if (isGatewayErrorCode(error, "unauthenticated")) {
      sessionStore.clear();

      return {
        status: "anonymous",
        notice: "Сохранённая сессия истекла. Войдите снова.",
      };
    }

    return {
      status: "error",
      token,
      message: describeGatewayError(
        error,
        "Не удалось восстановить текущую сессию через gateway.",
      ),
    };
  }
}
