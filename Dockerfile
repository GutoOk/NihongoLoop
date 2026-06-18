FROM node:22-alpine

WORKDIR /app

# Instala apenas dependências de produção
COPY package*.json ./
RUN npm ci --only=production

# Copia os arquivos compilados e estáticos
COPY dist ./dist

# Expõe a porta que o servidor está configurado para escutar
EXPOSE 3000

# Variável de ambiente padrão para a porta
ENV PORT=3000

# Executa o servidor compilado
CMD ["node", "dist/server.cjs"]
