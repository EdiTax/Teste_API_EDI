const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 1. Carregador simples de arquivo .env (sem dependências externas)
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    // Ignora comentários e linhas vazias
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let val = match[2] || '';
      // Remove aspas simples ou duplas se houver
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[key] = val.trim();
    }
  }
}

// Configura o WEBHOOK_SECRET padrão de teste caso não configurado no .env
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'SenhaSeguraDoMeuWebhook123!';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// Inicializa Supabase se as variáveis existirem
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[Dev Server] Supabase inicializado com sucesso para testes locais.');
  } catch (err) {
    console.warn('[Dev Server] Aviso: Falha ao carregar @supabase/supabase-js. O fallback de memória será ativado.');
  }
} else {
  console.log('[Dev Server] Sem credenciais Supabase. Utilizando armazenamento volátil em memória para testes.');
}

// Armazenamento em memória (fallback)
const memoryStorage = new Map();

// Helper para ler o corpo da requisição POST
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Dicionário de Content-Types baseado em extensões
const MimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// Cria o Servidor HTTP
const server = http.createServer(async (req, res) => {
  // CORS Headers padrão para testes locais do motor
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // --- Rota 1: POST /api/webhook-receita ---
  if (pathname === '/api/webhook-receita' && req.method === 'POST') {
    const secretParam = parsedUrl.query.secret || req.headers['x-webhook-secret'];

    if (secretParam !== WEBHOOK_SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Não autorizado. Token de segurança inválido.' }));
      return;
    }

    try {
      const body = await getRequestBody(req);
      const { cnpj, tiquete } = body;

      if (!cnpj || !tiquete) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload inválido. CNPJ e tíquete são obrigatórios.' }));
        return;
      }

      // Persiste
      if (supabase) {
        const { error } = await supabase
          .from('tiquetes_cbs')
          .upsert({ cnpj, tiquete, created_at: new Date().toISOString() }, { onConflict: 'cnpj' });
        
        if (error) throw error;
      } else {
        memoryStorage.set(cnpj, { tiquete, createdAt: new Date() });
      }

      console.log(`[Webhook Mock] Tíquete recebido e salvo: CNPJ=${cnpj} | Tíquete=${tiquete}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Tíquete recebido e salvo com sucesso.' }));
    } catch (err) {
      console.error('[Webhook Mock] Erro no processamento:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Erro interno no processamento do webhook.', details: err.message }));
    }
    return;
  }

  // --- Rota 2: GET /api/tiquete ---
  if (pathname === '/api/tiquete' && req.method === 'GET') {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Não autorizado. Token Bearer ausente.' }));
      return;
    }

    const token = authHeader.substring(7);
    if (token !== WEBHOOK_SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Não autorizado. Token inválido.' }));
      return;
    }

    const cnpj = parsedUrl.query.cnpj;
    if (!cnpj) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'CNPJ é obrigatório na query string.' }));
      return;
    }

    try {
      let tiquete = null;

      if (supabase) {
        // Consulta
        const { data, error } = await supabase
          .from('tiquetes_cbs')
          .select('tiquete')
          .eq('cnpj', cnpj)
          .single();

        if (!error && data && data.tiquete) {
          tiquete = data.tiquete;
          // Deleta
          await supabase.from('tiquetes_cbs').delete().eq('cnpj', cnpj);
        }
      } else {
        const item = memoryStorage.get(cnpj);
        if (item) {
          tiquete = item.tiquete;
          memoryStorage.delete(cnpj); // Higienização reativa
        }
      }

      if (tiquete) {
        console.log(`[Tiquete Mock] Tíquete consumido para CNPJ=${cnpj}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'completed', cnpj, tiquete }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'pending', cnpj }));
      }
    } catch (err) {
      console.error('[Tiquete Mock] Erro ao buscar:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Erro interno ao consultar o banco de dados.', details: err.message }));
    }
    return;
  }

  // --- Rota 3: Servir Arquivos Estáticos (index.html, index.css, app.js) ---
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const extname = path.extname(filePath);
  let contentType = MimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 - Arquivo Não Encontrado</h1>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>500 - Erro Interno do Servidor</h1><p>${error.message}</p>`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Porta do Servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('===============================================================');
  console.log(`⚡ SERVIDOR DE DESENVOLVIMENTO LOCAL ATIVO`);
  console.log(`⚡ Acesse o painel em: http://localhost:${PORT}`);
  console.log(`⚡ Simule os webhooks e APIs locais sem precisar logar na Vercel!`);
  console.log('===============================================================');
});
