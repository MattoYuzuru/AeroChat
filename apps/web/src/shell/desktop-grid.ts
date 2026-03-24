export interface DesktopGridViewport {
  width: number;
  height: number;
}

export interface DesktopGridMetrics {
  columns: number;
  rows: number;
  capacity: number;
}

export const DESKTOP_GRID_LEFT_OFFSET_PX = 16;
export const DESKTOP_GRID_RIGHT_OFFSET_PX = 16;
export const DESKTOP_GRID_TOP_OFFSET_PX = 62;
export const DESKTOP_GRID_BOTTOM_OFFSET_PX = 12;
export const DESKTOP_GRID_CELL_WIDTH_PX = 122;
export const DESKTOP_GRID_CELL_HEIGHT_PX = 124;
export const DESKTOP_GRID_COLUMN_GAP_PX = 12;
export const DESKTOP_GRID_ROW_GAP_PX = 12;

export function resolveDesktopGridMetrics(
  viewport: DesktopGridViewport,
): DesktopGridMetrics {
  const availableWidth = Math.max(
    DESKTOP_GRID_CELL_WIDTH_PX,
    Math.floor(viewport.width) - DESKTOP_GRID_LEFT_OFFSET_PX - DESKTOP_GRID_RIGHT_OFFSET_PX,
  );
  const availableHeight = Math.max(
    DESKTOP_GRID_CELL_HEIGHT_PX,
    Math.floor(viewport.height) - DESKTOP_GRID_TOP_OFFSET_PX - DESKTOP_GRID_BOTTOM_OFFSET_PX,
  );
  const columns = Math.max(
    1,
    Math.floor(
      (availableWidth + DESKTOP_GRID_COLUMN_GAP_PX) /
        (DESKTOP_GRID_CELL_WIDTH_PX + DESKTOP_GRID_COLUMN_GAP_PX),
    ),
  );
  const rows = Math.max(
    1,
    Math.floor(
      (availableHeight + DESKTOP_GRID_ROW_GAP_PX) /
        (DESKTOP_GRID_CELL_HEIGHT_PX + DESKTOP_GRID_ROW_GAP_PX),
    ),
  );

  return {
    columns,
    rows,
    capacity: columns * rows,
  };
}

export function resolveDesktopGridCellIndex(
  point: {
    x: number;
    y: number;
  },
  metrics: DesktopGridMetrics,
): number {
  const column = clampDesktopGridAxis(
    Math.floor((point.x - DESKTOP_GRID_LEFT_OFFSET_PX) / desktopGridColumnStride()),
    metrics.columns - 1,
  );
  const row = clampDesktopGridAxis(
    Math.floor((point.y - DESKTOP_GRID_TOP_OFFSET_PX) / desktopGridRowStride()),
    metrics.rows - 1,
  );

  return row * metrics.columns + column;
}

export function desktopGridColumnStride(): number {
  return DESKTOP_GRID_CELL_WIDTH_PX + DESKTOP_GRID_COLUMN_GAP_PX;
}

export function desktopGridRowStride(): number {
  return DESKTOP_GRID_CELL_HEIGHT_PX + DESKTOP_GRID_ROW_GAP_PX;
}

function clampDesktopGridAxis(value: number, maxIndex: number): number {
  if (!Number.isFinite(value) || maxIndex <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(maxIndex, value));
}
