"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ============================================================
// El aviso breve de la maqueta (`.toast`): una linea sobre el tabbar,
// 2,2 s y se va sola.
//
// No se usa `sonner` (el toaster del escritorio) a proposito: ese
// renderea en una esquina con el sistema visual de shadcn y aca abajo
// del todo hay un tabbar con safe-area propio. Son dos posiciones
// incompatibles y el CSS de la maqueta ya resuelve la de aca.
// ============================================================

const TOAST_MS = 2200;

const ToastContext = createContext<(mensaje: string) => void>(() => {});

/** Mostrar un aviso breve. Fuera del shell movil es un no-op. */
export function useToast(): (mensaje: string) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((texto: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMensaje(texto);
    setVisible(true);
    timerRef.current = setTimeout(() => setVisible(false), TOAST_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* `visibility` la maneja la clase `.on`, no un desmontaje: asi la
          transicion de salida se ve y el nodo no parpadea. */}
      <div className={`m-toast${visible ? " on" : ""}`} role="status" aria-live="polite">
        {mensaje}
      </div>
    </ToastContext.Provider>
  );
}
