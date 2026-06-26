import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as dotenv from 'dotenv';

// Importa os servicos auxiliares
import { AuthService } from './services/auth.service';
import { CircuitBreakerService } from './services/circuit-breaker';
import { EmpresaSelectorService, EmpresaConfig } from './services/empresa-selector.service';

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

  // ──────────────────────────────────────────────────
  // ETAPA 0: Seleção interativa da empresa
  // ──────────────────────────────────────────────────
  const empresaSelecionada: EmpresaConfig = await EmpresaSelectorService.selecionarEmpresa();

  // Usa as credenciais da empresa selecionada (sobrescreve .env)
  const cnpj = empresaSelecionada.cnpj_base;
  const rfClientId = empresaSelecionada.client_id;
  const rfClientSecret = empresaSelecionada.client_secret;

  // Configurações de infraestrutura (sempre do .env)
  const webhookUrl = process.env.RF_WEBHOOK_URL;
  const vercelApiUrl = process.env.VERCEL_API_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;

  // Carrega dinamicamente a configuração do ambiente
  const configAmbiente = AuthService.getUrlsPorAmbiente();
  const rfBaseUrl = configAmbiente.baseUrl;
  const prefixoRtc = configAmbiente.prefixoRtc;

  // 1. Validacao de configuracoes do ambiente
  if (!cnpj || !/^\d{8}$/.test(cnpj)) {
    console.error('ERRO CRITICO: CNPJ base invalido na empresa selecionada. Deve conter exatamente os 8 primeiros digitos.');
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
      console.log(`\n[Circuit Breaker] Detectamos que um disparo de apuração já foi realizado hoje às ${horaDisparo} para o CNPJ ${cnpj} (${empresaSelecionada.empresa}).`);
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
    // Passa as credenciais da empresa selecionada (não do .env)
    console.log(`[Passo 2/5] Solicitando token de autenticacao OAuth2 da Receita Federal para ${empresaSelecionada.empresa}...`);
    const accessToken = await AuthService.getAccessToken(rfClientId, rfClientSecret);
    const tokenMascarado = `${accessToken.substring(0, 8)}...${accessToken.substring(accessToken.length - 8)}`;
    console.log(`✓ Token OAuth2 obtido com sucesso: [ ${tokenMascarado} ]`);

    // Arquivo local para persistir o tíquete recebido no POST 201 (separado por CNPJ)
    const tiqueteCachePath = path.resolve(__dirname, `../tiquete_cache_${cnpj}.json`);

    if (!pularEnvio) {
      // 4. Passo 3: Disparar Solicitacao de Apuracao Assincrona na Receita
      console.log(`[Passo 3/5] Disparando solicitacao de apuracao de débitos para ${cnpj} (${process.env.RF_AMBIENTE || 'producao'})...`);
      const apuracaoUrl = `${rfBaseUrl}${prefixoRtc}/apuracao-cbs/v1/${cnpj}`;
      console.log(`👉 Enviando POST para: ${apuracaoUrl}`);
      console.log(`👉 Webhook que receberá o tíquete: ${webhookUrl}`);

      // Como a Receita pode não devolver o CNPJ no payload do Webhook, injetamos ele na URL de retorno
      const urlRetornoComCnpj = webhookUrl.includes('?') 
        ? `${webhookUrl}&cnpj=${cnpj}`
        : `${webhookUrl}?cnpj=${cnpj}`;

      // Chamada HTTP para a Receita Federal informando o webhook da Vercel
      const responseSolicitacao = await axios.post(
        apuracaoUrl,
        { urlRetorno: urlRetornoComCnpj },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✓ Solicitacao aceita pela Receita Federal (Status: ${responseSolicitacao.status}).`);
      
      // CAPTURAR O TÍQUETE DIRETAMENTE DA RESPOSTA 201
      const respostaBody = responseSolicitacao.data;
      console.log(`[Debug] Corpo da resposta da Receita Federal:`, JSON.stringify(respostaBody, null, 2));

      let tiqueteSolicitacao: string | null = null;
      if (respostaBody && respostaBody.tiquete) {
        tiqueteSolicitacao = respostaBody.tiquete;
        console.log(`✓ Tíquete de solicitação (protocolo) recebido na resposta do POST: ${tiqueteSolicitacao}`);
        
        // Salva o tíquete de solicitação no cache local para referência
        fs.writeFileSync(tiqueteCachePath, JSON.stringify({
          cnpj,
          empresa: empresaSelecionada.empresa,
          tiquete_solicitacao: tiqueteSolicitacao,
          tiquete_download: null,
          timestamp_solicitacao: new Date().toISOString()
        }, null, 2), 'utf-8');
      } else {
        console.log('[Info] A resposta do POST não continha o tíquete de solicitação.');
      }

      // Registra a chamada com sucesso no circuit breaker
      CircuitBreakerService.registrarDisparo(cnpj);
    } else {
      console.log('[Passo 3/5] Pulado por solicitação do usuário (reutilizando disparo anterior).');
    }

    // 5. Passo 4: Obter o tíquete de download (cache local OU polling no webhook)
    let tiqueteDownload: string | null = null;

    // Estratégia 1: Verificar se o tíquete de download já está salvo no cache local (recebido do webhook anteriormente)
    if (fs.existsSync(tiqueteCachePath)) {
      try {
        const cacheData = JSON.parse(fs.readFileSync(tiqueteCachePath, 'utf-8'));
        if (cacheData.cnpj === cnpj && cacheData.tiquete_download) {
          tiqueteDownload = cacheData.tiquete_download;
          console.log(`✓ [Passo 4/5] Tíquete de download ativo encontrado no cache local: ${tiqueteDownload}`);
          console.log('Pulando polling no webhook. O processamento já foi confirmado como concluído.');
        } else if (cacheData.cnpj === cnpj && cacheData.tiquete_solicitacao) {
          console.log(`[Info] Tíquete de solicitação (${cacheData.tiquete_solicitacao}) encontrado no cache local.`);
          console.log('Aguardando a confirmação do processamento via webhook (Redis)...');
        }
      } catch (e) {
        // Cache inválido, prosseguir com o polling
      }
    }

    // Estratégia 2: Polling no webhook da Vercel/Redis
    if (!tiqueteDownload) {
      console.log('[Passo 4/5] Aguardando processamento da Receita Federal...');
      console.log(`Iniciando polling em seu webhook na nuvem (${vercelApiUrl}/api/tiquete)...`);

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
            tiqueteDownload = responsePolling.data.tiquete;
            console.log(`✓ Tíquete de download obtido com sucesso do webhook: ${tiqueteDownload}`);
            
            // Grava ou atualiza o cache local marcando o tiquete_download como disponível
            try {
              let cacheExistente: any = {};
              if (fs.existsSync(tiqueteCachePath)) {
                cacheExistente = JSON.parse(fs.readFileSync(tiqueteCachePath, 'utf-8'));
              }
              fs.writeFileSync(tiqueteCachePath, JSON.stringify({
                cnpj,
                empresa: empresaSelecionada.empresa,
                tiquete_solicitacao: cacheExistente.tiquete_solicitacao || null,
                tiquete_download: tiqueteDownload,
                timestamp_solicitacao: cacheExistente.timestamp_solicitacao || null,
                timestamp_download: new Date().toISOString()
              }, null, 2), 'utf-8');
            } catch (e) {
              // ignore erro de escrita
            }
            break;
          }

          console.log(`→ Servidor retornou: Processamento pendente na Receita Federal. Aguardando ${POLLING_INTERVAL_MS / 1000}s...`);
        } catch (err: any) {
          console.warn(`[Aviso] Falha na conexao com o webhook na Vercel: ${err.message}. Tentando novamente na proxima iteracao.`);
        }

        await sleep(POLLING_INTERVAL_MS);
      }
    }

    if (!tiqueteDownload) {
      console.error('❌ Timeout de processamento atingido. O webhook da Receita Federal não entregou o tíquete de download em 10 minutos.');
      console.error('💡 Dica: Verifique se os servidores da Receita Federal já enviaram o callback para seu webhook na Vercel.');
      process.exit(1);
    }

    // 6. Passo 5: Download do JSON Final de Débitos
    console.log('[Passo 5/5] Iniciando download do JSON final de debitos de CBS...');
    
    const downloadUrl = `${rfBaseUrl}${prefixoRtc}/download/v1/${tiqueteDownload}`;
    let debitosData: any = null;
    let maxRetries = 2; // Apenas para instabilidade de rede ou renovação de token expirado, não para processamento
    let retryCount = 0;

    console.log(`[Download] Tíquete: ${tiqueteDownload}`);
    console.log(`[Download] URL: ${downloadUrl}`);

    while (retryCount <= maxRetries) {
      const horaAtual = new Date().toLocaleTimeString('pt-BR');
      const activeToken = await AuthService.getAccessToken(rfClientId, rfClientSecret);

      console.log(`[Download] [${horaAtual}] Solicitando arquivo à Receita Federal...`);

      try {
        const responseDownload = await axios.get(downloadUrl, {
          headers: {
            Authorization: `Bearer ${activeToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          }
        });

        debitosData = responseDownload.data;
        console.log(`✓ Download concluído com sucesso! (Status: ${responseDownload.status})`);
        break;

      } catch (downloadErr: any) {
        const status = downloadErr.response?.status;
        const mensagem = downloadErr.response?.data;

        if (status === 401 && typeof mensagem === 'string' && mensagem.includes('inexistente')) {
          console.error(`❌ Erro no download: A Receita Federal retornou "inexistente ou download já realizado" (Status: 401).`);
          console.error(`💡 Explicação: O tíquete de download expira em 24h ou o arquivo já foi baixado (limite de 1 download por tíquete atingido).`);
          // Para imediatamente sem tentar de novo
          break;
        } else if (status === 401) {
          console.log(`[Download] Token expirado ou inválido (401). Tentativa de renovação de token...`);
          AuthService.clearCache(rfClientId); // Limpa o cache local para forçar buscar um novo na próxima iteração
        } else if (status === 429) {
          console.error(`❌ Limite de requisições excedido na API da Receita Federal (Status: 429):`, JSON.stringify(mensagem));
          break;
        } else {
          console.error(`❌ Erro inesperado no download (Status: ${status}):`, JSON.stringify(mensagem));
        }
      }

      retryCount++;
      if (retryCount <= maxRetries && !debitosData) {
        console.log(`Aguardando 5 segundos antes de tentar novamente...`);
        await sleep(5000);
      }
    }

    if (!debitosData) {
      console.error('❌ Falha no download dos débitos de CBS. A operação não pôde ser concluída.');
      process.exit(1);
    }

    // Criar pasta de downloads locais se nao existir
    const downloadsDir = path.resolve(__dirname, '../downloads');
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }

    // Formata o nome do arquivo final com data, hora e nome da empresa
    const dataHoraStr = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
    const nomeEmpresaSlug = empresaSelecionada.empresa.substring(0, 20).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    const fileName = `cbs_debitos_${cnpj}_${nomeEmpresaSlug}_${dataHoraStr}.json`;
    const filePath = path.join(downloadsDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(debitosData, null, 2), 'utf-8');

    // Remove o cache do tíquete local para que a próxima apuração inicie limpa
    if (fs.existsSync(tiqueteCachePath)) {
      try {
        fs.unlinkSync(tiqueteCachePath);
        console.log('✓ Cache local do tíquete higienizado (removido) com sucesso.');
      } catch (e) {
        // ignorar erros de deleção
      }
    }

    console.log('===============================================================');
    console.log('✓ OPERAÇÃO CONCLUÍDA COM SUCESSO!');
    console.log(`✓ Empresa: ${empresaSelecionada.empresa}`);
    console.log(`✓ CNPJ: ${empresaSelecionada.cnpj_completo}`);
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
