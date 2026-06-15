# Nihongo Loop

**Nihongo Loop** é um web app pessoal mobile-first projetado para transformar fontes originais em japonês (textos, letras de música, diálogos) em materiais de estudo estruturados, com o auxílio de inteligência artificial de ponta e persistência de dados em nuvem.

O objetivo do produto é fechar o ciclo de aprendizado:
`Fonte Japonesa` ➔ `Sentenças` ➔ `Tradução/Leitura` ➔ `Segmentação Gramatical/Termos` ➔ `Dicionário Pessoal` ➔ `Estudo de Sentenças/Vocabulário` ➔ `Quiz & Flashcards`

---

## ✨ Recursos Principais
- 🎧 **Estudos e Looping Auditivo**: Repetição automatizada no ritmo ideal para *shadowing*, com opções de ordens personalizadas de loop (como JP ➔ PT, shadowing, JP-Meaning, etc.) e controles de velocidade/pausa.
- 🤖 **Pipeline Inteligente com Gemini API**: Utiliza o modelo estável `gemini-2.5-flash` no backend seguro do Node/Express para realizar traduções de alta fidelidade e segmentar gramaticalmente a sentença em termos válidos mapeados por caracteres.
- 🗂️ **Persistência Centralizada no Supabase**: Banco de dados relacional real para guardar suas fontes de estudos, progresso de sentenças (`sentence_progress`), vocabulário (`dictionary_progress`) e sessões de estudo.
- 🛡️ **Segurança RLS Rigorosa (Admin-Only)**: Qualquer pessoa pode criar uma conta usando Supabase Auth, mas apenas administradores explicitamente inseridos na tabela `public.app_admins` podem visualizar, consultar ou modificar dados (evitando vazamentos ou abusos).
- 🧠 **Dicionário Pessoal Auto-Enriquecido**: Salve palavras, filtre por fonte e gere notas de gramática, nível JLPT e subclassificações automaticamente usando IA ou edite-as livremente de forma manual.
- 📱 **Mobile-First & PWA de Alta Performance**: Projetado para experiências fluídas no celular, permitindo instalação direta na tela inicial de forma nativa e controle total de cache do Service Worker (excluindo rotas `/api/` e `/auth/`).

---

## 📂 Pré-requisitos & Ambiente de Execução

### Variáveis de Ambiente (`.env`)
Certifique-se de configurar as seguintes variáveis no seu arquivo `.env`:

```env
VITE_SUPABASE_URL=seu_supabase_url
VITE_SUPABASE_ANON_KEY=seu_supabase_anon_key
GEMINI_API_KEY=sua_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

---

## 🚀 Como Executar e Buildar

### 🛠️ Instalação das Dependências
Para instalar os pacotes, execute:
```bash
npm install
```

### 💻 Modo de Desenvolvimento (Full-Stack Express + Vite)
O projeto unifica o servidor Express (backend) e o bundling do Vite (frontend) no mesmo runtime:
```bash
npm run dev
```
*O app estará disponível via `http://localhost:3000`.*

### 📦 Build de Produção
Para compilar tanto o client estático quanto o servidor Express em código otimizado:
```bash
npm run build
```
O build compila o frontend para o diretório `/dist` e empacota o backend como um arquivo CommonJS independente `/dist/server.cjs` usando `esbuild`. Para iniciar o servidor de produção:
```bash
npm start
```


---

## 🛡️ Configuração do Banco de Dados (Supabase/PostgreSQL)

O schema está configurado sob a premissa de banco de dados centralizado e seguro.
1. Execute as tabelas fundamentais através do arquivo `schema.sql`.
2. Aplique as políticas de segurança contidas nas migrations na pasta `supabase/`.
3. Garanta que o seu e-mail administrativo principal (como `gutookada@gmail.com`) esteja inserido na tabela `public.app_admins` para autorizar a navegação completa.
