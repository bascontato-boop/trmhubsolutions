const { Octokit } = require("@octokit/rest");

// Inicializa o cliente do GitHub usando as variáveis de ambiente do Netlify
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.REPO_OWNER;
const REPO = process.env.REPO_NAME;

// Caminho exato apontando para o arquivo dentro da pasta vitrini no GitHub
const PATH = "vitrini/produtos.json"; 

// Credenciais do Painel (Puxa do Netlify ou usa o padrão caso não configurado)
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "TRMhub2026";

// Função para buscar a lista de produtos atual no GitHub
async function obterProdutos() {
    try {
        const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: PATH });
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return { produtos: JSON.parse(content), sha: data.sha };
    } catch (error) {
        // Se o arquivo estiver vazio ou der erro de leitura, inicia uma lista vazia
        return { produtos: [], sha: null };
    }
}

// Função para commitar a lista atualizada de volta no GitHub
async function salvarProdutos(produtos, sha) {
    const content = Buffer.from(JSON.stringify(produtos, null, 2)).toString('base64');
    await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path: PATH,
        message: "🔄 Atualização dinâmica da vitrine TRM Hub",
        content,
        sha
    });
}

exports.handler = async (event, context) => {
    // Configuração de cabeçalhos do CORS para permitir requisições do seu domínio
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
    };

    // Responde requisições de preflight do navegador (OPTIONS)
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    const pathSegments = event.path.replace(/^\/api\/?/, '').split('/');
    const endpoint = pathSegments[0] || null;
    const method = event.httpMethod;

    try {
        // Rota de Login do Painel Administrativo
        if (endpoint === "login" && method === "POST") {
            const { usuario, senha } = JSON.parse(event.body);
            if (usuario === ADMIN_USER && senha === ADMIN_PASS) {
                return { 
                    statusCode: 200, 
                    headers, 
                    body: JSON.stringify({ autenticado: true, token: "trm-authenticated-session-2026" }) 
                };
            }
            return { statusCode: 401, headers, body: JSON.stringify({ message: "Usuário ou senha inválidos." }) };
        }

        // Bloqueia métodos de modificação (POST, PUT, DELETE) sem o token correto de sessão
        if (method !== "GET") {
            const authHeader = event.headers.authorization;
            if (authHeader !== "trm-authenticated-session-2026") {
                return { statusCode: 403, headers, body: JSON.stringify({ message: "Não autorizado." }) };
            }
        }

        // Busca o estado atual dos produtos e o SHA de validação do arquivo
        const { produtos, sha } = await obterProdutos();

        // GET: Retorna todos os produtos para a vitrine
        if (method === "GET") {
            return { statusCode: 200, headers, body: JSON.stringify(produtos) };
        }

        // POST: Adiciona um novo produto
        if (method === "POST") {
            const novo = JSON.parse(event.body);
            novo.id = Date.now().toString(); // Gera ID único baseado no timestamp
            produtos.push(novo);
            await salvarProdutos(produtos, sha);
            return { statusCode: 201, headers, body: JSON.stringify({ message: "Criado com sucesso!", produto: novo }) };
        }

        // PUT: Edita um produto existente
        if (method === "PUT" && endpoint) {
            const adminDados = JSON.parse(event.body);
            const index = produtos.findIndex(p => p.id === endpoint);
            if (index === -1) return { statusCode: 404, headers, body: JSON.stringify({ message: "Produto não encontrado" }) };
            
            produtos[index] = { ...produtos[index], ...adminDados };
            await salvarProdutos(produtos, sha);
            return { statusCode: 200, headers, body: JSON.stringify({ message: "Atualizado com sucesso!" }) };
        }

        // DELETE: Remove um produto
        if (method === "DELETE" && endpoint) {
            const filtrados = produtos.filter(p => p.id !== endpoint);
            await salvarProdutos(filtrados, sha);
            return { statusCode: 200, headers, body: JSON.stringify({ message: "Removido com sucesso!" }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ message: "Método não permitido" }) };

    } catch (err) {
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ error: "Erro interno no servidor", detalhes: err.message }) 
        };
    }
};
