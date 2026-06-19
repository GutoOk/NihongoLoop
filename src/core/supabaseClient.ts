import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        fetch: async (url, options) => {
          const maxRetries = 4;
          let delay = 1000;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (options?.signal?.aborted) {
              throw options.signal.reason || new Error("Request aborted");
            }
            const timeoutController = new AbortController();
            const upstreamSignal = options?.signal;
            const abortFromUpstream = () => timeoutController.abort(upstreamSignal?.reason || new Error("Request aborted"));
            if (upstreamSignal) {
              upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
            }
            const timeoutId = window.setTimeout(
              () => timeoutController.abort(new Error('Tempo limite excedido na resposta do Supabase (Timeout).')),
              30000,
            );
            try {
              const response = await fetch(url, {
                ...options,
                signal: timeoutController.signal,
              });

              if (response.status >= 500 && attempt < maxRetries) {
                console.warn(`Erro no servidor Supabase ${response.status}. Tentando novamente em ${delay}ms... (Tentativa ${attempt + 1}/${maxRetries + 1})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
              }

              return response;
            } catch (error: any) {
              const abortReason = timeoutController.signal.reason;
              if (options?.signal?.aborted || error?.name === 'AbortError') {
                throw abortReason || error;
              }
              const isTimeout = error?.message?.includes('Tempo limite excedido') || abortReason?.message?.includes('Tempo limite excedido');
              const isNetworkError = error instanceof TypeError || error?.message?.includes('Failed to fetch') || error?.message?.includes('network');

              if ((isTimeout || isNetworkError) && attempt < maxRetries) {
                console.warn(`Erro de rede/timeout do Supabase: ${error.message}. Tentando novamente em ${delay}ms... (Tentativa ${attempt + 1}/${maxRetries + 1})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
              }

              throw error;
            } finally {
              window.clearTimeout(timeoutId);
              if (upstreamSignal) {
                upstreamSignal.removeEventListener('abort', abortFromUpstream);
              }
            }
          }
          throw new Error('Falha ao conectar ao Supabase após várias tentativas de reenvio.');
        }
      }
    })
  : null;
