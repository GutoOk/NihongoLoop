import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

let aiClient: GoogleGenAI | null = null;

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const supabaseAuthClient = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

const requestCounts = new Map<string, { count: number; resetAt: number }>();

function ipRateLimit(req: any, res: any, next: any) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxLimit = 60; // Max 60 requests/min per IP

  const key = String(ip);
  const clientData = requestCounts.get(key);

  if (!clientData || now > clientData.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + windowMs });
    next();
  } else {
    clientData.count++;
    if (clientData.count > maxLimit) {
      res.status(429).json({ error: "Muitas requisições. Por favor, aguarde 1 minuto." });
    } else {
      next();
    }
  }
}

const allowAuthBypass =
  process.env.NODE_ENV === "test" ||
  process.env.ALLOW_AUTH_BYPASS === "true" ||
  process.env.VITE_E2E_AUTH_BYPASS === "true";

async function authenticateRequest(req: any, res: any, next: any) {
  if (!isSupabaseConfigured || !supabaseAuthClient) {
    if (allowAuthBypass) {
      req.user = { id: "test-user-id" };
      next();
      return;
    }

    res.status(500).json({
      error: "Servidor sem Supabase configurado. Autenticação bloqueada por segurança.",
    });
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Não autorizado: token de autenticação ausente." });
      return;
    }

    const token = authHeader.split(" ")[1];
    const { data: { user }, error } = await supabaseAuthClient.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ error: "Não autorizado: token de autenticação inválido ou expirado." });
      return;
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data: isAdmin, error: adminError } = await userSupabase.rpc("is_app_admin");

    if (adminError || !isAdmin) {
      res.status(403).json({ error: "Não autorizado: usuário não é administrador do sistema." });
      return;
    }

    req.user = user;
    req.supabase = userSupabase;
    next();
  } catch (err: any) {
    res.status(500).json({ error: `Erro na autenticação: ${err.message}` });
  }
}

function getAi() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

function withTimeout<T>(promise: Promise<T>, ms: number = 120000, errorMsg: string = "Tempo limite de 120s excedido na chamada do Gemini (Timeout)."): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(errorMsg)), ms)
  );
  return Promise.race([promise, timeoutPromise]);
}

function cleanAndParseJSON(text: string): any {
  if (!text) return {};
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  return JSON.parse(cleaned);
}

