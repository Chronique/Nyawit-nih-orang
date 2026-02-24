"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface ConfirmState {
  open: boolean;
  title?: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant: "default" | "danger" | "warning";
  resolve: ((val: boolean) => void) | null;
}

interface PromptState {
  open: boolean;
  title?: string;
  message: string;
  defaultValue: string;
  placeholder: string;
  confirmText: string;
  cancelText: string;
  resolve: ((val: string | null) => void) | null;
}

interface DialogContextValue {
  confirm: (message: string, options?: {
    title?: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "default" | "danger" | "warning";
  }) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string, options?: {
    title?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
  }) => Promise<string | null>;
}

// ── Context ────────────────────────────────────────────────────────────────────
const DialogContext = createContext<DialogContextValue | null>(null);

export function useAppDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useAppDialog must be used within AppDialogProvider");
  return ctx;
}

// ── Backdrop ───────────────────────────────────────────────────────────────────
function Backdrop({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-[2px]"
      style={{ animation: "fadeIn 150ms ease" }}
    />
  );
}

// ── Confirm Dialog ─────────────────────────────────────────────────────────────
function ConfirmDialog({ state, onConfirm, onCancel }: {
  state: ConfirmState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!state.open) return null;

  const confirmColor =
    state.variant === "danger"
      ? "bg-red-500 hover:bg-red-600 active:bg-red-700 text-white"
      : state.variant === "warning"
      ? "bg-yellow-500 hover:bg-yellow-600 active:bg-yellow-700 text-black"
      : "bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-100";

  return (
    <>
      <Backdrop onClick={onCancel} />
      <div
        className="fixed inset-0 z-[201] flex items-center justify-center px-6 pointer-events-none"
      >
        <div
          className="pointer-events-auto w-full max-w-[320px] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden"
          style={{ animation: "dialogSlideUp 200ms cubic-bezier(0.34,1.56,0.64,1)" }}
        >
          {/* Content */}
          <div className="px-5 pt-6 pb-5 text-center space-y-2">
            {state.title && (
              <p className="text-[15px] font-bold text-zinc-900 dark:text-white leading-snug">
                {state.title}
              </p>
            )}
            <p className={`text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed whitespace-pre-line ${!state.title ? "font-medium text-zinc-800 dark:text-zinc-200 text-[14px]" : ""}`}>
              {state.message}
            </p>
          </div>

          {/* Divider */}
          <div className="h-px bg-zinc-200 dark:bg-zinc-700" />

          {/* Buttons */}
          <div className="flex">
            <button
              onClick={onCancel}
              className="flex-1 py-3.5 text-[14px] font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 active:bg-zinc-100 transition-colors"
            >
              {state.cancelText}
            </button>
            <div className="w-px bg-zinc-200 dark:bg-zinc-700" />
            <button
              onClick={onConfirm}
              className={`flex-1 py-3.5 text-[14px] font-semibold transition-colors ${confirmColor}`}
            >
              {state.confirmText}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Prompt Dialog ──────────────────────────────────────────────────────────────
function PromptDialog({ state, onConfirm, onCancel }: {
  state: PromptState;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(state.defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset value when dialog opens
  useEffect(() => {
    setValue(state.defaultValue);
    if (state.open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [state.open, state.defaultValue]);

  if (!state.open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onConfirm(value);
    if (e.key === "Escape") onCancel();
  };

  return (
    <>
      <Backdrop onClick={onCancel} />
      <div className="fixed inset-0 z-[201] flex items-center justify-center px-6 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-[320px] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden"
          style={{ animation: "dialogSlideUp 200ms cubic-bezier(0.34,1.56,0.64,1)" }}
        >
          {/* Content */}
          <div className="px-5 pt-6 pb-4 space-y-3">
            {state.title && (
              <p className="text-[15px] font-bold text-zinc-900 dark:text-white text-center leading-snug">
                {state.title}
              </p>
            )}
            <p className={`text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed whitespace-pre-line text-center ${!state.title ? "font-medium text-zinc-800 dark:text-zinc-200 text-[14px]" : ""}`}>
              {state.message}
            </p>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={state.placeholder}
              className="w-full mt-1 px-3 py-2.5 text-[14px] bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
            />
          </div>

          {/* Divider */}
          <div className="h-px bg-zinc-200 dark:bg-zinc-700" />

          {/* Buttons */}
          <div className="flex">
            <button
              onClick={onCancel}
              className="flex-1 py-3.5 text-[14px] font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 active:bg-zinc-100 transition-colors"
            >
              {state.cancelText}
            </button>
            <div className="w-px bg-zinc-200 dark:bg-zinc-700" />
            <button
              onClick={() => onConfirm(value)}
              className="flex-1 py-3.5 text-[14px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-zinc-800 active:bg-blue-100 transition-colors"
            >
              {state.confirmText}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Provider ───────────────────────────────────────────────────────────────────
export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    message: "",
    confirmText: "OK",
    cancelText: "Cancel",
    variant: "default",
    resolve: null,
  });

  const [promptState, setPromptState] = useState<PromptState>({
    open: false,
    message: "",
    defaultValue: "",
    placeholder: "",
    confirmText: "OK",
    cancelText: "Cancel",
    resolve: null,
  });

  const confirm = useCallback((
    message: string,
    options?: {
      title?: string;
      confirmText?: string;
      cancelText?: string;
      variant?: "default" | "danger" | "warning";
    }
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        open: true,
        message,
        title: options?.title,
        confirmText: options?.confirmText ?? "OK",
        cancelText: options?.cancelText ?? "Cancel",
        variant: options?.variant ?? "default",
        resolve,
      });
    });
  }, []);

  const prompt = useCallback((
    message: string,
    defaultValue = "",
    options?: {
      title?: string;
      placeholder?: string;
      confirmText?: string;
      cancelText?: string;
    }
  ): Promise<string | null> => {
    return new Promise((resolve) => {
      setPromptState({
        open: true,
        message,
        title: options?.title,
        defaultValue,
        placeholder: options?.placeholder ?? "",
        confirmText: options?.confirmText ?? "OK",
        cancelText: options?.cancelText ?? "Cancel",
        resolve,
      });
    });
  }, []);

  const handleConfirmOk = () => {
    confirmState.resolve?.(true);
    setConfirmState(s => ({ ...s, open: false, resolve: null }));
  };

  const handleConfirmCancel = () => {
    confirmState.resolve?.(false);
    setConfirmState(s => ({ ...s, open: false, resolve: null }));
  };

  const handlePromptOk = (value: string) => {
    promptState.resolve?.(value);
    setPromptState(s => ({ ...s, open: false, resolve: null }));
  };

  const handlePromptCancel = () => {
    promptState.resolve?.(null);
    setPromptState(s => ({ ...s, open: false, resolve: null }));
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes dialogSlideUp {
          from { opacity: 0; transform: scale(0.92) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {children}

      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirmOk}
        onCancel={handleConfirmCancel}
      />
      <PromptDialog
        state={promptState}
        onConfirm={handlePromptOk}
        onCancel={handlePromptCancel}
      />
    </DialogContext.Provider>
  );
}
