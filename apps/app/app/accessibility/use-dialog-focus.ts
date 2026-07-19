'use client';

import { useEffect, useRef } from 'react';
import { getTrappedFocusIndex } from './focus-navigation';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type DialogFocusOptions = {
  active: boolean;
  closeOnEscape?: boolean;
  onClose: () => void;
};

export function useDialogFocus({ active, closeOnEscape = true, onClose }: DialogFocusOptions) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeOnEscapeRef = useRef(closeOnEscape);
  const onCloseRef = useRef(onClose);
  closeOnEscapeRef.current = closeOnEscape;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeDialog = dialog;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;

    function getFocusableElements(): HTMLElement[] {
      return [...activeDialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }

      const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
      const nextIndex = getTrappedFocusIndex(
        currentIndex,
        event.shiftKey,
        focusableElements.length,
      );
      if (nextIndex === null) return;

      const movingPastStart = event.shiftKey && currentIndex <= 0;
      const movingPastEnd = !event.shiftKey && currentIndex === focusableElements.length - 1;
      if (!movingPastStart && !movingPastEnd && currentIndex >= 0) return;

      event.preventDefault();
      focusableElements[nextIndex]?.focus();
    }

    const initialFocus =
      activeDialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
      getFocusableElements()[0] ??
      activeDialog;
    initialFocus.focus();
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active]);

  return dialogRef;
}
