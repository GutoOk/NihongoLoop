import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, FileText, BookOpen, Trash2, Folder, FolderPlus, Layers3, X } from "lucide-react";
import { SourceRepository, SentenceRepository } from "../repositories";
import { Source, Sentence, SourceGroup, SourceGroupMembership } from "../types";
import { useModal } from "./ModalProvider";

interface SourcesScreenProps {
  onBack: () => void;
  onNavigateImport: () => void;
  onSelectSource: (sourceId: string) => void;
  onStudyGroup: (groupId: string, sourceIds: string[]) => void;
}

export default function SourcesScreen({
  onBack,
  onNavigateImport,
  onSelectSource,
  onStudyGroup,
}: SourcesScreenProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [groups, setGroups] = useState<SourceGroup[]>([]);
  const [memberships, setMemberships] = useState<SourceGroupMembership[]>([]);
  const [sentencesBySource, setSentencesBySource] = useState<Record<string, Sentence[]>>({});
  const [selectedGroupId, setSelectedGroupId] = useState("all");
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [parentGroupId, setParentGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupsError, setGroupsError] = useState(false);
  const [failedSentenceLoads, setFailedSentenceLoads] = useState<Record<string, boolean>>({});
  const { showConfirm, showAlert } = useModal();

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    setLoading(true);
    setError(null);
    setGroupsError(false);
    try {
      const data = await SourceRepository.getAll();
      setSources(data);

      try {
        const [groupData, membershipData] = await Promise.all([
          SourceRepository.getGroups(),
          SourceRepository.getGroupMemberships(),
        ]);
        setGroups(groupData);
        setMemberships(membershipData);
      } catch (groupErr) {
        console.error("Falha ao carregar grupos/vínculos de fontes:", groupErr);
        setGroupsError(true);
        setGroups([]);
        setMemberships([]);
      }

      const sentencesMap: Record<string, Sentence[]> = {};
      const failedMap: Record<string, boolean> = {};
      await Promise.allSettled(
        data.map(async (source) => {
          try {
            sentencesMap[source.id] = await SentenceRepository.getBySourceId(source.id);
          } catch (sentErr) {
            console.error(`Falha ao carregar frases da fonte ${source.id}:`, sentErr);
            failedMap[source.id] = true;
          }
        })
      );
      setSentencesBySource(sentencesMap);
      setFailedSentenceLoads(failedMap);
    } catch (err: any) {
      console.error("Erro ao carregar fontes:", err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const flattenedGroups = useMemo(() => flattenGroups(groups), [groups]);
  const membershipsBySource = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const membership of memberships) {
      map.set(membership.source_id, [...(map.get(membership.source_id) || []), membership.group_id]);
    }
    return map;
  }, [memberships]);
  const selectedGroupSourceIds = useMemo<Set<string>>(() => {
    if (selectedGroupId === "all") return new Set(sources.map((source) => source.id));
    if (selectedGroupId === "ungrouped") {
      return new Set(sources.filter((source) => !(membershipsBySource.get(source.id)?.length)).map((source) => source.id));
    }
    const groupIds = collectGroupAndDescendants(groups, selectedGroupId);
    return new Set(memberships.filter((item) => groupIds.has(item.group_id)).map((item) => item.source_id));
  }, [groups, memberships, membershipsBySource, selectedGroupId, sources]);
  const visibleSources = useMemo(
    () => sources.filter((source) => selectedGroupSourceIds.has(source.id)),
    [selectedGroupSourceIds, sources],
  );
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || null;

  const handleDeleteSource = (source: Source) => {
    showConfirm(
      "Excluir Fonte",
      `Tem certeza que deseja excluir "${source.title}"?\nIsso apagará todas as frases e estatísticas associadas a esta fonte.`,
      async () => {
        await SourceRepository.delete(source.id);
        loadSources();
      },
      "Excluir",
    );
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) return;
    try {
      await SourceRepository.createGroup({
        name: groupName,
        parent_id: parentGroupId || null,
        position: groups.length,
      });
      setGroupName("");
      setParentGroupId("");
      setShowGroupForm(false);
      await loadSources();
    } catch (err: any) {
      showAlert("Nao foi possivel criar grupo", err?.message || "Tente novamente.");
    }
  };

  const handleDeleteGroup = (group: SourceGroup) => {
    showConfirm(
      "Excluir grupo",
      `Excluir "${group.name}"? Subgrupos e vinculos com textos tambem serao removidos. Os textos nao serao apagados.`,
      async () => {
        await SourceRepository.deleteGroup(group.id);
        setSelectedGroupId("all");
        await loadSources();
      },
      "Excluir",
    );
  };

  const handleToggleGroupMembership = async (sourceId: string, groupId: string, isCurrentlyMember: boolean) => {
    try {
      const currentGroups = membershipsBySource.get(sourceId) || [];
      const newGroups = isCurrentlyMember
        ? currentGroups.filter((id) => id !== groupId)
        : [...currentGroups, groupId];
      await SourceRepository.setSourceGroups(sourceId, newGroups);
      await loadSources();
    } catch (err: any) {
      showAlert("Nao foi possivel organizar fonte", err?.message || "Tente novamente.");
    }
  };

  const currentGroupSourceIds: string[] = Array.from(selectedGroupSourceIds);

  return (
    <div className="screen">
      <header className="screen-header justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="btn-back"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="screen-title">Minhas Fontes</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowGroupForm((value) => !value)} className="btn-back" aria-label="Criar grupo">
            <FolderPlus className="w-5 h-5 text-indigo-600" />
          </button>
          <button type="button" onClick={onNavigateImport} className="btn-back" aria-label="Importar nova fonte">
            <Plus className="w-5 h-5 text-indigo-600" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-4">
        {groupsError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
            A organização por grupos está temporariamente indisponível, mas suas fontes continuam acessíveis.
          </div>
        )}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Grupos de estudo</span>
            {selectedGroup && currentGroupSourceIds.length > 0 && (
              <button
                type="button"
                onClick={() => onStudyGroup(selectedGroup.id, currentGroupSourceIds)}
                className="text-[10px] font-black uppercase tracking-wide text-indigo-600"
              >
                Estudar grupo
              </button>
            )}
          </div>

          {showGroupForm && (
            <div className="card space-y-3">
              <input
                autoFocus
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Nome do grupo"
                className="form-input font-bold"
              />
              <select value={parentGroupId} onChange={(e) => setParentGroupId(e.target.value)} className="form-select">
                <option value="">Grupo principal</option>
                {flattenedGroups.map(({ group, depth }) => (
                  <option key={group.id} value={group.id}>
                    {"  ".repeat(depth)}{group.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowGroupForm(false)} className="btn btn-secondary">Cancelar</button>
                <button type="button" onClick={handleCreateGroup} disabled={!groupName.trim()} className="btn btn-primary disabled:opacity-50">Criar grupo</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setSelectedGroupId("all")}
              className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-left ${selectedGroupId === "all" ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-[#E5E5E7] bg-white text-slate-700"}`}
            >
              <span className="flex items-center gap-2 text-xs font-black"><Layers3 className="w-4 h-4" /> Todas as fontes</span>
              <span className="text-[10px] font-bold">{sources.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedGroupId("ungrouped")}
              className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-left ${selectedGroupId === "ungrouped" ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-[#E5E5E7] bg-white text-slate-700"}`}
            >
              <span className="flex items-center gap-2 text-xs font-black"><Folder className="w-4 h-4" /> Sem grupo</span>
              <span className="text-[10px] font-bold">{sources.filter((source) => !(membershipsBySource.get(source.id)?.length)).length}</span>
            </button>
            {flattenedGroups.map(({ group, depth }) => {
              const ids = collectGroupAndDescendants(groups, group.id);
              const count = new Set(memberships.filter((item) => ids.has(item.group_id)).map((item) => item.source_id)).size;
              return (
                <div key={group.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedGroupId(group.id)}
                    className={`flex-1 flex items-center justify-between rounded-xl border px-3 py-2 text-left ${selectedGroupId === group.id ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-[#E5E5E7] bg-white text-slate-700"}`}
                    style={{ marginLeft: depth * 14 }}
                  >
                    <span className="flex items-center gap-2 text-xs font-black"><Folder className="w-4 h-4" /> {group.name}</span>
                    <span className="text-[10px] font-bold">{count}</span>
                  </button>
                  <button type="button" onClick={() => handleDeleteGroup(group)} className="p-2 text-slate-300 hover:text-rose-500" aria-label={`Excluir grupo ${group.name}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {error ? (
          <div className="empty-state">
            <div className="empty-state-icon bg-rose-50 text-rose-500 p-2.5 rounded-xl">
              <X className="w-7 h-7 text-rose-500" />
            </div>
            <h3 className="text-sm font-bold text-[#1D1D1F] mt-2">Falha ao carregar fontes</h3>
            <p className="text-xs text-[#86868B] max-w-[250px] text-center mt-1">
              {error}
            </p>
            <button
              type="button"
              onClick={loadSources}
              className="btn btn-primary w-auto px-5 mt-3"
            >
              Tentar novamente
            </button>
          </div>
        ) : loading ? (
          <div className="empty-state">
            <span className="spinner text-[#86868B]" />
            <span className="text-sm text-[#86868B]">Carregando fontes…</span>
          </div>
        ) : sources.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <FileText className="w-7 h-7 text-[#86868B]" />
            </div>
            <h3 className="text-sm font-bold text-[#1D1D1F]">Nenhuma fonte</h3>
            <p className="text-xs text-[#86868B] max-w-[200px]">
              Adicione textos, legendas de animes ou roteiros para estudar.
            </p>
            <button
              type="button"
              onClick={onNavigateImport}
              className="btn btn-primary w-auto px-5 mt-1"
            >
              Importar Agora
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleSources.map((source) => {
              const sentences = sentencesBySource[source.id] || [];
              const readCount = sentences.filter((s) => s.status !== "raw").length;
              const sourceGroupIds = membershipsBySource.get(source.id) || [];
              const sentencesFailed = failedSentenceLoads[source.id];
              return (
                <div key={source.id} className="card flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-xl shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="text-sm font-bold text-[#1D1D1F] line-clamp-1">
                          {source.title}
                        </h3>
                        <button
                          type="button"
                          onClick={() => handleDeleteSource(source)}
                          className="text-rose-400 hover:text-rose-600 p-1 -mt-1 -mr-1 transition-colors shrink-0"
                          aria-label={`Excluir ${source.title}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-mono font-bold text-[#86868B] bg-[#F5F5F7] px-1.5 py-0.5 rounded">
                          {source.type.toUpperCase()}
                        </span>
                        {sentencesFailed ? (
                          <span className="text-[10px] text-rose-500 font-bold">
                            contagem indisponível
                          </span>
                        ) : (
                          <>
                            <span className="text-[10px] text-[#86868B] font-bold">
                              {sentences.length} frases
                            </span>
                            <span className="text-[10px] text-[#86868B]">·</span>
                            <span className="text-[10px] text-indigo-500 font-bold">
                              {readCount} lidas
                            </span>
                          </>
                        )}
                      </div>
                      {sourceGroupIds.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {sourceGroupIds.map((groupId) => {
                            const group = groups.find((item) => item.id === groupId);
                            return group ? (
                              <span key={groupId} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                {group.name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Organizar em Grupos</span>
                      {flattenedGroups.length === 0 ? (
                        <p className="text-[10px] font-medium text-slate-400">Crie um grupo acima para organizar.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {flattenedGroups.map(({ group }) => {
                            const isMember = sourceGroupIds.includes(group.id);
                            return (
                              <button
                                key={group.id}
                                type="button"
                                onClick={() => handleToggleGroupMembership(source.id, group.id, isMember)}
                                className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition-all ${
                                  isMember
                                    ? "bg-indigo-600 text-white shadow-sm"
                                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                }`}
                              >
                                {group.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectSource(source.id)}
                      className="w-full flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-black uppercase tracking-widest py-3 rounded-xl transition-colors"
                    >
                      <BookOpen className="w-4 h-4" /> Abrir Fonte
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>


    </div>
  );
}

function flattenGroups(groups: SourceGroup[]) {
  const byParent = new Map<string, SourceGroup[]>();
  for (const group of groups) {
    const key = group.parent_id || "root";
    byParent.set(key, [...(byParent.get(key) || []), group]);
  }
  const out: Array<{ group: SourceGroup; depth: number }> = [];
  const visit = (parentId: string, depth: number) => {
    for (const group of byParent.get(parentId) || []) {
      out.push({ group, depth });
      visit(group.id, depth + 1);
    }
  };
  visit("root", 0);
  return out;
}

function collectGroupAndDescendants(groups: SourceGroup[], groupId: string): Set<string> {
  const ids = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (group.parent_id && ids.has(group.parent_id) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }
  return ids;
}
