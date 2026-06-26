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

  // Carrega dinamicamente a configuração do ambiente
  const configAmbiente = AuthService.getUrlsPorAmbiente();
  const rfBaseUrl = configAmbiente.baseUrl;
  const prefixoRtc = configAmbiente.prefixoRtc;

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
    let pularEnvio = false;
    const ultimoDisparo = CircuitBreakerService.obterUltimoDisparoHoje(cnpj);

    if (ultimoDisparo) {
      const horaDisparo = new Date(ultimoDisparo).toLocaleTimeString('pt-BR');
      console.log(`\n[Circuit Breaker] Detectamos que um disparo de apuração já foi realizado hoje às ${horaDisparo} para o CNPJ ${cnpj}.`);
      console.log('Para evitar consumir o limite diário da Receita Federal (máx 2), você pode pular o envio e ir direto buscar o tíquete.');
      const resposta = await AuthService.promptQuestion('👉 Deseja reutilizar o disparo anterior e ir direto para o Polling? (S/N) [Padrão: S]: ');
      if (resposta.toLowerCase() !== 'n') {
        pularEnvio = true;
        console.log('✓ Opção escolhida: Reutilizar disparo anterior. Pulando chamada POST.');
      }
    }

    // 2. Passo 1: Verificar cota diaria de solicitacoes (Circuit Breaker)
    if (!pularEnvio) {
      console.log(`[Passo 1/5] Verificando limites locais de solicitacao para CNPJ ${cnpj}...`);
      CircuitBreakerService.verificarELancar(cnpj);
      console.log('✓ Cota diaria local valida. Prosseguindo.');
    }

    // 3. Passo 2: Obter Token de Autenticacao OAuth2
    console.log('[Passo 2/5] Solicitando token de autenticacao OAuth2 da Receita Federal...');
    const accessToken = await AuthService.getAccessToken();
    const tokenMascarado = `${accessToken.substring(0, 8)}...${accessToken.substring(accessToken.length - 8)}`;
    console.log(`✓ Token OAuth2 obtido com sucesso: [ ${tokenMascarado} ]`);

    if (!pularEnvio) {
      // 4. Passo 3: Disparar Solicitacao de Apuracao Assincrona na Receita
      console.log(`[Passo 3/5] Disparando solicitacao de apuracao de débitos para ${cnpj} (${process.env.RF_AMBIENTE || 'producao'})...`);
      const apuracaoUrl = `${rfBaseUrl}${prefixoRtc}/apuracao-cbs/v1/${cnpj}`;
      console.log(`👉 Enviando POST para: ${apuracaoUrl}`);
      console.log(`👉 Webhook que receberá o tíquete: ${webhookUrl}`);

      // Chamada HTTP para a Receita Federal informando o webhook da Vercel
      const responseSolicitacao = await axios.post(
        apuracaoUrl,
        { urlRetorno: webhookUrl },
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
    } else {
      console.log('[Passo 3/5] Pulado por solicitação do usuário (reutilizando disparo anterior).');
    }

    // 5. Passo 4: Sincronizacao / Polling na nuvem
    console.log('[Passo 4/5] Aguardando processamento da Receita Federal...');
    console.log(`Iniciando polling em seu webhook na nuvem (${vercelApiUrl}/api/tiquete)...`);

    let tiquete: string | null = null;
    let tentativas = 0;

    while (tentativas < MAX_POLLING_ATTEMPTS) {
      tentativas++;
      const horaAtual = new Date().toLocaleTimeString('pt-BR');
      console.log(`[Polling] [${horaAtual}] Tentativa ${tentativas}/${MAX_POLLING_ATTEMPTS} - Consultando tiquete na nuvem...`);

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
    const downloadUrl = `${rfBaseUrl}${prefixoRtc}/download/v1/${tiquete}`;
    console.log(`[Download] Solicitando download do arquivo de débitos à Receita Federal...`);

    const responseDownload = await axios.get(downloadUrl, {
      headers: {
        Authorization: `Bearer ${activeToken}`,
        'Content-Type': 'application/json',
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
    console.log('\n===============================================================');
    console.error('❌ ERRO NO MOTOR DE PROCESSAMENTO LOCAL');
    console.log('===============================================================');
    
    if (error.code === 'ETIMEDOUT' || error.message.includes('ETIMEDOUT') || error.code === 'ENOTFOUND') {
      console.error('❌ ERRO DE CONEXÃO (TIMEOUT OU FALHA DE DNS DE REDE):');
      console.error(`Não foi possível estabelecer contato físico com o servidor da Receita Federal.`);
      console.error(`\n🔍 DIAGNÓSTICO E PRÓXIMOS PASSOS:`);
      console.error(`1. Instabilidade: O ambiente de homologação do Serpro (${rfBaseUrl}) costuma ficar fora do ar.`);
      console.error(`2. Bloqueio de Rede/VPN: Algumas APIs de homologação do governo exigem que o seu IP de saída esteja na whitelist ou que você esteja conectado a uma VPN específica.`);
      console.error(`3. Firewall: Verifique se sua rede corporativa ou roteador bloqueia conexões de saída para esse IP.`);
      console.error(`\n💡 Alternativa de teste rápido:`);
      console.error(`Edite o arquivo .env e mude a variável RF_AMBIENTE de "homologacao" para "producao" ou "producao_restrita".`);
      console.error(`(A API de produção deve responder com erro de credenciais inválidas (401), comprovando que seu código e sua internet estão funcionando!)`);
    } else if (error.response) {
      console.error(`Status HTTP retornado: ${error.response.status}`);
      console.error('Dados de retorno da API:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`Erro físico/interno: ${error.message}`);
    }
    console.log('===============================================================');
    process.exit(1);
  }
}

// Executa o motor
run();
