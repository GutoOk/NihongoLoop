import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { Source, SourceGroup, SourceGroupMembership } from '../types';
import { defaultMockSources } from './mockData';
import { getUserId, isE2EMockMode } from './utils';

const SOURCE_SELECT = 'id,user_id,title,type,created_at,updated_at';
const SOURCE_DETAIL_SELECT = 'id,user_id,title,type,original_content,created_at,updated_at';
const GROUP_SELECT = 'id,user_id,parent_id,name,color,position,created_at,updated_at';
const MEMBERSHIP_SELECT = 'user_id,group_id,source_id,created_at';

export class SourceRepository {
  static async getAll(): Promise<Source[]> {
    if (isE2EMockMode()) return defaultMockSources;
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase!.from('sources').select(SOURCE_SELECT).eq('user_id', getUserId()).order('created_at', { ascending: false });
    if (error) {
      console.error('Erro ao consultar fontes:', error);
      throw new Error(`Erro do Supabase ao consultar fontes: ${error.message}`);
    }
    return (data || []) as unknown as Source[];
  }

  static async getById(id: string): Promise<Source | null> {
    if (isE2EMockMode()) return defaultMockSources.find((s) => s.id === id) || null;
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('sources').select(SOURCE_DETAIL_SELECT).eq('id', id).eq('user_id', getUserId()).maybeSingle();
    return data;
  }

  static async add(source: Omit<Source, 'id' | 'created_at' | 'updated_at'>): Promise<Source | null> {
    if (!isSupabaseConfigured) return null;
    const enriched = {
      title: source.title,
      type: source.type,
      original_content: source.original_content,
      user_id: source.user_id || getUserId()
    };
    const { data, error } = await supabase!.from('sources').insert(enriched).select().maybeSingle();
    if (error) {
      console.error('Falha ao criar source:', error);
      throw new Error(`Erro do Supabase ao criar fonte: ${error.message}`);
    }
    return data;
  }

  static async delete(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('sources').delete().eq('id', id).eq('user_id', getUserId());
    return !error;
  }

  static async getGroups(): Promise<SourceGroup[]> {
    if (isE2EMockMode() || !isSupabaseConfigured) return [];
    const { data, error } = await supabase!
      .from('source_groups')
      .select(GROUP_SELECT)
      .eq('user_id', getUserId())
      .order('position', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw new Error(`Erro do Supabase ao carregar grupos de fontes: ${error.message}`);
    return data || [];
  }

  static async createGroup(input: { name: string; parent_id?: string | null; color?: string; position?: number }): Promise<SourceGroup> {
    if (!isSupabaseConfigured) throw new Error('Supabase nao configurado.');
    const { data, error } = await supabase!
      .from('source_groups')
      .insert({
        user_id: getUserId(),
        name: input.name.trim() || 'Grupo',
        parent_id: input.parent_id || null,
        color: input.color || 'indigo',
        position: Math.max(0, input.position || 0),
      })
      .select(GROUP_SELECT)
      .maybeSingle();
    if (error) throw new Error(`Erro do Supabase ao criar grupo de fontes: ${error.message}`);
    if (!data) throw new Error('Grupo de fontes nao foi criado.');
    return data;
  }

  static async updateGroup(id: string, updates: Partial<Pick<SourceGroup, 'name' | 'parent_id' | 'color' | 'position'>>): Promise<SourceGroup | null> {
    if (!isSupabaseConfigured) throw new Error('Supabase nao configurado.');
    const payload: Record<string, unknown> = {};
    if (updates.name !== undefined) payload.name = updates.name.trim() || 'Grupo';
    if (updates.parent_id !== undefined) payload.parent_id = updates.parent_id || null;
    if (updates.color !== undefined) payload.color = updates.color;
    if (updates.position !== undefined) payload.position = Math.max(0, updates.position);
    const { data, error } = await supabase!
      .from('source_groups')
      .update(payload)
      .eq('id', id)
      .eq('user_id', getUserId())
      .select(GROUP_SELECT)
      .maybeSingle();
    if (error) throw new Error(`Erro do Supabase ao atualizar grupo de fontes: ${error.message}`);
    return data || null;
  }

  static async deleteGroup(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('source_groups').delete().eq('id', id).eq('user_id', getUserId());
    if (error) throw new Error(`Erro do Supabase ao apagar grupo de fontes: ${error.message}`);
    return true;
  }

  static async getGroupMemberships(): Promise<SourceGroupMembership[]> {
    if (isE2EMockMode() || !isSupabaseConfigured) return [];
    const { data, error } = await supabase!
      .from('source_group_memberships')
      .select(MEMBERSHIP_SELECT)
      .eq('user_id', getUserId());
    if (error) throw new Error(`Erro do Supabase ao carregar vinculos de grupos: ${error.message}`);
    return data || [];
  }

  static async setSourceGroups(sourceId: string, groupIds: string[]): Promise<SourceGroupMembership[]> {
    if (!isSupabaseConfigured) throw new Error('Supabase nao configurado.');
    const userId = getUserId();
    const uniqueGroupIds = Array.from(new Set(groupIds.filter(Boolean)));
    const { error: deleteError } = await supabase!
      .from('source_group_memberships')
      .delete()
      .eq('user_id', userId)
      .eq('source_id', sourceId);
    if (deleteError) throw new Error(`Erro do Supabase ao limpar grupos da fonte: ${deleteError.message}`);
    if (uniqueGroupIds.length === 0) return [];
    const { data, error } = await supabase!
      .from('source_group_memberships')
      .insert(uniqueGroupIds.map((groupId) => ({ user_id: userId, source_id: sourceId, group_id: groupId })))
      .select(MEMBERSHIP_SELECT);
    if (error) throw new Error(`Erro do Supabase ao vincular fonte aos grupos: ${error.message}`);
    return data || [];
  }

  static async getSourceIdsByGroupId(groupId: string, includeDescendants = true): Promise<string[]> {
    const [groups, memberships] = await Promise.all([this.getGroups(), this.getGroupMemberships()]);
    const groupIds = new Set([groupId]);
    if (includeDescendants) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const group of groups) {
          if (group.parent_id && groupIds.has(group.parent_id) && !groupIds.has(group.id)) {
            groupIds.add(group.id);
            changed = true;
          }
        }
      }
    }
    return Array.from(new Set(memberships.filter((item) => groupIds.has(item.group_id)).map((item) => item.source_id)));
  }
}
