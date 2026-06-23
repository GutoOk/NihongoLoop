---
trigger: always_on
---

# Migrations do Banco de Dados

As migrations deste projeto são aplicadas automaticamente no deploy/push e não podem ser aplicadas repetidamente.
Portanto, NUNCA edite arquivos de migração existentes em `supabase/migrations/` que já foram criados ou aplicados.
Para qualquer alteração ou correção no banco de dados, sempre crie um novo arquivo de migração separado (ex: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`).