function formatGenAiError(e: any): string {
  const msg = e?.message || String(e);
  if (msg.includes("spending cap") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("exceeded its monthly spending cap")) {
    return "Limite de faturamento / orçamento atingido no Google AI Studio (429 - RESOURCE_EXHAUSTED). Seu projeto ultrapassou os limites e restrições mensais estabelecidos. Por favor, acesse o painel do Google AI Studio em https://ai.studio/spend para estender seu limite ou atualizar os planos de faturamento.";
  }
  return msg;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "2mb" }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Simple edge function-like proxy for AI
  app.post("/api/ai/process-job", ipRateLimit, authenticateRequest, async (req: any, res: any) => {
    try {
      const { job } = req.body;
      if (!job || !job.type) {
        throw new Error("Job invalido");
      }

      if (job.user_id !== req.user.id) {
        res.status(403).json({ error: "Negado: tentativa de processar job de outro usuário." });
        return;
      }

      console.log(`Processing job ${job.id} of type ${job.type}`);

      let prompt = "";
      let responseSchema: any = null;
      const inputObj = typeof job.input === 'object' && job.input !== null ? job.input : (typeof job.result === 'object' && job.result !== null ? job.result : {});

      if (job.type === "translate_sentence") {
         prompt = `Traduza a seguinte frase em japonês para o português com foco em manter a naturalidade e o sentido exato do contexto. 
Frase: "${inputObj.sentence}"`;
         responseSchema = {
           type: Type.OBJECT,
           properties: {
             translation: { type: Type.STRING, description: "Tradução natural em português" }
           },
           required: ["translation"],
         };
      } else if (job.type === "generate_sentence_reading") {
         let knownWordsText = "";
         if (inputObj.known_words && Array.isArray(inputObj.known_words) && inputObj.known_words.length > 0) {
            knownWordsText = `\n\nPALAVRAS DO DICIONÁRIO DO USUÁRIO QUE APARECEM NA FRASE (USE-AS PARA MANTER CONSISTÊNCIA E AJUDAR NA SEGMENTAÇÃO):\nAs seguintes palavras já existem no dicionário do usuário. Prefira reutilizar esses termos/lemmas exatos em seus "terms" correspondentes em vez de inventar ou traduzir diferente, garantindo consistência:\n${JSON.stringify(inputObj.known_words)}\n\n`;
         }
         prompt = `Analise a seguinte frase em japonês: "${inputObj.sentence}"
${knownWordsText}Você deve retornar a leitura completa da frase em Kana (apenas Hiragana/Katakana) e o Romaji correspondente.
Você deve fazer a segmentação gramatical inteligência da frase em palavras/termos no contexto específico desta frase de forma leve e rápida, identificando apenas os termos nela presentes sem traduzi-los ou explicar significados.

ATENÇÃO EXTREMA AO "surface" (MUITO CRÍTICO): O campo "surface" de cada termo DEVE corresponder EXATAMENTE caractere por caractere a uma substring original da frase japonesa fornecida. Não mude Kanjis para Kana, nem Kana para Kanjis na propriedade "surface". Se a frase original contiver "お前ら", o campo "surface" correspondente DEVE ser "お前ら" (e nunca "おまえら" ou "omaera"). Modificar esses caracteres causará uma falha irreparável na localização de termos!

COBERTURA COMPRETA CRÍTICA: Cada caractere/palavra da frase original (excluindo pontuações padrão como "。", "、", "！", "？", "『", "』") DEVE ser mapeado para exatamente um termo na lista de "terms". Nenhuma palavra, partícula (como は, が, を, に, で, と), verbo auxiliar (como です, ます, ない), conector, etc., pode ficar de fora da segmentação. A soma de todas as substrings "surface" dos termos, na ordem correta, deve cobrir INTEGRALMENTE a frase original (com exceção de pontuação). Se a frase contiver conjugações ou sufixos verbais como "しま〜す" ou "おらん", certifique-se de incluí-los como parte de um termo (com o lemma correto na forma de dicionário).

ATENÇÃO CRÍTICA ao conceito de Ocorrências (SentenceTerm) vs. Entrada do Dicionário (DictionaryEntry):
1. Não trate conjugações nem ocorrências contextuais como sendo o próprio verbete de dicionário. O dicionário deve ter apenas a entrada canônica (lemma).
2. Se a frase tiver "落ち着いたか", o SentenceTerm correspondente deve ter:
   - surface: "落ち着いたか" (ou "落ち着いた")
   - lemma: "落ち着く" (forma de dicionário)
   - kana: Leitura contextual (ex: "おちついたか")
   - romaji: Leitura contextual (ex: "ochitsuita ka")
   - type: "verbo"

Para cada termo identificado na frase, determine as propriedades básicas no esquema. O start_index (0-based) e end_index (exclusivo) devem ser extremamente precisos, correspondendo exatamente à posição do "surface" na frase original.`;
         responseSchema = {
           type: Type.OBJECT,
           properties: {
             kana: { type: Type.STRING, description: "Leitura em Kana de toda a frase" },
             romaji: { type: Type.STRING, description: "Leitura em Romaji de toda a frase, estritamente em minúsculas (caixa baixa)." },
             terms: {
               type: Type.ARRAY,
               items: {
                 type: Type.OBJECT,
                 properties: {
                   surface: { type: Type.STRING, description: "O trecho exato correspondente ao termo na frase japonesa." },
                   lemma: { type: Type.STRING, description: "A forma base/dicionário (ex: para 落ち着いた, o lemma é 落ち着く)." },
                   kana: { type: Type.STRING, description: "Leitura do termo em Kana no contexto." },
                   romaji: { type: Type.STRING, description: "Leitura do termo em Romaji no contexto, estritamente em minúsculas (caixa baixa)." },
                   type: { type: Type.STRING, description: "Exatamente um dos seguintes: substantivo, verbo, adjetivo, advérbio, pronome, partícula, expressão, interjeição, nome próprio, número, tempo, lugar, conector, auxiliar, outro." },
                   start_index: { type: Type.INTEGER, description: "Índice 0-based inicial na frase original." },
                   end_index: { type: Type.INTEGER, description: "Índice 0-based final exclusivo na frase original." },
                   context_meaning: { type: Type.STRING, description: "Significado específico/tradução contextual deste termo em português nesta frase (curto, de 1 a 3 palavras)." },
                   grammar_note: { type: Type.STRING, description: "Opcional. Breve nota gramatical ou de conjugação para esta ocorrência." },
                   is_expression: { type: Type.BOOLEAN, description: "Verdadeiro se for parte de uma expressão de uso idiomático comum ou gíria multi-palavra." }
                 },
                 required: ["surface", "lemma", "start_index", "end_index", "type"]
               }
             }
           },
           required: ["kana", "romaji", "terms"],
         };
      } else if (job.type === "enrich_dictionary_entry") {
         prompt = `Analise o seguinte termo ou palavra de vocabulário do japonês (forma canônica de dicionário): "${inputObj.lemma}".
Identifique e retorne detalhadamente:
- Significado principal em português (main_meaning).
- Até 5 significados/sinônimos principais em português (meanings).
- Tipo gramatical exato (deve usar exatamente uma destas palavras: substantivo, verbo, adjetivo, advérbio, pronome, partícula, expressão, interjeição, nome próprio, número, tempo, lugar, conector, auxiliar, outro).
- Nível JLPT estimado (N5 a N1, ou vazio).
- Leitura em Kana (kana) e Romaji (romaji) para a forma canônica base.
- Subclassificação opcional (subtype) (ex: "verbo godan / grupo 1", "substantivo composto", etc.)
- Componentes internos de composição (components), ex: para 落ち着く, liste 落ち (radical de cair) e 着く (fixar-se), explicando o sentido.
- Informações sobre o uso ou nota gramatical útil (grammar_info).
- Formas conjugadas ou comuns no uso cotidiano (common_forms).
- Uma observação/nota concisa e clara da palavra (short_note).
- Tags relevantes de uso como formal, coloquial, gíria, etc.`;
         responseSchema = {
           type: Type.OBJECT,
           properties: {
             main_meaning: { type: Type.STRING, description: "O significado principal em português." },
             meanings: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Até 5 significados e sinônimos principais em português." },
             type: { type: Type.STRING, description: "Exatamente um dos tipos: substantivo, verbo, adjetivo, advérbio, pronome, partícula, expressão, interjeição, nome próprio, número, tempo, lugar, conector, auxiliar, outro." },
             jlpt_level: { type: Type.STRING, description: "N1 a N5, ou vazio se não aplicável" },
             kana: { type: Type.STRING, description: "Leitura apenas em Hiragana e/ou Katakana sem kanjis." },
             romaji: { type: Type.STRING, description: "Leitura em alfabeto romano, ESTREITAMENTE em minúsculas (caixa baixa), sem letras maiúsculas, com espaços se for frase longa." },
             tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Matriz de tags como formal, gíria, coloquial, etc" },
             subtype: { type: Type.STRING, description: "Subtipo gramatical detalhado (ex: verbo godan)." },
             components: {
               type: Type.ARRAY,
               items: {
                 type: Type.OBJECT,
                 properties: {
                   kanji: { type: Type.STRING, description: "Parte em Kanji ou Hiragana." },
                   reading: { type: Type.STRING, description: "Leitura em Kana." },
                   meaning: { type: Type.STRING, description: "Descrição/sentido." }
                 },
                 required: ["kanji", "reading", "meaning"]
               }
             },
             grammar_info: { type: Type.STRING, description: "Uso e dicas gramaticais úteis." },
             common_forms: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Conjugações ou formas frequentes (ex: '落ち着いた, 落ち着いて, 落ち着かない')." },
             short_note: { type: Type.STRING, description: "Pequena e valiosa nota explicativa rápida." }
           },
           required: ["main_meaning", "meanings", "type", "kana", "romaji"],
         };
      } else {
         throw new Error("Job type não suportado");
      }

      const ai = getAi();
      const response = await withTimeout(ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature: 0.2
        }
      }));

      const parsedJSON = cleanAndParseJSON(response.text || "{}");
      res.json({ result: parsedJSON });

    } catch (e: any) {
      console.error(e);
      try {
        fs.appendFileSync('server_errors.log', `[${new Date().toISOString()}] Single job error: ${e.message}\nStack: ${e.stack}\n\n`);
      } catch (logErr) {}
      res.status(500).json({ error: formatGenAiError(e) });
    }
  });

  app.post("/api/ai/process-jobs-batch", ipRateLimit, authenticateRequest, async (req: any, res: any) => {
    try {
      const { jobs } = req.body;
      if (!Array.isArray(jobs) || jobs.length === 0) {
        throw new Error("Lote de jobs inválido");
      }

      // Enforce target owner verification across all jobs in the batch
      for (const j of jobs) {
        if (j.user_id !== req.user.id) {
          res.status(403).json({ error: "Negado: tentativa de processar job pertencente a outro usuário." });
          return;
        }
      }

      const firstJob = jobs[0];
      const jobType = firstJob.type;

      console.log(`Processing batch of ${jobs.length} jobs of type ${jobType}`);

      let prompt = "";
      let responseSchema: any = null;

      // Suporte para o modo novo em lote (um job pai com array de items) ou modo legado (array de jobs filhos)
      let itemsToProcess = [];
      let isNestedBatch = false;

      if (['batch_translate_sentences', 'batch_analyze_sentences', 'batch_enrich_dictionary_entries_fast', 'batch_enrich_dictionary_entries_full'].includes(jobType)) {
         isNestedBatch = true;
         let parsedInput = firstJob.input;
         if (typeof parsedInput === 'string') {
             try { parsedInput = JSON.parse(parsedInput); } catch(e){}
         }
         const input = typeof parsedInput === 'object' && parsedInput !== null ? parsedInput : (typeof firstJob.result === 'string' ? JSON.parse(firstJob.result) : (firstJob.result || {}));
         itemsToProcess = input.items || [];
      } else {
         itemsToProcess = jobs.map((j: any) => {
            const input = typeof j.input === 'object' && j.input !== null ? j.input : {};
            return { id: j.id, ...input };
         });
      }

      if (itemsToProcess.length === 0) {
         res.json({ results: [] });
         return;
      }

      const baseJobTypeForPrompt = ["translate_sentence", "batch_translate_sentences"].includes(jobType) 
         ? "translate_sentence" 
         : ["generate_sentence_reading", "batch_analyze_sentences"].includes(jobType) 
            ? "generate_sentence_reading" 
            : ["enrich_dictionary_entry", "batch_enrich_dictionary_entries_fast", "batch_enrich_dictionary_entries_full"].includes(jobType)
               ? "enrich_dictionary_entry" : null;

      if (baseJobTypeForPrompt === "translate_sentence") {
         const itemsStr = itemsToProcess.map((j: any) => ({ id: j.id, japanese: j.sentence || j.japanese }));
         prompt = `Associe cada ID ao resultado da tradução correspondente.
Traduza as seguintes frases em japonês para o português com foco em manter a naturalidade e o sentido exato do contexto. Adapte expressões idiomáticas japonesas para o português brasileiro natural (ex: não seja robótico, use tons locais quando aplicável).

Dados de entrada em formato JSON (lista de objetos com 'id' e 'japanese'):
${JSON.stringify(itemsStr)}`;

         responseSchema = {
           type: Type.OBJECT,
           properties: {
             results: {
               type: Type.ARRAY,
               items: {
                 type: Type.OBJECT,
                 properties: {
                   job_id: { type: Type.STRING, description: "O ID correspondente enviado na solicitação." },
                   translation: { type: Type.STRING, description: "Tradução natural em português" }
                 },
                 required: ["job_id", "translation"],
               }
             }
           },
           required: ["results"]
          };
       } else if (baseJobTypeForPrompt === "generate_sentence_reading") {
         const itemsStr = itemsToProcess.map((j: any) => ({
           id: j.id, 
           japanese: j.sentence || j.japanese, 
           portuguese: j.portuguese,
           known_words: j.known_words || [] 
         }));
         prompt = `Associe cada ID ao resultado correspondente.
Analise as seguintes frases em japonês. Para cada uma, extraia a leitura completa da frase em Kana (apenas Hiragana/Katakana) e o Romaji correspondente.
Também faça a segmentação gramatical lenta e descritiva da frase em palavras/termos no contexto específico desta frase, identificando todos os termos nela presentes com tradução contextual, classe gramatical e curtas explicações.

COBERTURA COMPRETA CRÍTICA: Cada caractere/palavra da frase original (excluindo pontuações padrão como "。", "、", "！", "？", "『", "』") DEVE ser mapeado para exatamente um termo na lista de "terms". Nenhuma palavra, partícula (como は, が, を, に, de, com, etc.), verbo auxiliar (como です, ます, não, etc.), conector, etc., pode ficar fora da segmentação. A soma de todas as substrings "surface" dos termos, na ordem correta, deve cobrir INTEGRALMENTE a frase original (com exceção de pontuação). Se a frase tiver conjugações ou sufixos verbais como "しま〜す" ou "おparan" ou "おらん", certifique-se de incluí-los como parte de um termo (com o lemma correto na forma canônica de dicionário).

ATENÇÃO CRÍTICA ao conceito de Ocorrências (SentenceTerm) vs. Entrada do Dicionário (DictionaryEntry):
1. O lemma deve ser SEMPRE a forma canônica exata de dicionário (ex: para verbos terminando em u ou ru, NUNCA em passado ou forma-te).
2. Se a frase tiver "落ち着いたか" -> surface: "落ち着いたか", lemma: "落ち着く".
3. Se a frase tiver "食べられない" -> surface: "食べられない", lemma: "食べる".
4. A nota gramatical ou estrutura deve explicar a conjugação usada.

Dados de entrada em formato JSON (lista de objetos com 'id', 'japanese' e opcionalmente 'known_words'/'portuguese'):
${JSON.stringify(itemsStr)}`;

         responseSchema = {
           type: Type.OBJECT,
           properties: {
             results: {
               type: Type.ARRAY,
               items: {
                 type: Type.OBJECT,
                 properties: {
                   job_id: { type: Type.STRING, description: "O ID correspondente enviado na solicitação." },
                   kana: { type: Type.STRING, description: "Leitura em Kana completa da frase (apenas Hiragana/Katakana)." },
                   romaji: { type: Type.STRING, description: "Leitura em Romaji correspondente da frase, estritamente em minúsculas (caixa baixa)." },
                   terms: {
                     type: Type.ARRAY,
                     items: {
                       type: Type.OBJECT,
                       properties: {
                         surface: { type: Type.STRING, description: "O trecho exato correspondente ao termo na frase japonesa." },
                         lemma: { type: Type.STRING, description: "A forma base/dicionário do termo." },
                         kana: { type: Type.STRING, description: "Leitura em Kana do termo." },
                         romaji: { type: Type.STRING, description: "Leitura em Romaji do termo, estritamente em minúsculas (caixa baixa)." },
                         type: { type: Type.STRING, description: "Exatamente um dos tipos: substantivo, verbo, adjetivo, advérbio, pronome, partícula, expressão, interjeição, nome próprio, número, tempo, lugar, conector, auxiliar, outro." },
                         start_index: { type: Type.INTEGER, description: "Índice 0-based inicial na frase original." },
                         end_index: { type: Type.INTEGER, description: "Índice 0-based final exclusivo na frase original." },
                         context_meaning: { type: Type.STRING, description: "Significado específico/tradução contextual deste termo em português nesta frase (curto, de 1 a 3 palavras)." },
                         grammar_note: { type: Type.STRING, description: "Opcional. Breve nota gramatical ou de conjugação para esta ocorrência." },
                         is_expression: { type: Type.BOOLEAN, description: "Verdadeiro se for parte de uma expressão de uso idiomático comum ou gíria multi-palavra." }
                       },
                       required: ["surface", "lemma", "start_index", "end_index", "type"]
                     }
                   }
                 },
                 required: ["job_id", "kana", "romaji", "terms"],
               }
             }
           },
           required: ["results"]
         };
       } else if (baseJobTypeForPrompt === "enrich_dictionary_entry") {
         const itemsStr = itemsToProcess.map((j: any) => ({
           id: j.id, 
           lemma: j.lemma,
           examples: j.examples || []
         }));
         prompt = `Associe cada ID ao resultado correspondente.
Analise os seguintes termos ou palavras de vocabulário do japonês:

Dados de entrada em formato JSON:
${JSON.stringify(itemsStr)}

Identifique para cada um: 
- O significado principal em português.
- Lista de significados secundários em português (máximo 5).
- Categoria gramatical (type). VOCÊ DEVE USAR EXATAMENTE UMA DAS SEGUINTES PALAVRAS EM PORTUGUÊS: substantivo, verbo, adjetivo, advérbio, pronome, partícula, expressão, interjeição, nome próprio, número, tempo, lugar, conector, auxiliar, outro.
- Nível do JLPT estimado se aplicável (N5 a N1).
- Leitura estruturada em Kana e Romaji.
- Identifique tags relacionadas ao uso. Retorne uma matriz de strings (exemplo: formal, gíria, etc)`;

         let properties: any = {
           job_id: { type: Type.STRING, description: "O ID correspondente enviado na solicitação." },
           main_meaning: { type: Type.STRING, description: "O significado principal em português." },
           meanings: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Outros significados em português." },
           type: { type: Type.STRING, description: "Exatamente um dos tipos permitidos." },
           jlpt_level: { type: Type.STRING, description: "N1 a N5, ou vazio" },
           kana: { type: Type.STRING, description: "Leitura em Hiragana/Katakana." },
           romaji: { type: Type.STRING, description: "Leitura em alfabeto romano, estritamente em letras minúsculas (caixa baixa)." },
           tags: { type: Type.ARRAY, items: { type: Type.STRING } },
         };

         if (jobType === 'batch_enrich_dictionary_entries_full') {
            prompt += `\nAdicionalmente, você deve fornecer informações gramaticais (grammar_info), exemplos de formas comuns (common_forms), decomposição de componentes se houver (components) e uma nota curta (short_note).`;
            properties.components = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { surface: { type: Type.STRING }, lemma: { type: Type.STRING }, meaning: { type: Type.STRING } } } };
            properties.grammar_info = { type: Type.STRING, description: "Informação gramatical." };
            properties.common_forms = { type: Type.ARRAY, items: { type: Type.STRING } };
            properties.short_note = { type: Type.STRING };
         }

         responseSchema = {
           type: Type.OBJECT,
           properties: {
             results: {
               type: Type.ARRAY,
               items: {
                 type: Type.OBJECT,
                 properties: properties,
                 required: ["job_id", "main_meaning", "type", "kana", "romaji"],
               }
             }
           },
           required: ["results"]
         };
      } else {
         throw new Error("Job type não suportado para lote");
      }

      const ai = getAi();
      const response = await withTimeout(ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature: 0.2
        }
      }));

      const parsedJSON = cleanAndParseJSON(response.text || "{}");
      let rawResults = parsedJSON.results || [];
      
      if (isNestedBatch) {
         res.json({ 
            results: [{
               job_id: firstJob.id,
               type: jobType,
               items: rawResults
            }]
         });
      } else {
         res.json({ results: rawResults });
      }

    } catch (e: any) {
      console.error(e);
      try {
        fs.appendFileSync('server_errors.log', `[${new Date().toISOString()}] Batch job error: ${e.message}\nStack: ${e.stack}\n\n`);
      } catch (logErr) {}
      res.status(500).json({ error: formatGenAiError(e) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.method === 'GET') {
        res.sendFile(path.join(distPath, 'index.html'));
      } else {
        next();
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
