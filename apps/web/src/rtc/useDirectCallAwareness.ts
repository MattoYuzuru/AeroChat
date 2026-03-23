import { useContext } from "react";
import { DirectCallAwarenessContext } from "./context";

export function useDirectCallAwareness() {
  const context = useContext(DirectCallAwarenessContext);
  if (context === null) {
    throw new Error(
      "useDirectCallAwareness must be used within DirectCallAwarenessProvider",
    );
  }

  return context;
}
