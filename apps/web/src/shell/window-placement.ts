import type { ShellPreferencesStorageLike } from "./preferences";
import type {
  ShellWindow,
  ShellWindowBounds,
  ShellWindowPlacement,
} from "./runtime";

const windowPlacementStorageKey = "aerochat.shell.window-placement.v1";
const DEFAULT_WINDOW_WIDTH = 1120;
const DEFAULT_WINDOW_HEIGHT = 760;
const MIN_WINDOW_WIDTH = 384;
const MIN_WINDOW_HEIGHT = 320;
const WINDOW_CASCADE_STEP_X = 32;
const WINDOW_CASCADE_STEP_Y = 26;
const WINDOW_CASCADE_BASE_X = 20;
const WINDOW_CASCADE_BASE_Y = 18;
const MAX_WINDOW_CASCADE_STEPS = 6;

export interface ShellWindowViewport {
  width: number;
  height: number;
}

export interface StoredShellWindowPlacementRecord {
  bounds: ShellWindowBounds;
  restoredState: ShellWindowPlacement["restoredState"];
}

export interface ShellWindowPlacementStorageState {
  placements: Record<string, StoredShellWindowPlacementRecord>;
  nextCascadeIndex: number;
}

export const defaultShellWindowPlacementStorageState: ShellWindowPlacementStorageState = {
  placements: {},
  nextCascadeIndex: 0,
};

export function readShellWindowPlacementStorageState(
  storage: ShellPreferencesStorageLike | null,
): ShellWindowPlacementStorageState {
  if (storage === null) {
    return defaultShellWindowPlacementStorageState;
  }

  try {
    const raw = storage.getItem(windowPlacementStorageKey);
    if (raw === null || raw.trim() === "") {
      return defaultShellWindowPlacementStorageState;
    }

    const parsed = JSON.parse(raw) as {
      placements?: Record<string, unknown>;
      nextCascadeIndex?: unknown;
    };
    const placements = Object.fromEntries(
      Object.entries(parsed.placements ?? {}).flatMap(([launchKey, value]) => {
        const record = normalizeStoredShellWindowPlacementRecord(value);
        return record === null ? [] : [[launchKey, record]];
      }),
    );

    return {
      placements,
      nextCascadeIndex: readNonNegativeNumber(parsed.nextCascadeIndex, 0),
    };
  } catch {
    return defaultShellWindowPlacementStorageState;
  }
}

export function writeShellWindowPlacementStorageState(
  storage: ShellPreferencesStorageLike | null,
  state: ShellWindowPlacementStorageState,
): void {
  if (storage === null) {
    return;
  }

  try {
    storage.setItem(windowPlacementStorageKey, JSON.stringify(state));
  } catch {
    // Browser-local layout persistence не обязано быть доступно в каждом окружении.
  }
}

export function planShellWindowPlacementForLaunch(
  state: ShellWindowPlacementStorageState,
  launchKey: string,
  viewport: ShellWindowViewport,
): {
  placement: ShellWindowPlacement;
  storageState: ShellWindowPlacementStorageState;
} {
  const storedPlacement = state.placements[launchKey];
  if (storedPlacement !== undefined) {
    return {
      placement: {
        bounds: normalizeShellWindowBounds(storedPlacement.bounds, viewport),
        restoredState: storedPlacement.restoredState,
      },
      storageState: {
        ...state,
        placements: {
          ...state.placements,
          [launchKey]: {
            bounds: normalizeShellWindowBounds(storedPlacement.bounds, viewport),
            restoredState: storedPlacement.restoredState,
          },
        },
      },
    };
  }

  return {
    placement: {
      bounds: getStaggeredShellWindowBounds(viewport, state.nextCascadeIndex),
      restoredState: "open",
    },
    storageState: {
      ...state,
      nextCascadeIndex: state.nextCascadeIndex + 1,
    },
  };
}

export function upsertShellWindowPlacementRecord(
  state: ShellWindowPlacementStorageState,
  launchKey: string,
  record: StoredShellWindowPlacementRecord,
): ShellWindowPlacementStorageState {
  return {
    ...state,
    placements: {
      ...state.placements,
      [launchKey]: record,
    },
  };
}

