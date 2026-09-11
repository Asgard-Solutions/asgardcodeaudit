import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Modal({
  open,
  onClose,
  title,
  children,
  testid,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  testid?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid={testid}>
      <div className="absolute inset-0 bg-base-900/80 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative w-full max-w-lg rounded-xl border border-line bg-base-850 p-6 shadow-panel rise"
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-ink-faint hover:bg-base-700 hover:text-ink"
            data-testid="modal-close"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
