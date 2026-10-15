export function shouldSyncDesktopRouteToActiveWindow(options: {
  activeWindowLaunchKey: string | null;
  activeWindowRoutePath: string | null;
  currentPath: string;
  routeLaunchKey: string | null;
  previousLocationKey: string;
  currentLocationKey: string;
}): boolean {
  if (options.previousLocationKey !== options.currentLocationKey) {
    return false;
  }

  if (options.activeWindowLaunchKey === null && options.routeLaunchKey !== null) {
    return false;
  }

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
