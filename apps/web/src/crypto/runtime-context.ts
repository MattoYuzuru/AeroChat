import { createContext } from "react";
import type {
  CryptoRuntimeClient,
  CryptoRuntimeSession,
  CryptoRuntimeSnapshot,
} from "./types";

export type CryptoContextState =
  | {
      status: "disabled";
      snapshot: null;
      isActionPending: false;
      pendingLabel: null;
    }
  | {
      status: "bootstrapping" | "ready";
      snapshot: CryptoRuntimeSnapshot | null;
      isActionPending: boolean;
      pendingLabel: string | null;
    };

export interface CryptoRuntimeContextValue {
  state: CryptoContextState;
  refresh(): Promise<void>;
  createPendingLinkedDevice(): Promise<void>;
  publishCurrentBundle(): Promise<void>;
  approveLinkIntent(linkIntentId: string): Promise<void>;
}

export const CryptoRuntimeContext = createContext<CryptoRuntimeContextValue | null>(null);

export type RuntimeAction = (
  runtime: CryptoRuntimeClient,
  session: CryptoRuntimeSession,
) => Promise<CryptoRuntimeSnapshot>;
