export function shouldSyncDesktopRouteToActiveWindow(options: {
  activeWindowLaunchKey: string | null;
  activeWindowRoutePath: string | null;
  currentPath: string;
  routeLaunchKey: string | null;
}): boolean {
  if (options.activeWindowRoutePath === null) {
    return false;
  }

  if (options.activeWindowRoutePath === options.currentPath) {
    return false;
  }

  if (
    options.routeLaunchKey !== null &&
    options.activeWindowLaunchKey === options.routeLaunchKey
  ) {
    return false;
  }

  return true;
}