export function createStoredShellWindowPlacementRecord(
  window: Pick<ShellWindow, "bounds" | "state">,
  viewport: ShellWindowViewport,
): StoredShellWindowPlacementRecord {
  return {
    bounds: normalizeShellWindowBounds(window.bounds, viewport),
    restoredState: window.state === "maximized" ? "maximized" : "open",
  };
}

export function getStaggeredShellWindowBounds(
  viewport: ShellWindowViewport,
  cascadeIndex: number,
): ShellWindowBounds {
  const baseBounds = getDefaultShellWindowBounds(viewport);
  const maxHorizontalSteps = Math.floor(
    Math.max(0, viewport.width - baseBounds.width - WINDOW_CASCADE_BASE_X) /
      WINDOW_CASCADE_STEP_X,
  );
  const maxVerticalSteps = Math.floor(
    Math.max(0, viewport.height - baseBounds.height - WINDOW_CASCADE_BASE_Y) /
      WINDOW_CASCADE_STEP_Y,
  );
  const maxSteps = Math.max(
    0,
    Math.min(MAX_WINDOW_CASCADE_STEPS, maxHorizontalSteps, maxVerticalSteps),
  );
  const offsetIndex = maxSteps === 0 ? 0 : cascadeIndex % (maxSteps + 1);

  return normalizeShellWindowBounds(
    {
      ...baseBounds,
      x: baseBounds.x + offsetIndex * WINDOW_CASCADE_STEP_X,
      y: baseBounds.y + offsetIndex * WINDOW_CASCADE_STEP_Y,
    },
    viewport,
  );
}

export function getDefaultShellWindowBounds(
  viewport: ShellWindowViewport,
): ShellWindowBounds {
  const width = clamp(
    Math.round(viewport.width * 0.82),
    Math.min(MIN_WINDOW_WIDTH, viewport.width),
    Math.min(DEFAULT_WINDOW_WIDTH, viewport.width),
  );
  const height = clamp(
    Math.round(viewport.height * 0.84),
    Math.min(MIN_WINDOW_HEIGHT, viewport.height),
    Math.min(DEFAULT_WINDOW_HEIGHT, viewport.height),
  );

  return normalizeShellWindowBounds(
    {
      x: WINDOW_CASCADE_BASE_X,
      y: WINDOW_CASCADE_BASE_Y,
      width,
      height,
    },
    viewport,
  );
}

export function normalizeShellWindowBounds(
  bounds: ShellWindowBounds,
  viewport: ShellWindowViewport,
): ShellWindowBounds {
  const safeViewportWidth = Math.max(1, Math.round(viewport.width));
  const safeViewportHeight = Math.max(1, Math.round(viewport.height));
  const width = clamp(
    Math.round(bounds.width),
    Math.min(MIN_WINDOW_WIDTH, safeViewportWidth),
    safeViewportWidth,
  );
  const height = clamp(
    Math.round(bounds.height),
    Math.min(MIN_WINDOW_HEIGHT, safeViewportHeight),
    safeViewportHeight,
  );

  return {
    x: clamp(Math.round(bounds.x), 0, Math.max(0, safeViewportWidth - width)),
    y: clamp(Math.round(bounds.y), 0, Math.max(0, safeViewportHeight - height)),
    width,
    height,
  };
}

function normalizeStoredShellWindowPlacementRecord(
  value: unknown,
): StoredShellWindowPlacementRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as {
    bounds?: unknown;
    restoredState?: unknown;
  };
  const bounds = normalizeShellWindowBoundsInput(record.bounds);
  if (bounds === null) {
    return null;
  }

  return {
    bounds,
    restoredState: record.restoredState === "maximized" ? "maximized" : "open",
  };
}

function normalizeShellWindowBoundsInput(value: unknown): ShellWindowBounds | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const bounds = value as Partial<ShellWindowBounds>;
  if (
    typeof bounds.x !== "number" ||
    typeof bounds.y !== "number" ||
    typeof bounds.width !== "number" ||
    typeof bounds.height !== "number"
  ) {
    return null;
  }

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function readNonNegativeNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
