import { useEffect, useState } from "react";

export const DESKTOP_SHELL_MIN_WIDTH = 1180;

export function isDesktopShellViewport(width: number): boolean {
  return width >= DESKTOP_SHELL_MIN_WIDTH;
}

export function useDesktopShellViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return isDesktopShellViewport(window.innerWidth);
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function handleResize() {
      setIsDesktop(isDesktopShellViewport(window.innerWidth));
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return isDesktop;
}
