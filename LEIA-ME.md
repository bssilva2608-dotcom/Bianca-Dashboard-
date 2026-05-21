# Dashboard de Gestão — Como publicar

## Arquivos deste projeto
```
dashboard-projeto/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx
    └── App.jsx   ← seu dashboard
```

## Passo a passo para publicar

### 1. Criar repositório no GitHub
1. Acesse github.com e faça login
2. Clique no botão verde **"New"** (canto superior esquerdo)
3. Dê o nome: `dashboard-gestao`
4. Deixe como **Public** e clique em **"Create repository"**

### 2. Subir os arquivos
1. Na página do repositório criado, clique em **"uploading an existing file"**
2. Arraste TODOS os arquivos desta pasta (incluindo a pasta `src/`)
3. Clique em **"Commit changes"**

### 3. Publicar no Vercel
1. Acesse vercel.com e faça login
2. Clique em **"Add New Project"**
3. Conecte sua conta do GitHub se pedido
4. Selecione o repositório `dashboard-gestao`
5. Clique em **"Deploy"** — aguarde ~1 minuto
6. Pronto! Você receberá um link do tipo `dashboard-gestao.vercel.app`

## Pronto! 🎉
Seu dashboard estará disponível 24h pelo link gerado.
Sempre que quiser atualizar, basta substituir os arquivos no GitHub.
