import React from "react";
import { Lock } from "lucide-react";
import { supabase } from "../core/supabaseClient";

export default function UnauthorizedScreen() {
  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#F5F5F7] p-6 text-center">
      <div className="bg-white p-8 rounded-2xl border border-[#E5E5E7] max-w-sm w-full space-y-5">
        <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto">
          <Lock className="w-7 h-7" />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-bold text-[#1D1D1F]">Acesso Restrito</h1>
          <p className="text-sm text-[#86868B] leading-relaxed">
            Por enquanto, o sistema é apenas para administradores. Se você
            possui credenciais de administrador, faça login com a conta correta.
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="btn btn-primary"
        >
          Sair
        </button>
      </div>
    </div>
  );
}
