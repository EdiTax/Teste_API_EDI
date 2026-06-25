import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { salvarTiquete } from './_supabase';

// Schema para validacao robusta do payload da Receita Federal
const webhookPayloadSchema = z.object({
  cnpj: z.string().min(8).max(14).regex(/^\d+$/, 'O CNPJ deve conter apenas numeros.'),
  tiquete: z.string().min(5, 'O tiquete deve ter pelo menos 5 caracteres.')
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Garantir apenas requisicoes POST
  if (req.method !== 'POST') {
    return res.status(451).json({ error: 'Metodo nao permitido. Utilize POST.' });
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
    // 2. Validacao do Payload estrutural usando Zod
    const validation = webhookPayloadSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Payload invalido. Verifique o formato do JSON.', 
        details: validation.error.format() 
      });
    }

    const { cnpj, tiquete } = validation.data;

    // 3. Persistir o tiquete de forma temporaria
    await salvarTiquete(cnpj, tiquete);

    console.log(`Sucesso: Tiquete recebido e salvo para o CNPJ ${cnpj}`);

    return res.status(200).json({ success: true, message: 'Tiquete recebido e salvo com sucesso.' });
  } catch (error: any) {
    console.error('Erro nao tratado no processamento do Webhook:', error);
    return res.status(500).json({ error: 'Erro interno no processamento do webhook.', details: error.message });
  }
}
