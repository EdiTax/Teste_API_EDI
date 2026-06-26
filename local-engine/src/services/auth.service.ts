import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export class AuthService {
  private static cacheFilePath = path.resolve(__dirname, '../../token_cache.json');

  /**
   * Helper para perguntar dados no console local de forma assíncrona.
   */
  public static promptQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    return new Promise((resolve) => {
      rl.question(query, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  /**
   * Determina e retorna as URLs e configurações da Receita Federal baseadas no ambiente ativo.
   */
  public static getUrlsPorAmbiente(): { baseUrl: string; tokenUrl: string; prefixoRtc: string } {
    const ambiente = (process.env.RF_AMBIENTE || 'producao').toLowerCase();
    const customBaseUrl = process.env.RF_BASE_URL;

    if (ambiente === 'homologacao') {
      const baseUrl = customBaseUrl || 'https://h-gateway.receitaintegra.serpro.gov.br';
      return {
        baseUrl,
        tokenUrl: `${baseUrl}/token`,
        prefixoRtc: '/rtc'
      };
    } else if (ambiente === 'producao_restrita') {
      const baseUrl = customBaseUrl || 'https://api.receitafederal.gov.br';
      return {
        baseUrl,
        tokenUrl: `${baseUrl}/token`,
        prefixoRtc: '/prr-rtc'
      };
    } else {
      // Padrão: producao
      const baseUrl = customBaseUrl || 'https://api.receitafederal.gov.br';
      return {
        baseUrl,
        tokenUrl: `${baseUrl}/token`,
        prefixoRtc: '/rtc'
      };
    }
  }

  /**
   * Obtem o token de acesso OAuth2 valido, renovando proativamente se estiver expirado ou perto de expirar.
   * Utiliza cache em disco (token_cache.json) para persistir entre reinicializacoes da aplicacao.
   * 
   * @param overrideClientId - Client ID (se fornecido, sobrescreve o .env)
   * @param overrideClientSecret - Client Secret (se fornecido, sobrescreve o .env)
   */
  public static async getAccessToken(overrideClientId?: string, overrideClientSecret?: string): Promise<string> {
    let clientId = overrideClientId || process.env.RF_CLIENT_ID;
    let clientSecret = overrideClientSecret || process.env.RF_CLIENT_SECRET;

    // Pergunta de forma interativa se não estiver configurado
    if (!clientId) {
      console.log('\n[Segurança] RF_CLIENT_ID não encontrado.');
      clientId = await this.promptQuestion('👉 Insira o seu Client ID da Receita Federal: ');
    }

    if (!clientSecret) {
      console.log('[Segurança] RF_CLIENT_SECRET não encontrado.');
      clientSecret = await this.promptQuestion('👉 Insira o seu Client Secret da Receita Federal: ');
      console.log(''); // Pula linha
    }

    if (!clientId || !clientSecret) {
      throw new Error(
        'Erro de Autenticação: Client ID e Client Secret são obrigatórios para obter o token.'
      );
    }

    // Cache separado por clientId para suportar múltiplas empresas
    const clientHash = clientId.substring(0, 8);
    const cacheFilePathEmpresa = path.resolve(__dirname, `../../token_cache_${clientHash}.json`);

    // Tenta ler o token previamente cacheado no disco
    const cache = this.lerCacheDoDisco(cacheFilePathEmpresa);
    const bufferTimeMs = 5 * 60 * 1000; // 5 minutos de margem
    const now = Date.now();

    if (cache && now < cache.expiresAt - bufferTimeMs) {
      console.log(`[Auth] Utilizando token OAuth2 valido recuperado do cache em disco (${clientHash}...).`);
      return cache.accessToken;
    }

    const { tokenUrl } = this.getUrlsPorAmbiente();
    console.log(`[Auth] Solicitando novo token à Receita Federal (${tokenUrl})...`);

    try {
      // Credenciais em Base64 para Basic Auth (Authorization: Basic <base64>)
      const credentialsBase64 = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      // Configuracao do corpo form-urlencoded conforme manual
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');

      const response = await axios.post<{ access_token: string; expires_in?: number }>(
        tokenUrl,
        params,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${credentialsBase64}`
          }
        }
      );

      const { access_token, expires_in } = response.data;

      if (!access_token) {
        throw new Error('A resposta da Receita Federal nao retornou a chave de acesso (access_token).');
      }

      // Se o governo nao retornar expires_in, assume-se a validade padrao do manual (1 hora = 3600 segundos)
      const durationSeconds = expires_in || 3600;
      const expiresAt = Date.now() + durationSeconds * 1000;

      // Salva o token cacheado no disco (separado por empresa)
      this.salvarCacheNoDisco({ accessToken: access_token, expiresAt }, cacheFilePathEmpresa);

      console.log(`[Auth] Novo token OAuth2 obtido com sucesso. Expira em: ${new Date(expiresAt).toLocaleTimeString('pt-BR')}`);
      return access_token;
    } catch (error: any) {
      console.error('Falha catastrofica ao autenticar na Receita Federal:', error.response?.data || error.message);
      throw new Error(`Erro na autenticacao OAuth2: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Le o cache de token do arquivo local.
   */
  private static lerCacheDoDisco(filePath?: string): TokenCache | null {
    const caminhoCache = filePath || this.cacheFilePath;
    try {
      if (fs.existsSync(caminhoCache)) {
        const fileContent = fs.readFileSync(caminhoCache, 'utf-8');
        return JSON.parse(fileContent);
      }
    } catch (error) {
      console.warn('[Auth] Aviso: Falha ao ler cache de token do disco, sera gerada uma nova requisicao.', error);
    }
    return null;
  }

  /**
   * Grava o cache de token no arquivo local.
   */
  private static salvarCacheNoDisco(cache: TokenCache, filePath?: string): void {
    const caminhoCache = filePath || this.cacheFilePath;
    try {
      fs.writeFileSync(caminhoCache, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (error) {
      console.error('[Auth] Erro critico ao salvar cache de token em disco:', error);
    }
  }

  /**
   * Remove o cache de token do arquivo local (força renovação)
   */
  public static clearCache(overrideClientId?: string): void {
    const clientId = overrideClientId || process.env.RF_CLIENT_ID;
    if (clientId) {
      const clientHash = clientId.substring(0, 8);
      const cacheFilePathEmpresa = path.resolve(__dirname, `../../token_cache_${clientHash}.json`);
      if (fs.existsSync(cacheFilePathEmpresa)) {
        try {
          fs.unlinkSync(cacheFilePathEmpresa);
          console.log(`[Auth] Cache de token local removido para forçar renovação (${clientHash}...).`);
        } catch (error) {
          console.warn('[Auth] Aviso: Falha ao remover cache de token local.', error);
        }
      }
    }
  }
}

