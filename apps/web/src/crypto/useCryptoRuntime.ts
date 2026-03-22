import { useContext } from "react";
import { CryptoRuntimeContext } from "./runtime-context";

export function useCryptoRuntime() {
  const context = useContext(CryptoRuntimeContext);
  if (context === null) {
    throw new Error("useCryptoRuntime must be used within CryptoRuntimeProvider");
  }

  return context;
}
