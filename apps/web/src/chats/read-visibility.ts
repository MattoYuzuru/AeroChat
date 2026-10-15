interface ThreadReadVisibility {
  pageVisible: boolean;
  windowVisible: boolean;
  timelineVisible: boolean;
}

export function isThreadReadVisible({
  pageVisible,
  windowVisible,
  timelineVisible,
}: ThreadReadVisibility): boolean {
  return pageVisible && windowVisible && timelineVisible;
}
