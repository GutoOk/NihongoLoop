import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Cpu,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Square,
} from "lucide-react";
import { AiJobRepository } from "../repositories";
import { AiJob } from "../types";
import { useModal } from "./ModalProvider";
import { GlobalAiQueueControl } from "./GlobalAiQueueControl";
import { getJobPreview, isVisibleQueueJob } from "./sourcePreparation/jobDisplay";

export default function PendingAiScreen({ onBack }: { onBack: () => void }) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [loading, setLoading] = useState(true);
  const { showConfirm } = useModal();

  useEffect(() => {
    loadJobs();
    const inv = setInterval(() => {
       loadJobs(true);
    }, 5000);
    return () => clearInterval(inv);
  }, []);

  const loadJobs = async (silent = false) => {
    if(!silent) setLoading(true);
    const data = await AiJobRepository.getAll();
    setJobs(data.filter(isVisibleQueueJob).sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    if(!silent) setLoading(false);
  };

  const statusColors: any = {
    pending: "bg-amber-50 text-amber-600 border border-amber-100",
    running: "bg-sky-50 text-sky-600 border border-sky-100",
    claimed: "bg-sky-50 text-sky-600 border border-sky-100",
    retry_wait: "bg-amber-50 text-amber-700 border border-amber-100",
    needs_review: "bg-purple-50 text-purple-700 border border-purple-100",
    completed: "bg-emerald-50 text-emerald-600 border border-emerald-100",
    error: "bg-rose-50 text-rose-600 border border-rose-100",
    failed: "bg-rose-50 text-rose-600 border border-rose-100",
    rejected: "bg-slate-50 text-slate-500 border border-slate-100",
    cancelled: "bg-rose-50 text-rose-600 border border-rose-100",
  };

  const statusIcons: any = {
    pending: <AlertTriangle className="w-3.5 h-3.5" />,
    running: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
    claimed: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
    retry_wait: <AlertTriangle className="w-3.5 h-3.5" />,
    needs_review: <AlertTriangle className="w-3.5 h-3.5" />,
    completed: <CheckCircle2 className="w-3.5 h-3.5" />,
    error: <XCircle className="w-3.5 h-3.5" />,
    failed: <XCircle className="w-3.5 h-3.5" />,
    rejected: <XCircle className="w-3.5 h-3.5" />,
    cancelled: <XCircle className="w-3.5 h-3.5" />,
  };

  const cancelSingleJob = async (id: string, e: React.MouseEvent) => {
     e.stopPropagation();
     await AiJobRepository.cancelJob(id);
     loadJobs();
  };

  return (
    <div className="screen-gray relative">
      <header className="screen-header flex-col gap-2 items-stretch" style={{ paddingBottom: '16px' }}>
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
            <h1 className="screen-title">Fila de Tarefas (Global)</h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => loadJobs(false)}
              className="btn-back text-indigo-600"
              aria-label="Sincronizar fila"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        
        <div className="mt-4">
           <GlobalAiQueueControl />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-3 pb-32">
        {jobs.length === 0 && !loading && (
          <div className="text-center py-20 text-gray-400">
            <Cpu className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm font-bold">A fila está vazia</p>
          </div>
        )}

        {jobs.length > 0 && (
           <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                 <span className="w-2 h-2 rounded-full bg-slate-300"></span>
                 Detalhes das Tarefas
              </span>
              <span className="text-xs font-bold text-slate-400">
                 {jobs.length} itens totais
              </span>
           </div>
        )}

        {jobs.map((job) => {
          return (
            <div
              key={job.id}
              className="bg-white border rounded-xl p-4 shadow-sm flex gap-3.5 items-start border-[#E5E5E7] transition-all"
            >
              <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                <div className="flex justify-between items-start">
                   <div className="space-y-0.5 min-w-0">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">
                        Tipo de Processamento
                      </span>
                      <h3 className="text-xs font-black font-mono text-slate-800 uppercase truncate">
                        {getJobPreview(job)}
                      </h3>
                   </div>
                   
                   <button onClick={(e) => cancelSingleJob(job.id, e)} className="p-1.5 bg-rose-50 text-rose-500 hover:bg-rose-100 rounded-md transition-colors" title="Cancelar job">
                     <Square className="w-3.5 h-3.5" />
                   </button>
                </div>

                <div className="bg-slate-50/70 rounded-lg p-2.5 border border-slate-100 space-y-1.5">
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs whitespace-nowrap">
                    <span className="font-medium text-slate-600 truncate max-w-[220px]" title={job.type}>
                      {job.type}
                    </span>
                  </div>
                  {job.error && (
                    <div className="text-[10px] text-rose-600 font-medium bg-rose-50/50 p-1.5 rounded flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="leading-tight">{job.error}</span>
                    </div>
                  )}
                  {job.current_step && (
                    <div className="text-[10px] text-sky-600 font-medium bg-sky-50/50 p-1.5 rounded flex items-center gap-1 mt-1">
                      <Play className="w-2.5 h-2.5" />
                      {job.current_step}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                      statusColors[job.status] || statusColors.pending
                    }`}
                  >
                    {statusIcons[job.status]}
                    {job.status === "error" ? "Falha" : job.status}
                  </span>

                  <span className="text-[10px] text-slate-400 font-medium ml-auto">
                    {new Date(job.created_at).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
