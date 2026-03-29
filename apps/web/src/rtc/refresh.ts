interface QueuedRefreshController {
  inFlight: Promise<void> | null;
  queued: boolean;
}

type QueuedRefreshTask = () => Promise<void>;

export async function runQueuedRefresh(
  controller: QueuedRefreshController,
  task: QueuedRefreshTask,
): Promise<void> {
  if (controller.inFlight !== null) {
    controller.queued = true;
    await controller.inFlight;
    return;
  }

  while (true) {
    controller.queued = false;
    const refreshPromise = task();
    controller.inFlight = refreshPromise;

    try {
      await refreshPromise;
    } finally {
      if (controller.inFlight === refreshPromise) {
        controller.inFlight = null;
      }
    }

    if (!controller.queued) {
      return;
    }
  }
}

export async function runKeyedQueuedRefresh(
  inFlightByKey: Map<string, Promise<void>>,
  queuedKeys: Set<string>,
  key: string,
  task: QueuedRefreshTask,
): Promise<void> {
  const existingRefresh = inFlightByKey.get(key);
  if (existingRefresh !== undefined) {
    queuedKeys.add(key);
    await existingRefresh;
    return;
  }

  while (true) {
    queuedKeys.delete(key);
    const refreshPromise = task();
    inFlightByKey.set(key, refreshPromise);

    try {
      await refreshPromise;
    } finally {
      if (inFlightByKey.get(key) === refreshPromise) {
        inFlightByKey.delete(key);
      }
    }

    if (!queuedKeys.has(key)) {
      return;
    }
  }
}
