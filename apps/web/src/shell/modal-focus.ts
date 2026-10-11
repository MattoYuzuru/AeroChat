export function containModalFocus(
  dialog: HTMLElement,
  opener: HTMLElement | null,
  fallback: HTMLElement | null,
): () => void {
  const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0);
  const focusFirst = () => (controls()[0] ?? dialog).focus();

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Tab") {
      return;
    }
    const items = controls();
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (items.length === 0) {
      event.preventDefault();
      dialog.focus();
    } else if (event.shiftKey && index <= 0) {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (!event.shiftKey && (index < 0 || index === items.length - 1)) {
      event.preventDefault();
      items[0].focus();
    }
  }

  function handleFocusIn(event: FocusEvent) {
    if (event.target instanceof Node && !dialog.contains(event.target)) {
      focusFirst();
    }
  }

  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("focusin", handleFocusIn, true);
  focusFirst();
  return () => {
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("focusin", handleFocusIn, true);
    if (opener?.isConnected && !opener.matches(":disabled")) {
      opener.focus();
    } else if (fallback?.isConnected) {
      fallback.focus();
    }
  };
}
