"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMessages } from "../i18n";

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const t = useMessages();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmingRef = useRef(false);
  const confirm = () => {
    if (busy || confirmingRef.current) return;
    confirmingRef.current = true;
    onConfirm();
  };

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const appShell = document.getElementById("app-shell-content");
    const previousOverflow = document.body.style.overflow;
    appShell?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    return () => {
      appShell?.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !busy) {
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ??
        []),
    ];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-description"
        onKeyDown={handleKeyDown}
      >
        <p className="eyebrow">{t.dialog.eyebrow}</p>
        <h2 id="confirmation-title">{title}</h2>
        <p id="confirmation-description">{description}</p>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary-button"
            onClick={onCancel}
            disabled={busy}
          >
            {t.dialog.cancel}
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? t.dialog.working : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
