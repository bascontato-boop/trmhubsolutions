
const { Octokit } = require("@octokit/rest");

// Configuração do Octokit e das variáveis de ambiente
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.REPO_OWNER;
const REPO = process.env.REPO_NAME;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

// Função de segurança para validar o caminho do nicho
function getProdutosPath(nicho) {
    // Validação rigorosa:
    // 1. Garante que o nicho não é vazio.
    // 2. Proíbe ".." para evitar ataques de "path traversal".
    // 3. Permite o formato "pasta" ou "pasta/subpasta" com caracteres seguros.
    if (!nicho || nicho.includes('..') || !/^[a-z0-9_]+(\/[a-z0-9_]+)*$/i.test(nicho)) {
        throw new Error("Formato de nicho inválido.");
    }
    return `${nicho}/produtos.json`;
}

async function obterProdutos(path) {
    try {
        const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path });
        const content = Buffer.from(data.content, 'base64').toString('utf-8').trim();
        return { produtos: content ? JSON.parse(content) : [], sha: data.sha };
    } catch (error) {
        if (error.status === 404) {
            return { produtos: [], sha: null }; // Ficheiro não existe, retorna estado inicial
        }
        throw error; // Propaga outros erros
    }
}

async function salvarProdutos(produtos, sha, path) {
    const content = Buffer.from(JSON.stringify(produtos, null, 2)).toString('base64');
    await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path,
        message: `[API] Atualiza produtos para: ${path}`,
        content,
        sha: sha || undefined
    });
}

exports.handler = async (event) => {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
    };

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, headers };
    }

    try {
        const pathSegments = event.path.replace(/^\/api\/?/, '').split('/');
        const endpoint = pathSegments[0] || null;
        const method = event.httpMethod;

        // Rota de Login (não precisa de nicho nem token)
        if (endpoint === "login" && method === "POST") {
            const { usuario, senha } = JSON.parse(event.body);
            if (usuario === ADMIN_USER && senha === ADMIN_PASS) {
                return { statusCode: 200, headers, body: JSON.stringify({ autenticado: true, token: "trm-authenticated-session-2026" }) };
            }
            return { statusCode: 401, headers, body: JSON.stringify({ message: "Credenciais inválidas." }) };
        }

        // --- VALIDAÇÃO CENTRAL ---
        // A partir daqui, todas as rotas precisam de um 'nicho'
        const nicho = event.queryStringParameters?.nicho;
        if (!nicho) {
            return { statusCode: 400, headers, body: JSON.stringify({ message: "Parâmetro 'nicho' é obrigatório." }) };
        }
        const path = getProdutosPath(nicho);

        // A partir daqui, todas as rotas (exceto GET) precisam de um token
        if (method !== "GET") {
            if (event.headers.authorization !== "trm-authenticated-session-2026") {
                return { statusCode: 403, headers, body: JSON.stringify({ message: "Não autorizado." }) };
            }
        }
        // --- FIM DA VALIDAÇÃO ---

        const { produtos, sha } = await obterProdutos(path);

        if (method === "GET") {
            return { statusCode: 200, headers, body: JSON.stringify(produtos) };
        }

        if (method === "POST") {
            const novo = { ...JSON.parse(event.body), id: Date.now().toString() };
            produtos.push(novo);
            await salvarProdutos(produtos, sha, path);
            return { statusCode: 201, headers, body: JSON.stringify(novo) };
        }

        const idProduto = endpoint;
        const index = produtos.findIndex(p => p.id === idProduto);

        if (index === -1) {
            return { statusCode: 404, headers, body: JSON.stringify({ message: "Produto não encontrado." }) };
        }

        if (method === "PUT") {
            produtos[index] = { ...produtos[index], ...JSON.parse(event.body) };
            await salvarProdutos(produtos, sha, path);
            return { statusCode: 200, headers, body: JSON.stringify(produtos[index]) };
        }

        if (method === "DELETE") {
            const filtrados = produtos.filter(p => p.id !== idProduto);
            await salvarProdutos(filtrados, sha, path);
            return { statusCode: 200, headers, body: JSON.stringify({ message: "Produto removido." }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ message: "Método não permitido." }) };

    } catch (err) {
        console.error("Erro na API:", err);
        return { statusCode: 500, headers, body: JSON.stringify({ message: "Erro interno no servidor.", error: err.message }) };
    }
};
