import { ArrowLeft } from "lucide-react";
import { GlobalAiQueueControl } from "./GlobalAiQueueControl";

export default function PendingAiScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen-gray relative">
      <header className="screen-header flex-col gap-2 items-stretch" style={{ paddingBottom: "16px" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="btn-back"
              aria-label="Voltar"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="screen-title">Fila do servidor</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 pb-32">
        <div className="mx-auto max-w-4xl">
          <GlobalAiQueueControl />
        </div>
      </main>
    </div>
  );
}
