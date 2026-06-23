import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, FileText, BookOpen, Trash2, Folder, FolderPlus, Layers3, X, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { SourceRepository, SentenceRepository } from "../repositories";
import { Source, Sentence, SourceGroup, SourceGroupMembership } from "../types";
import { useModal } from "./ModalProvider";
import { CustomDeck, FlashcardStore } from "../services/flashcardService";

interface SourcesScreenProps {
  onBack: () => void;
  onNavigateImport: () => void;
  onSelectSource: (sourceId: string) => void;
  onStudyGroup: (groupId: string, sourceIds: string[]) => void;
  onStudyDeck?: (deck: CustomDeck) => void;
}

export default function SourcesScreen({
  onBack,
  onNavigateImport,
  onSelectSource,
  onStudyGroup,
  onStudyDeck,
}: SourcesScreenProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [decks, setDecks] = useState<CustomDeck[]>([]);
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
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({});
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
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
        const [groupData, membershipData, flashcardData] = await Promise.all([
          SourceRepository.getGroups(),
          SourceRepository.getGroupMemberships(),
          FlashcardStore.hydrateRemote(),
        ]);
        setGroups(groupData);
        setMemberships(membershipData);
        setDecks(flashcardData.decks);
      } catch (groupErr) {
        console.error("Falha ao carregar grupos/vínculos/baralhos:", groupErr);
        setGroupsError(true);
        setGroups([]);
        setMemberships([]);
        setDecks([]);
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
  const visibleDecks = useMemo(() => {
    return decks.filter((deck) => {
      const deckGroupIds = deck.config.groupIds || [];
      if (selectedGroupId === "all") return true;
      if (selectedGroupId === "ungrouped") return deckGroupIds.length === 0;
      const groupIds = collectGroupAndDescendants(groups, selectedGroupId);
      return deckGroupIds.some((id) => groupIds.has(id));
    });
  }, [decks, groups, selectedGroupId]);
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

  const handleToggleDeckGroupMembership = async (deckId: string, groupId: string, isCurrentlyMember: boolean) => {
    try {
      const deck = decks.find((d) => d.id === deckId);
      if (!deck) return;
      const currentGroups = deck.config.groupIds || [];
      const newGroups = isCurrentlyMember
        ? currentGroups.filter((id) => id !== groupId)
        : [...currentGroups, groupId];
      const updatedConfig = { ...deck.config, groupIds: newGroups };
      await FlashcardStore.updateDeckRemote(deckId, { config: updatedConfig });
      await loadSources();
    } catch (err: any) {
      showAlert("Não foi possível organizar baralho", err?.message || "Tente novamente.");
    }
  };

  const handleDeleteDeck = (deckId: string) => {
    showConfirm(
      "Excluir Baralho",
      "Tem certeza que deseja excluir este baralho personalizado? As palavras/frases originais não serão apagadas.",
      async () => {
        try {
          await FlashcardStore.deleteDeckRemote(deckId);
          await loadSources();
        } catch (err: any) {
          showAlert("Não foi possível excluir baralho", err?.message || "Tente novamente.");
        }
      },
      "Excluir"
    );
  };

  const handleDragStart = (e: React.DragEvent, itemId: string, itemType: "source" | "deck") => {
    e.dataTransfer.setData("itemId", itemId);
    e.dataTransfer.setData("itemType", itemType);
  };

  const handleGroupDragStart = (e: React.DragEvent, groupId: string) => {
    e.dataTransfer.setData("draggedGroupId", groupId);
  };

  const handleDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    setDragOverGroupId(null);
    const itemId = e.dataTransfer.getData("itemId");
    const itemType = e.dataTransfer.getData("itemType") as "source" | "deck";
    const draggedGroupId = e.dataTransfer.getData("draggedGroupId");

    if (draggedGroupId) {
      if (draggedGroupId === targetGroupId) return;

      if (targetGroupId !== "all" && targetGroupId !== "ungrouped") {
        const descendants = collectGroupAndDescendants(groups, draggedGroupId);
        if (descendants.has(targetGroupId)) {
          showAlert("Movimento inválido", "Não é possível mover uma pasta para dentro de si mesma ou de suas subpastas.");
          return;
        }
      }

      const parentId = (targetGroupId === "all" || targetGroupId === "ungrouped") ? null : targetGroupId;
      try {
        await SourceRepository.updateGroup(draggedGroupId, { parent_id: parentId });
        await loadSources();
      } catch (err: any) {
        showAlert("Erro ao mover grupo", err?.message || "Tente novamente.");
      }
      return;
    }

    if (!itemId) return;

    try {
      if (itemType === "source") {
        let newGroups: string[] = [];
        if (targetGroupId !== "all" && targetGroupId !== "ungrouped") {
          const currentGroups = membershipsBySource.get(itemId) || [];
          if (!currentGroups.includes(targetGroupId)) {
            newGroups = [...currentGroups, targetGroupId];
          } else {
            newGroups = currentGroups;
          }
        }
        await SourceRepository.setSourceGroups(itemId, newGroups);
      } else if (itemType === "deck") {
        const deck = decks.find((d) => d.id === itemId);
        if (deck) {
          let newGroups: string[] = [];
          if (targetGroupId !== "all" && targetGroupId !== "ungrouped") {
            const currentGroups = deck.config.groupIds || [];
            if (!currentGroups.includes(targetGroupId)) {
              newGroups = [...currentGroups, targetGroupId];
            } else {
              newGroups = currentGroups;
            }
          }
          const updatedConfig = { ...deck.config, groupIds: newGroups };
          await FlashcardStore.updateDeckRemote(itemId, { config: updatedConfig });
        }
      }
      await loadSources();
    } catch (err: any) {
      showAlert("Não foi possível mover o item", err?.message || "Tente novamente.");
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
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={() => setDragOverGroupId("all")}
              onDragLeave={() => setDragOverGroupId(null)}
              onDrop={(e) => handleDrop(e, "all")}
              className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-left transition-all ${selectedGroupId === "all" ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-[#E5E5E7] bg-white text-slate-700"} ${dragOverGroupId === "all" ? "border-indigo-500 bg-indigo-100/50" : ""}`}
            >
              <span className="flex items-center gap-2 text-xs font-black"><Layers3 className="w-4 h-4" /> Todas as fontes</span>
              <span className="text-[10px] font-bold">{sources.length + decks.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedGroupId("ungrouped")}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={() => setDragOverGroupId("ungrouped")}
              onDragLeave={() => setDragOverGroupId(null)}
              onDrop={(e) => handleDrop(e, "ungrouped")}
              className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-left transition-all ${selectedGroupId === "ungrouped" ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-[#E5E5E7] bg-white text-slate-700"} ${dragOverGroupId === "ungrouped" ? "border-indigo-500 bg-indigo-100/50" : ""}`}
            >
              <span className="flex items-center gap-2 text-xs font-black"><Folder className="w-4 h-4" /> Sem grupo</span>
              <span className="text-[10px] font-bold">
                {sources.filter((source) => !(membershipsBySource.get(source.id)?.length)).length + 
                 decks.filter((deck) => !(deck.config.groupIds?.length)).length}
              </span>
            </button>
            {flattenedGroups.map(({ group, depth }) => {
              const ids = collectGroupAndDescendants(groups, group.id);
              const sourcesCount = new Set(memberships.filter((item) => ids.has(item.group_id)).map((item) => item.source_id)).size;
              const decksCount = decks.filter((deck) => (deck.config.groupIds || []).some((gid) => ids.has(gid))).length;
              const count = sourcesCount + decksCount;

              return (
                <div
                  key={group.id}
                  draggable
                  onDragStart={(e) => handleGroupDragStart(e, group.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnter={() => setDragOverGroupId(group.id)}
                  onDragLeave={() => setDragOverGroupId(null)}
                  onDrop={(e) => handleDrop(e, group.id)}
                  className="flex items-center gap-2 cursor-grab active:cursor-grabbing"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedGroupId(group.id)}
                    className={`flex-1 flex items-center justify-between rounded-xl border px-3 py-2 text-left transition-all ${selectedGroupId === group.id ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-[#E5E5E7] bg-white text-slate-700"} ${dragOverGroupId === group.id ? "border-indigo-500 bg-indigo-100/50" : ""}`}
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
        ) : (sources.length === 0 && decks.length === 0) ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <FileText className="w-7 h-7 text-[#86868B]" />
            </div>
            <h3 className="text-sm font-bold text-[#1D1D1F]">Nenhuma fonte ou baralho</h3>
            <p className="text-xs text-[#86868B] max-w-[200px]">
              Adicione textos ou crie baralhos de flashcards para estudar.
            </p>
            <button
              type="button"
              onClick={onNavigateImport}
              className="btn btn-primary w-auto px-5 mt-1"
            >
              Importar Agora
            </button>
          </div>
        ) : (visibleSources.length === 0 && visibleDecks.length === 0) ? (
          <div className="empty-state bg-slate-50/50 border border-dashed border-slate-200 rounded-2xl p-6">
            <div className="empty-state-icon text-slate-300 mb-2">
              <Folder className="w-8 h-8 mx-auto" />
            </div>
            <h3 className="text-xs font-bold text-[#1D1D1F]">Pasta Vazia</h3>
            <p className="text-[10px] text-[#86868B] max-w-[200px] mt-1">
              Arraste fontes ou baralhos para cá ou use as opções de marcação direta.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Render Sources */}
            {visibleSources.map((source) => {
              const sentences = sentencesBySource[source.id] || [];
              const readCount = sentences.filter((s) => s.status !== "raw").length;
              const sourceGroupIds = membershipsBySource.get(source.id) || [];
              const sentencesFailed = failedSentenceLoads[source.id];
              const isCollapsed = collapsedItems[source.id] ?? true;

              return (
                <div
                  key={source.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, source.id, 'source')}
                  className={`card flex flex-col gap-4 transition-all cursor-grab active:cursor-grabbing ${isCollapsed ? 'py-3' : 'py-4'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex items-center self-center text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing mr-0.5" title="Arraste para mover para uma pasta">
                      <GripVertical className="w-4 h-4 shrink-0" />
                    </div>
                    <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-xl shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="text-sm font-bold text-[#1D1D1F] line-clamp-1">
                          {source.title}
                        </h3>
                        <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
                          <button
                            type="button"
                            onClick={() => setCollapsedItems((prev) => ({ ...prev, [source.id]: !isCollapsed }))}
                            className="text-slate-400 hover:text-slate-600 p-1"
                            aria-label={isCollapsed ? "Expandir" : "Recolher"}
                          >
                            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSource(source)}
                            className="text-rose-400 hover:text-rose-600 p-1 transition-colors shrink-0"
                            aria-label={`Excluir ${source.title}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
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

                  {!isCollapsed && (
                    <div className="space-y-3 border-t border-slate-100 pt-3 mt-1">
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
                  )}
                </div>
              );
            })}

            {/* Render Decks */}
            {visibleDecks.map((deck) => {
              const cardCount = deck.config.deckKind === "sentences"
                ? deck.config.sentenceIds?.length || 0
                : deck.config.entryIds?.length || 0;
              const deckGroupIds = deck.config.groupIds || [];
              const isCollapsed = collapsedItems[deck.id] ?? true;

              return (
                <div
                  key={deck.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, deck.id, 'deck')}
                  className={`card flex flex-col gap-4 border-l-4 transition-all cursor-grab active:cursor-grabbing ${isCollapsed ? 'py-3' : 'py-4'} ${DECK_BORDER_CLASSES[deck.color] || 'border-l-indigo-500'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex items-center self-center text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing mr-0.5" title="Arraste para mover para uma pasta">
                      <GripVertical className="w-4 h-4 shrink-0" />
                    </div>
                    <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-xl shrink-0">
                      <Layers3 className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="text-sm font-bold text-[#1D1D1F] line-clamp-1">
                          {deck.name}
                        </h3>
                        <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
                          <button
                            type="button"
                            onClick={() => setCollapsedItems((prev) => ({ ...prev, [deck.id]: !isCollapsed }))}
                            className="text-slate-400 hover:text-slate-600 p-1"
                            aria-label={isCollapsed ? "Expandir" : "Recolher"}
                          >
                            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDeck(deck.id)}
                            className="text-rose-400 hover:text-rose-600 p-1 transition-colors"
                            aria-label={`Excluir ${deck.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-mono font-bold text-[#86868B] bg-[#F5F5F7] px-1.5 py-0.5 rounded">
                          BARALHO
                        </span>
                        <span className="text-[10px] text-[#86868B] font-bold">
                          {cardCount} {deck.config.deckKind === "sentences" ? "frases" : "palavras"}
                        </span>
                      </div>
                      {deckGroupIds.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {deckGroupIds.map((groupId) => {
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

                  {!isCollapsed && (
                    <div className="space-y-3 border-t border-slate-100 pt-3 mt-1">
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Organizar em Grupos</span>
                        {flattenedGroups.length === 0 ? (
                          <p className="text-[10px] font-medium text-slate-400">Crie um grupo acima para organizar.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {flattenedGroups.map(({ group }) => {
                              const isMember = deckGroupIds.includes(group.id);
                              return (
                                <button
                                  key={group.id}
                                  type="button"
                                  onClick={() => handleToggleDeckGroupMembership(deck.id, group.id, isMember)}
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
                        onClick={() => onStudyDeck?.(deck)}
                        className="w-full flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-black uppercase tracking-widest py-3 rounded-xl transition-colors"
                      >
                        <BookOpen className="w-4 h-4" /> Estudar Baralho
                      </button>
                    </div>
                  )}
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

const DECK_BORDER_CLASSES: Record<string, string> = {
  indigo: "border-l-indigo-500",
  violet: "border-l-violet-500",
  emerald: "border-l-emerald-500",
  sky: "border-l-sky-500",
  amber: "border-l-amber-500",
  rose: "border-l-rose-500",
  teal: "border-l-teal-500",
  fuchsia: "border-l-fuchsia-500",
};
