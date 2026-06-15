import React, { createContext, useContext, useState, ReactNode } from "react";
import { AlertCircle, Info } from "lucide-react";

type ModalType = "alert" | "confirm";

interface ModalOptions {
  type: ModalType;
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ModalContextType {
  showAlert: (title: string, message: string) => void;
  showConfirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    confirmLabel?: string,
  ) => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) throw new Error("useModal must be used within ModalProvider");
  return context;
};

export const ModalProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [modal, setModal] = useState<ModalOptions | null>(null);

  const showAlert = (title: string, message: string) => {
    setModal({ type: "alert", title, message });
  };

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    confirmLabel: string = "Confirmar",
  ) => {
    setModal({
      type: "confirm",
      title,
      message,
      confirmLabel,
      onConfirm: () => {
        onConfirm();
        setModal(null);
      },
      onCancel: () => setModal(null),
    });
  };

  const close = () => setModal(null);

  return (
    <ModalContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      {modal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
              <div className="p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div
                    className={`p-2 rounded-full ${modal.type === "alert" ? "bg-indigo-50 text-indigo-600" : "bg-rose-50 text-rose-600"}`}
                  >
                    {modal.type === "alert" ? (
                      <Info className="w-6 h-6" />
                    ) : (
                      <AlertCircle className="w-6 h-6" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <h3 className="text-lg font-bold text-slate-900">
                      {modal.title}
                    </h3>
                    <p className="text-sm text-slate-500 leading-relaxed flex flex-col gap-2">
                      {modal.message.split("\n").map((line, i) => (
                        <span key={i}>{line}</span>
                      ))}
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-slate-50/50 flex items-center justify-end gap-2 border-t border-slate-100">
                {modal.type === "confirm" && (
                  <button
                    onClick={modal.onCancel || close}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  onClick={modal.type === "confirm" ? modal.onConfirm : close}
                  className={`px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors flex items-center justify-center ${
                    modal.type === "alert"
                      ? "bg-indigo-600 hover:bg-indigo-700"
                      : "bg-rose-600 hover:bg-rose-700"
                  }`}
                >
                  {modal.type === "confirm"
                    ? modal.confirmLabel || "Confirmar"
                    : "OK"}
                </button>
              </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
};
