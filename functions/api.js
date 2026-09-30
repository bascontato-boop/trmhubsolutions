// Versão 1.1
const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.REPO_OWNER;
const REPO = process.env.REPO_NAME;

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

// --- FUNÇÃO CORRIGIDA ---
// Aceita caminhos como "produtos/vitrine_cestos" de forma segura.
function getProdutosPath(nicho) {
    // Medida de segurança atualizada:
    // 1. Garante que o nicho existe.
    // 2. Permite letras, números, underscores e UMA barra (ex: produtos/vitrine_cestos).
    // 3. Proíbe ".." para evitar ataques de path traversal.
    if (!nicho || nicho.includes('..') || !/^[a-z0-9_]+\/[a-z0-9_]+$/i.test(nicho)) {
        // Se o formato for simples (sem barra), assume que está na raiz (mantém compatibilidade)
        if (nicho && /^[a-z0-9_]+$/i.test(nicho)) {
            return `${nicho}/produtos.json`;
        }
        throw new Error("Formato de nicho inválido. Esperado 'pasta/subpasta' ou 'pasta'.");
    }
    return `${nicho}/produtos.json`;
}
// --- FIM DA CORREÇÃO ---

async function obterProdutos(path) {
    try {
        const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path });
        const content = Buffer.from(data.content, 'base64').toString('utf-8').trim();
        
        if (!content || content === "") {
            return { produtos: [], sha: data.sha };
        }
        
        return { produtos: JSON.parse(content), sha: data.sha };
    } catch (error) {
        if (error.status === 404) {
            return { produtos: [], sha: null };
        }
        throw error;
    }
}

async function salvarProdutos(produtos, sha, path) {
    const content = Buffer.from(JSON.stringify(produtos, null, 2)).toString('base64');
    await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path,
        message: `🔄 Atualização da vitrine [${path}]`,
        content,
        sha: sha || undefined
    });
}

exports.handler = async (event, context) => {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
    };

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    try {
        const nicho = event.queryStringParameters?.nicho;
        if (!nicho) {
             return { statusCode: 400, headers, body: JSON.stringify({ message: "Parâmetro 'nicho' é obrigatório." }) };
        }
        const path = getProdutosPath(nicho);

        const pathSegments = event.path.replace(/^\/api\/?/, '').split('/');
        const endpoint = pathSegments[0] || null;
        const method = event.httpMethod;

        if (endpoint === "login" && method === "POST") {
            const { usuario, senha } = JSON.parse(event.body);
            if (ADMIN_USER && ADMIN_PASS && usuario === ADMIN_USER && senha === ADMIN_PASS) {
                return { 
                    statusCode: 200, 
                    headers, 
                    body: JSON.stringify({ autenticado: true, token: "trm-authenticated-session-2026" }) 
                };
            }
            return { statusCode: 401, headers, body: JSON.stringify({ message: "Incorreto." }) };
        }

        if (method !== "GET") {
            const authHeader = event.headers.authorization;
            if (authHeader !== "trm-authenticated-session-2026") {
                return { statusCode: 403, headers, body: JSON.stringify({ message: "Não autorizado." }) };
            }
        }

        const { produtos, sha } = await obterProdutos(path);

        if (method === "GET") {
            return { statusCode: 200, headers, body: JSON.stringify(produtos) };
        }

        if (method === "POST") {
            const novo = JSON.parse(event.body);
            novo.id = Date.now().toString();
            produtos.push(novo);
            await salvarProdutos(produtos, sha, path);
            return { statusCode: 201, headers, body: JSON.stringify({ message: "Cadastrado!", produto: novo }) };
        }

        if (method === "PUT" && endpoint) {
            const atualizado = JSON.parse(event.body);
            const index = produtos.findIndex(p => p.id === endpoint);
            if (index === -1) return { statusCode: 404, headers, body: JSON.stringify({ message: "Não encontrado" }) };
            
            produtos[index] = { ...produtos[index], ...atualizado };
            await salvarProdutos(produtos, sha, path);
            return { statusCode: 200, headers, body: JSON.stringify({ message: "Atualizado!" }) };
        }

        if (method === "DELETE" && endpoint) {
            const filtrados = produtos.filter(p => p.id !== endpoint);
            await salvarProdutos(filtrados, sha, path);
            return { statusCode: 200, headers, body: JSON.stringify({ message: "Removido!" }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ message: "Método inválido" }) };

    } catch (err) {
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ error: "Erro interno", detalhes: err.message }) 
        };
    }
};
