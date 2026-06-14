import React from 'react';
import { supabase } from '../core/supabaseClient';

export default function UnauthorizedScreen() {
  const handleLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#F5F5F7] p-6 text-center">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-red-100 max-w-sm">
        <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-[#1D1D1F] mb-3">Acesso Restrito</h1>
        <p className="text-sm text-[#86868B] mb-8 leading-relaxed">
          Por enquanto, o sistema é só para administradores. Se você possuir credenciais de administrador, por favor faça login com a conta correta.
        </p>
        <button
          onClick={handleLogout}
          className="w-full bg-[#1D1D1F] text-white py-3 rounded-xl font-medium"
        >
          Sair
        </button>
      </div>
    </div>
  );
}
