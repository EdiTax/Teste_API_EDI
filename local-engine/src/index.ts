import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as dotenv from 'dotenv';

// Importa os servicos auxiliares
import { AuthService } from './services/auth.service';
import { CircuitBreakerService } from './services/circuit-breaker';

// Carrega as variaveis do arquivo .env
dotenv.config();

const POLLING_INTERVAL_MS = 30 * 1000; // 30 segundos
const MAX_POLLING_ATTEMPTS = 20;       // Limite de 10 minutos (20 tentativas * 30s)

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('===============================================================');
  console.log('INICIANDO MOTOR LOCAL - APURAÇÃO ASSISTIDA CBS RECEITA FEDERAL');
  console.log('===============================================================');

  const cnpj = process.env.CNPJ_APURACAO;
  const webhookUrl = process.env.RF_WEBHOOK_URL;
  const vercelApiUrl = process.env.VERCEL_API_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const rfBaseUrl = process.env.RF_BASE_URL || 'https://api.receitafederal.gov.br';

  // 1. Validacao de configuracoes do ambiente
  if (!cnpj || !/^\d{8}$/.test(cnpj)) {
    console.error('ERRO CRITICO: CNPJ_APURACAO invalido ou ausente no .env. Deve conter exatamente os 8 primeiros digitos.');
    process.exit(1);
  }

  if (!webhookUrl || !vercelApiUrl || !webhookSecret) {
    console.error('ERRO CRITICO: Variaveis da Vercel (RF_WEBHOOK_URL, VERCEL_API_URL, WEBHOOK_SECRET) nao configuradas no .env.');
    process.exit(1);
  }

  try {
    // 2. Passo 1: Verificar cota diaria de solicitacoes (Circuit Breaker)
    console.log(`[Passo 1/5] Verificando limites locais de solicitacao para CNPJ ${cnpj}...`);
    CircuitBreakerService.verificarELancar(cnpj);
    console.log('✓ Cota diaria local valida. Prosseguindo.');

    // 3. Passo 2: Obter Token de Autenticacao OAuth2
    console.log('[Passo 2/5] Solicitando token de autenticacao OAuth2 da Receita Federal...');
    const accessToken = await AuthService.getAccessToken();
    console.log('✓ Token OAuth2 valido e ativo.');

    // 4. Passo 3: Disparar Solicitacao de Apuracao Assincrona na Receita
    console.log(`[Passo 3/5] Disparando solicitacao de apuracao de débitos para ${cnpj}...`);
    const apuracaoUrl = `${rfBaseUrl}/rtc/apuracao-cbs/v1/${cnpj}`;

    // Chamada HTTP para a Receita Federal informando o webhook da Vercel
    const responseSolicitacao = await axios.post(
      apuracaoUrl,
      { webhookUrl: webhookUrl },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✓ Solicitacao aceita pela Receita Federal (Status: ${responseSolicitacao.status}).`);
    
    // Registra a chamada com sucesso no circuit breaker
    CircuitBreakerService.registrarDisparo(cnpj);

    // 5. Passo 4: Sincronizacao / Polling na nuvem
    console.log('[Passo 4/5] Aguardando processamento da Receita Federal...');
    console.log(`Iniciando polling em seu webhook na nuvem (${vercelApiUrl}/api/tiquete)...`);

    let tiquete: string | null = null;
    let tentativas = 0;

    while (tentativas < MAX_POLLING_ATTEMPTS) {
      tentativas++;
      console.log(`[Polling] Tentativa ${tentativas}/${MAX_POLLING_ATTEMPTS} - Consultando tiquete na nuvem...`);

      try {
        const responsePolling = await axios.get<{ status: 'pending' | 'completed'; tiquete?: string }>(
          `${vercelApiUrl}/api/tiquete`,
          {
            params: { cnpj },
            headers: {
              Authorization: `Bearer ${webhookSecret}`
            }
          }
        );

        if (responsePolling.data.status === 'completed' && responsePolling.data.tiquete) {
          tiquete = responsePolling.data.tiquete;
          console.log(`✓ Tiquete obtido com sucesso da nuvem: ${tiquete}`);
          break;
        }

        console.log(`→ Servidor retornou: Processamento pendente na Receita Federal. Aguardando ${POLLING_INTERVAL_MS / 1000}s...`);
      } catch (err: any) {
        console.warn(`[Aviso] Falha na conexao com o webhook na Vercel: ${err.message}. Tentando novamente na proxima iteracao.`);
      }

      await sleep(POLLING_INTERVAL_MS);
    }

    if (!tiquete) {
      console.error('❌ Timeout de processamento atingido. O tiquete nao foi entregue pela Receita Federal em 10 minutos.');
      process.exit(1);
    }

    // 6. Passo 5: Download do JSON Final de Débitos
    console.log('[Passo 5/5] Iniciando download do JSON final de debitos de CBS...');
    
    // Pega o token OAuth2 novamente (se expirou na espera, o servico renova automaticamente)
    const activeToken = await AuthService.getAccessToken();
    const downloadUrl = `${rfBaseUrl}/rtc/download/v1/${tiquete}`;

    const responseDownload = await axios.get(downloadUrl, {
      headers: {
        Authorization: `Bearer ${activeToken}`,
        Accept: 'application/json'
      }
    });

    const debitosData = responseDownload.data;

    // Criar pasta de downloads locais se nao existir
    const downloadsDir = path.resolve(__dirname, '../downloads');
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }

    // Formata o nome do arquivo final com data e hora local
    const dataHoraStr = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
    const fileName = `cbs_debitos_${cnpj}_${dataHoraStr}.json`;
    const filePath = path.join(downloadsDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(debitosData, null, 2), 'utf-8');

    console.log('===============================================================');
    console.log('✓ OPERAÇÃO CONCLUÍDA COM SUCESSO!');
    console.log(`✓ Arquivo de debitos baixado e salvo em:`);
    console.log(`  ${filePath}`);
    console.log('===============================================================');

  } catch (error: any) {
    console.error('❌ ERRO NO MOTOR DE PROCESSAMENTO LOCAL:');
    if (error.response) {
      console.error(`Status HTTP: ${error.response.status}`);
      console.error('Dados de retorno da API:', error.response.data);
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

// Executa o motor
run();
