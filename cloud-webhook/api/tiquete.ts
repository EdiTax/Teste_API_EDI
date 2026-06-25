import type { VercelRequest, VercelResponse } from '@vercel/node';
import { obterEDeletarTiquete } from './_supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Garantir apenas requisicoes GET para consulta
  if (req.method !== 'GET') {
    return res.status(451).json({ error: 'Metodo nao permitido. Utilize GET.' });
  }

  // 1. Validacao de Seguranca (Authorization Token)
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const authHeader = req.headers.authorization;

  if (!webhookSecret) {
    console.error('ERRO: Variavel de ambiente WEBHOOK_SECRET nao configurada no servidor Vercel.');
    return res.status(500).json({ error: 'Erro interno de configuracao do servidor.' });
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nao autorizado. Token Bearer ausente.' });
  }

  const token = authHeader.substring(7); // Remove 'Bearer '
  if (token !== webhookSecret) {
    return res.status(401).json({ error: 'Nao autorizado. Token invalido.' });
  }

  // 2. Validacao do Parametro CNPJ
  const cnpj = req.query.cnpj as string;
  if (!cnpj || !/^\d{8,14}$/.test(cnpj)) {
    return res.status(400).json({ error: 'CNPJ invalido. Deve conter entre 8 e 14 digitos numericos.' });
  }

  try {
    // 3. Obter e apagar o tiquete (deletar imediatamente para sigilo fiscal)
    const tiquete = await obterEDeletarTiquete(cnpj);

    if (tiquete) {
      return res.status(200).json({
        status: 'completed',
        cnpj,
        tiquete
      });
    }

    // Se nao encontrou, mantem o status pendente para o motor local continuar o polling
    return res.status(200).json({
      status: 'pending',
      cnpj
    });
  } catch (error: any) {
    console.error('Erro ao processar consulta de tiquete:', error);
    return res.status(500).json({ error: 'Erro interno ao consultar o banco de dados.', details: error.message });
  }
}
