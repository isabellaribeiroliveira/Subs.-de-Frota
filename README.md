# Univale · Registro de Ocorrência Veicular

Protótipo funcional (HTML + CSS + JS puro, sem dependências) do app de registro inteligente
de ocorrências veiculares, com fluxo do colaborador (pergunta → resposta → próxima pergunta)
e área web da Qualidade/Controlador.

## Arquivos

```
index.html   → estrutura da página (carrega style.css e script.js)
style.css    → identidade visual Univale (turquesa da logo oficial) + animações
script.js    → toda a lógica: wizard inteligente, dashboard, filtros, histórico, CSV
assets/univale-logo.png → logo oficial fornecida (usada sem alterações)
```

## Como testar

1. Baixe a pasta inteira (os 3 arquivos + `assets/`).
2. Abra `index.html` no navegador — não precisa de servidor nem de instalação.
3. Para publicar no GitHub Pages: crie um repositório, suba os arquivos mantendo a
   pasta `assets/`, ative Pages nas configurações do repositório apontando para a
   branch principal, pronto.

## Logins de teste (protótipo, sem senha real)

| Usuário | Papel | Acesso |
|---|---|---|
| João Silva | Colaborador | App de registro (mobile) |
| Maria Santos | Colaborador | App de registro (mobile) |
| Isabella Ferreira | Qualidade | Painel web (dashboard, ocorrências, etc.) |
| Carlos Mendes | Qualidade | Painel web (dashboard, ocorrências, etc.) |

A tela de login lista os 4 usuários — basta clicar em um para entrar.

## Como os dados são guardados (importante)

Este protótipo **não tem backend**. Ele guarda as ocorrências no `localStorage`
do navegador, simulando a planilha de controle descrita no briefing (seção 6-7).

Isso significa, na prática:

- Tudo o que um colaborador registra fica salvo **no navegador daquele
  dispositivo**. Se você registrar uma ocorrência no celular e depois abrir o
  painel da Qualidade em outro computador, os dois **não vão ver a mesma base**
  — cada navegador tem sua própria cópia local.
- Isso é suficiente para validar o fluxo, a experiência e as regras de negócio
  com a equipe, mas **não é uma base compartilhada real**.
- Ao recarregar a página no mesmo navegador, os dados continuam lá (persistem).
- Existe um botão "Exportar planilha (.csv)" na área da Qualidade para tirar
  uma foto dos dados a qualquer momento.

### Próximo passo para dados compartilhados de verdade

Quando quiser que o colaborador e a Qualidade vejam a mesma informação em
tempo real (o objetivo final do projeto), será necessário conectar uma fonte
de dados central — por exemplo:

- **Google Sheets** via Google Apps Script (mais simples, já citado no
  briefing) — o app passa a enviar/ler dados por uma URL de Web App;
- ou um banco de dados com API própria (Firebase, Supabase, backend interno).

O modelo de dados já foi estruturado (seção 39 do briefing / objeto
`blankOccurrenceData()` em `script.js`) exatamente para permitir essa troca
sem redesenhar o app: hoje ele lê/grava em `localStorage`, no futuro passa a
ler/gravar na API, mantendo as mesmas telas.

## O que já está implementado

- Login simulado com 4 perfis de teste (2 colaboradores, 2 Qualidade).
- Fluxo inteligente do colaborador (pergunta → resposta → próxima pergunta),
  com campos condicionais que só aparecem quando fazem sentido, trilha de
  progresso animada e tela de revisão editável antes do envio.
- Geração automática de protocolo (`OC-2026-000XX`).
- Tela de sucesso com status inicial "Aguardando nº do socorro".
- "Minhas ocorrências" com status e reenvio quando a Qualidade pede correção.
- Painel da Qualidade: dashboard com indicadores, lista de ocorrências com
  filtros e exportação CSV, pendências, histórico geral de eventos e
  relatório simples por motivo.
- Detalhe da ocorrência para a Qualidade: blocos por assunto, vínculo do
  Nº do Socorro, validação, encerramento, solicitação de correção e linha do
  tempo (histórico) com usuário/data/hora de cada ação.
- Dados de teste (veículos, motoristas, setores, linhas e 6 ocorrências
  fictícias em status diferentes) já vêm carregados no primeiro acesso.

## Personalização rápida

- Cores/tipografia: topo do arquivo `style.css` (bloco `:root`).
- Listas de veículos/motoristas/setores/linhas/motivos: topo do `script.js`.
- Usuários de teste: array `USERS` no topo do `script.js`.
