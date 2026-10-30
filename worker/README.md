# Serviço de IA e sincronização (Cloudflare Worker)

Faz duas coisas para o app "Hoje com a Mari" funcionar fora do Claude:

1. **IA sem chave na mão da Mari.** A chave da Anthropic fica guardada aqui, no servidor. O app só envia um código de acesso.
2. **Sincronização** entre celular, computador e assessoria (opcional, usa KV).

## Como ligar (cerca de 10 minutos, sem instalar nada)

1. Crie uma conta gratuita em cloudflare.com e abra **Workers e Pages → Criar → Worker**. Dê o nome `hoje-mari` e implante.
2. Em **Editar código**, apague o exemplo, cole o conteúdo de `worker.js` e implante de novo.
3. Em **Configurações → Variáveis e segredos**, adicione:
   - `ANTHROPIC_API_KEY` (tipo Segredo): a chave criada em console.anthropic.com. Defina um limite mensal de gasto lá.
   - `APP_CODE` (tipo Segredo): uma senha longa que você inventa, por exemplo 4 palavras soltas.
   - `ALLOWED_ORIGIN` (tipo Texto): `https://luahproducao.github.io`
4. Para sincronizar: **Armazenamento e bancos → KV → Criar namespace** (nome `hoje-mari-sync`). Depois, no Worker, em **Configurações → Associações → Adicionar → Namespace KV**, use o nome da variável `SYNC`.
5. Copie o endereço do Worker (algo como `https://hoje-mari.SEU-USUARIO.workers.dev`).
6. No app, em **Mais → Ajustes → Inteligência artificial**, cole o endereço e o código e toque em **Testar conexão**.
7. Ainda em Ajustes, copie o **link de configuração** e envie para a Mari. Ao abrir o link no celular dela, a IA e a sincronização ligam sozinhas.

## Segurança

- Quem tem o link de configuração usa a IA e lê os dados sincronizados. Envie só para a Mari.
- Para trocar o acesso, mude `APP_CODE` e gere um novo link.
- O Worker só aceita os modelos da lista no topo de `worker.js` e limita cada resposta a 8000 tokens.
- A sincronização guarda cópias dos dados do app (parcerias, tarefas, cérebro). Não use para informações confidenciais de marcas.

## Teste local

`node test-worker.mjs` roda 9 verificações com serviços simulados.
