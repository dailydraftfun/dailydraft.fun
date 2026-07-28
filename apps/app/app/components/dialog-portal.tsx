'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Mounts viewport-level dialogs directly under the document body.
 *
 * Fixed descendants of filtered or transformed ancestors use that ancestor as
 * their containing block. Keeping overlays under `body` guarantees that
 * `inset: 0` means the visual viewport, including when the trigger lives in the
 * sticky, blurred workspace header.
 */
export function DialogPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.body);
  }, []);

  return target ? createPortal(children, target) : children;
}
