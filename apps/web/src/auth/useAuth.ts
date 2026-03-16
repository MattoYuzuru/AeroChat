import { useContext } from "react";
import { AuthContext } from "./context";
import { describeGatewayError } from "../gateway/types";

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}

export function getAuthErrorMessage(error: unknown, fallbackMessage: string) {
  return describeGatewayError(error, fallbackMessage);
}
