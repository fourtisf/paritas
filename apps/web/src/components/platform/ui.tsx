"use client";
/**
 * Toasts, the modal layer and popovers (prototype: toast(), openLayer(), openPop()).
 * One modal and one popover at a time, Escape closes the popover first, focus returns to the opener.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { clamp } from "@/lib/format";

interface Toast {
  id: number;
  title: string;
  sub?: string;
  icon: IconName;
}
interface Pop {
  anchor: HTMLElement;
  node: ReactNode;
  align: "left" | "right";
  width?: number;
}
interface UI {
  toast(title: string, sub?: string, icon?: IconName): void;
  openModal(node: ReactNode): void;
  closeModal(): void;
  openPop(anchor: HTMLElement, node: ReactNode, opts?: { align?: "left" | "right"; width?: number }): void;
  closePop(): void;
}

const Ctx = createContext<UI | null>(null);
export const useUI = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useUI outside UIProvider");
  return c;
};

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<ReactNode>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const seq = useRef(0);

  const toast = useCallback((title: string, sub = "", icon: IconName = "check") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, title, sub, icon }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const closeModal = useCallback(() => {
    setModal(null);
    lastFocus.current?.focus?.();
  }, []);
  const openModal = useCallback((node: ReactNode) => {
    lastFocus.current = document.activeElement as HTMLElement;
    setPop(null);
    setModal(node);
  }, []);
  const closePop = useCallback(() => setPop(null), []);
  const openPop = useCallback((anchor: HTMLElement, node: ReactNode, o: { align?: "left" | "right"; width?: number } = {}) => {
    setPop({ anchor, node, align: o.align ?? "right", width: o.width });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pop) setPop(null);
      else if (modal) closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pop, modal, closeModal]);

  return (
    <Ctx.Provider value={{ toast, openModal, closeModal, openPop, closePop }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="status">
            <Icon n={t.icon} />
            <div>
              <div className="toast-t">{t.title}</div>
              {t.sub && <div className="toast-s">{t.sub}</div>}
            </div>
            <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <Icon n="x" />
            </button>
          </div>
        ))}
      </div>
      {modal && <Overlay onClose={closeModal}>{modal}</Overlay>}
      {pop && <Popover pop={pop} onClose={closePop} />}
    </Ctx.Provider>
  );
}

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const o = ref.current;
    const f = o?.querySelector<HTMLElement>("[autofocus]") ?? o?.querySelector<HTMLElement>("button, input, select, a");
    f?.focus();
  }, []);
  return createPortal(
    <div
      className="overlay"
      ref={ref}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-close]")) onClose();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function Popover({ pop, onClose }: { pop: Pop; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const p = ref.current!;
    const r = pop.anchor.getBoundingClientRect();
    const pw = p.offsetWidth;
    setPos({ top: r.bottom + 8 + window.scrollY, left: clamp(pop.align === "right" ? r.right - pw : r.left, 8, window.innerWidth - pw - 8) + window.scrollX });
    const f = p.querySelector<HTMLElement>("input, button, a");
    f?.focus();
  }, [pop]);
  useEffect(() => {
    const out = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !pop.anchor.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", out), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", out);
    };
  }, [pop, onClose]);
  return createPortal(
    <div className="pop" ref={ref} style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0, width: pop.width }}>
      {pop.node}
    </div>,
    document.body,
  );
}

/** Modal header with the close button (prototype mhead). */
export function ModalHead({ title }: { title: string }) {
  return (
    <div className="modal-h">
      <h2 className="modal-t">{title}</h2>
      <button className="icon-btn" data-close aria-label="Close">
        <Icon n="x" />
      </button>
    </div>
  );
}

export function Modal({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`modal${wide ? " wide-m" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
      <div className="foil" style={{ borderRadius: "24px 24px 0 0" }} />
      {children}
    </div>
  );
}
