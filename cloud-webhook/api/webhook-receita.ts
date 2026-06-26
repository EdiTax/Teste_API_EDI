import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { salvarTiquete } from './_redis';

// Removemos o Zod estrito porque a Receita pode mandar formatos inesperados.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // A Receita Federal costuma fazer um HEAD request antes do POST para verificar se o endpoint existe
  if (req.method === 'HEAD') {
    return res.status(200).end();
  }

  // Garantir apenas requisicoes POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido. Utilize POST.' });
  }

  // 1. Validacao de Seguranca (Token Secreto)
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const clientSecret = req.query.secret || req.headers['x-webhook-secret'];

  if (!webhookSecret) {
    console.error('ERRO: Variavel de ambiente WEBHOOK_SECRET nao configurada no servidor Vercel.');
    return res.status(500).json({ error: 'Erro interno de configuracao do servidor.' });
  }

  if (clientSecret !== webhookSecret) {
    console.warn('Alerta de Seguranca: Tentativa de requisicao ao webhook com token invalido.');
    return res.status(401).json({ error: 'Nao autorizado. Token de seguranca invalido ou ausente.' });
  }

  try {
    // 2. Extração Flexível do Payload
    // A Receita pode não mandar o CNPJ no body, então pegamos da querystring se enviarmos na hora da solicitação
    const cnpj = (req.body?.cnpj || req.query.cnpj)?.toString();
    const tiquete = req.body?.tiquete || req.body?.id || req.body?.ticket || req.body?.protocolo || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

    if (!cnpj || !/^\d+$/.test(cnpj)) {
      console.error(`Erro no Webhook: CNPJ não identificado no payload ou querystring. Payload:`, req.body);
      return res.status(400).json({ error: 'CNPJ nao identificado. Verifique se o urlRetorno inclui ?cnpj=...' });
    }

    if (!tiquete || tiquete.length < 5) {
      console.error(`Erro no Webhook: Tíquete não identificado. Payload:`, req.body);
      return res.status(400).json({ error: 'Tiquete nao identificado no payload.' });
    }

    // 3. Persistir o tiquete de forma temporaria
    await salvarTiquete(cnpj, tiquete);

    console.log(`Sucesso: Tiquete recebido e salvo para o CNPJ ${cnpj}`);

    return res.status(200).json({ success: true, message: 'Tiquete recebido e salvo com sucesso.' });
  } catch (error: any) {
    console.error('Erro nao tratado no processamento do Webhook:', error);
    return res.status(500).json({ error: 'Erro interno no processamento do webhook.', details: error.message });
  }
}
