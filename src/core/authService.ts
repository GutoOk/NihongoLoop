// AuthService centralizado com perfil de dev para viabilizar banco remoto

import { supabase } from './supabaseClient';

export class AuthService {
  private static cachedUserId: string | null = null;
  private static userIsAdmin: boolean = false;
  
  static setUserId(id: string | null) {
      this.cachedUserId = id;
  }
  
  static getCurrentUserId(): string {
    if (!this.cachedUserId) {
      throw new Error("Usuário não autenticado, por favor faça login.");
    }
    return this.cachedUserId;
  }

  static isAppAdmin(): boolean {
      return this.userIsAdmin;
  }
  
  static async checkAppAdmin(): Promise<boolean> {
      if (!supabase) return false;
      try {
          const { data, error } = await supabase.rpc('is_app_admin');
          if (error) {
              console.error("Erro ao verificar admin:", error);
              this.userIsAdmin = false;
              return false;
          }
          this.userIsAdmin = Boolean(data);
          return this.userIsAdmin;
      } catch (e) {
          console.error("Exceção ao verificar admin:", e);
          this.userIsAdmin = false;
          return false;
      }
  }
}

