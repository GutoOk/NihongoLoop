import React, { useState } from "react";
import { motion } from "motion/react";
import { Lock, Mail, Eye, EyeOff, UserPlus, LogIn } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../core/supabaseClient";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setErrorMessage("Supabase não está configurado. Verifique suas variáveis de ambiente.");
      return;
    }

    if (!email || !password) {
      setErrorMessage("Por favor, preencha todos os campos.");
      return;
    }

    setLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      if (isSignUp) {
        const { data, error } = await supabase!.auth.signUp({
          email,
          password,
        });

        if (error) throw error;
        
        if (data.session) {
          setSuccessMessage("Conta criada e login efetuado com sucesso!");
        } else {
          setSuccessMessage("Cadastro realizado! Por favor, verifique sua caixa de e-mail para confirmar a conta.");
          setIsSignUp(false);
        }
      } else {
        const { error } = await supabase!.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Ocorreu um erro ao processar sua solicitação.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F0F3] flex flex-col items-center justify-center p-6 text-[#1D1D1F]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8"
      >
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center shadow-sm text-white">
            {isSignUp ? <UserPlus className="w-8 h-8" /> : <LogIn className="w-8 h-8" />}
          </div>
        </div>

        <h1 className="text-2xl font-black text-center tracking-tight mb-2">
          {isSignUp ? "Criar Minha Conta" : "Entrar no Nihongo Loop"}
        </h1>
        <p className="text-sm text-gray-500 text-center mb-8">
          {isSignUp 
            ? "Cadastre-se para sincronizar seus estudos em múltiplos dispositivos." 
            : "Insira seu e-mail e senha para continuar sua jornada."}
        </p>

        {errorMessage && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-center text-xs font-semibold">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 bg-green-50 border border-green-100 text-green-700 rounded-xl text-center text-xs font-semibold">
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
              E-mail
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                <Mail className="w-4 h-4" />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.email@exemplo.com"
                className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none transition-all focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
              Senha
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                <Lock className="w-4 h-4" />
              </span>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Sua senha secreta"
                className="w-full pl-11 pr-11 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none transition-all focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-slate-600 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-slate-900 border border-slate-900 rounded-xl font-bold text-white hover:bg-black transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none mt-2 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isSignUp ? (
              "Cadastrar e Começar"
            ) : (
              "Acessar Minha Conta"
            )}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-gray-100 text-center">
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setErrorMessage("");
              setSuccessMessage("");
            }}
            className="text-xs font-bold text-slate-700 hover:text-slate-900 underline transition-colors"
          >
            {isSignUp ? "Já tem uma conta? Faça login" : "Não tem conta? Cadastre-se gratuitamente"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
