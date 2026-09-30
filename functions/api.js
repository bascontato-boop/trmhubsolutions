const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.REPO_OWNER;
const REPO = process.env.REPO_NAME;

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

// Função para obter o caminho dinâmico do arquivo de produtos
function getProdutosPath(vitrineId) {
    // Medida de segurança: garante que o ID contém apenas caracteres seguros
    // e evita ataques de "path traversal" (ex: ../../etc/passwd)
    if (!vitrineId || !/^[a-z0-9_]+$/i.test(vitrineId)) {
        throw new Error("ID de vitrine inválido.");
    }
    return `${vitrineId}/produtos.json`;
}

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
            // Se o arquivo não existe, retorna um estado inicial válido para criação
            return { produtos: [], sha: null };
        }
        // Se for outro erro, propaga
        throw error;
    }
}

async function salvarProdutos(produtos, sha, path) {
    const content = Buffer.from(JSON.stringify(produtos, null, 2)).toString('base64');
    await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path,
        message: `🔄 Atualização dinâmica da vitrine [${path}]`,
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
        // Pega o ID da vitrine da query string, com 'vitrine' como padrão
        const vitrineId = event.queryStringParameters?.vitrine || 'vitrine';
        const path = getProdutosPath(vitrineId);

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