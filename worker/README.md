# Serviço do app "Hoje com a Mari" (Cloudflare Worker)

Contas com e-mail e senha, sincronização entre aparelhos e Notion. Uma instalação serve várias clientes.

## Instalação (uma vez, por quem vende o app)

1. Worker: cole o `worker.js` e implante.
2. Variáveis e segredos:
   - `ADMIN_CODE` (Segredo): senha de administradora, só sua. Gera convites.
   - `ALLOWED_ORIGIN` (Texto): `https://luahproducao.github.io`
   - Notion (opcional): `NOTION_TOKEN` (Segredo, de uma integração interna em notion.so/my-integrations) e `NOTION_ROOT` (Texto, id de uma página "Clientes" compartilhada com essa integração).
3. KV: associe um namespace com o nome de variável `SYNC`.
4. IA (opcional, desligada por padrão): `ANTHROPIC_API_KEY` (Segredo).

## Para cada cliente

No app, em Mais > Ajustes > Para quem vende o app, digite o código de administradora e toque em Gerar convite. Envie o link do app e o convite. A cliente toca em Primeiro acesso, cria e-mail e senha e pronto. Em Ajustes ela conecta o Notion com um toque; o Worker cria as páginas dela dentro de `NOTION_ROOT`.

## Segurança

- Senhas guardadas com PBKDF2 (100 mil iterações). Sessão de 60 dias. 8 tentativas erradas bloqueiam o e-mail por 15 minutos.
- Cada cliente só lê os próprios dados. Dá para desativar uma cliente ou redefinir a senha (`/admin/disable`, `/admin/reset`).
- Os dados das clientes ficam no seu Notion (dentro de `NOTION_ROOT`) e no KV.

## Teste local

`node test-worker.mjs` roda 35 verificações com serviços simulados.
