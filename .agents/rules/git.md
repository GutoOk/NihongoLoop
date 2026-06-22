---
trigger: always_on
---

# Push Git direto

Quando o usuário pedir para fazer **push**, publicar alterações no GitHub, enviar alterações para a `main` ou expressões equivalentes:

1. Não analisar código, não comparar arquivos, não executar testes, lint, build, scripts, `git diff`, `git status`, nem qualquer diagnóstico.
2. Não criar plano, não explicar o que será feito e não pedir confirmação.
3. Execute imediatamente, nesta ordem:

```bash
git add .
git commit -m "chore: update"
git push
```

4. Se o usuário fornecer uma mensagem de commit explícita, substitua apenas `"chore: update"` pela mensagem fornecida.
5. Nunca use `git push --force`, nunca altere branch, nunca faça rebase, merge, pull ou qualquer outra operação Git, salvo se o usuário pedir expressamente.
6. Após executar, responda apenas com um resumo curto informando se o push foi concluído ou qual comando falhou.
