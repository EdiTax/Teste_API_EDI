import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!redisUrl || !redisToken) {
  console.warn(
    'AVISO: URL ou TOKEN do Redis (Upstash / Vercel KV) nao configuradas nas variaveis de ambiente. O webhook utilizara armazenamento em memoria volatil temporaria.'
  );
}

// Armazenamento em memoria local caso o Redis nao esteja configurado (util para testes locais rapidos)
const memoryStorage = new Map<string, { tiquete: string; createdAt: Date }>();

export const getRedisClient = () => {
  if (redisUrl && redisToken) {
    return new Redis({
      url: redisUrl,
      token: redisToken,
    });
  }
  return null;
};

/**
 * Persiste o tiquete para o CNPJ informado com TTL (Time-To-Live) de 24h.
 */
export async function salvarTiquete(cnpj: string, tiquete: string): Promise<boolean> {
  const redis = getRedisClient();

  if (redis) {
    try {
      // SET cnpj:tiquete valor EX 86400 (24 horas de expiracao)
      await redis.set(`tiquete:${cnpj}`, tiquete, { ex: 86400 });
      return true;
    } catch (error: any) {
      console.error('Erro ao salvar tiquete no Redis:', error.message);
      throw new Error(`Falha no banco de dados (Redis): ${error.message}`);
    }
  } else {
    // Fallback memoria
    memoryStorage.set(`tiquete:${cnpj}`, { tiquete, createdAt: new Date() });
    return true;
  }
}

/**
 * Consulta e remove o tiquete (higienizacao ativa).
 */
export async function obterEDeletarTiquete(cnpj: string): Promise<string | null> {
  const redis = getRedisClient();
  const key = `tiquete:${cnpj}`;

  if (redis) {
    try {
      // 1. Consulta
      const tiquete = await redis.get<string>(key);

      if (tiquete) {
        // 2. Delecao Reativa (Higienizacao LGPD)
        await redis.del(key);
        return tiquete;
      }
      return null;
    } catch (error: any) {
      console.error('Erro ao consultar/deletar tiquete no Redis:', error.message);
      throw new Error(`Falha ao acessar o banco de dados (Redis): ${error.message}`);
    }
  } else {
    // Fallback memoria
    const item = memoryStorage.get(key);
    if (item) {
      memoryStorage.delete(key);
      return item.tiquete;
    }
    return null;
  }
}
