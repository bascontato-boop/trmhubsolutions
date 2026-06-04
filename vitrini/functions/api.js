const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.REPO_OWNER;
const REPO = process.env.REPO_NAME;
const PATH = "vitrini/produtos.json"; 

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "TRMhub2026";

async function obterProdutos() {
    try {
        const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: PATH });
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return { produtos: JSON.parse(content), sha: data.sha };
    } catch (error) {
        // Se o erro for apenas porque o arquivo está vazio ou não existe, retornamos array vazio para o teste prosseguir
        return { produtos: [], sha: null };
    }
}

async function salvarProdutos(produtos, sha) {
    const content = Buffer.from(JSON.stringify(produtos, null, 2)).toString('base64');
    
    // Tratamento robusto de erro para expor a falha do GitHub no teste
    try {
        await octokit.repos.createOrUpdateFileContents({
            owner: OWNER,
            repo: REPO,
            path: PATH,
            message: "🔄 Atualização dinâmica da vitrine TRM Hub",
            content,
            sha: sha || undefined // Evita quebra caso o arquivo seja novo/nulo
        });
    } catch (gitError) {
        console.error("Erro detalhado do GitHub detectado:", gitError.status, gitError.message);
        throw new Error(`[Falha no GitHub - Status ${gitError.status}]: ${gitError.message}`);
    }
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

    const pathSegments = event.path.replace(/^\/api\/?/, '').split('/');
    const endpoint = pathSegments[0] || null;
    const method = event.httpMethod;

    try {
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

        if (method !== "GET") {
            const authHeader = event.headers.authorization;
            if (authHeader !== "trm-authenticated-session-2026") {
                return { statusCode: 403, headers, body: JSON.stringify({ message: "Não autorizado no cabeçalho." }) };
            }
        }

        const { produtos, sha } = await obterProdutos();

        if (method === "GET") {
            return { statusCode: 200, headers, body: JSON.stringify(produtos) };
        }

        if (method === "POST") {
            const novo =
