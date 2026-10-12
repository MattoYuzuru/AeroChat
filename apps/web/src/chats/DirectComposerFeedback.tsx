import { useLayoutEffect, type RefObject } from "react";

interface DirectComposerFeedbackProps {
  id: string;
  message: string | null;
  className: string;
  visible: boolean;
  viewportRef: RefObject<HTMLElement | null>;
}

export function DirectComposerFeedback({
  id,
  message,
  className,
  visible,
  viewportRef,
}: DirectComposerFeedbackProps) {
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!message || !visible || !viewport || viewport.clientHeight === 0) {
      return;
    }

    // Раскрываем первую строку composer, не прокручивая history/страницу и не меняя focus.
    viewport.scrollTop = 0;
  }, [message, visible, viewportRef]);

  if (!message) {
    return null;
  }

  return (
    <div className={className} id={id} role="alert" tabIndex={0}>
      {message}
    </div>
  );
}
