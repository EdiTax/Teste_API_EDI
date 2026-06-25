import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Apenas chamadas GET
  if (req.method !== 'GET') {
    return res.status(451).json({ error: 'Metodo nao permitido. Utilize GET.' });
  }

  // Verifica a existência das variáveis de ambiente de forma segura (retornando apenas booleanos)
  const webhookSecretConfigured = !!process.env.WEBHOOK_SECRET;
  const supabaseUrlConfigured = !!process.env.SUPABASE_URL;
  const supabaseKeyConfigured = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

  return res.status(200).json({
    webhookSecret: webhookSecretConfigured,
    supabaseUrl: supabaseUrlConfigured,
    supabaseKey: supabaseKeyConfigured,
    // Informa se está rodando no Supabase real ou em memória volatil local
    storageType: (supabaseUrlConfigured && supabaseKeyConfigured) ? 'Supabase Database' : 'Memory Storage (Volatile)'
  });
}
