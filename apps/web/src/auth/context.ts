import { createContext } from "react";
import type {
  LoginInput,
  Profile,
  RegisterInput,
  UpdateCurrentProfileInput,
} from "../gateway/types";

export type AuthState =
  | {
      status: "bootstrapping";
      notice: string | null;
    }
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
      notice: string | null;
    };

export interface AuthContextValue {
  state: AuthState;
  login(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
  discardSession(): void;
  expireSession(message?: string): void;
  retryBootstrap(): Promise<void>;
  refreshProfile(): Promise<Profile>;
  updateProfile(input: UpdateCurrentProfileInput): Promise<Profile>;
  clearNotice(): void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
