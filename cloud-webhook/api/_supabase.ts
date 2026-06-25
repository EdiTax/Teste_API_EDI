import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    'AVISO: SUPABASE_URL ou SUPABASE_KEY nao configuradas nas variaveis de ambiente. O webhook utilizara armazenamento em memoria volatil temporaria.'
  );
}

// Armazenamento em memoria local caso o Supabase nao esteja configurado (util para testes locais rapido)
const memoryStorage = new Map<string, { tiquete: string; createdAt: Date }>();

export const getSupabaseClient = () => {
  if (supabaseUrl && supabaseKey) {
    return createClient(supabaseUrl, supabaseKey);
  }
  return null;
};

/**
 * Persiste o tiquete para o CNPJ informado.
 */
export async function salvarTiquete(cnpj: string, tiquete: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  
  if (supabase) {
    const { error } = await supabase
      .from('tiquetes_cbs')
      .upsert(
        { cnpj, tiquete, created_at: new Date().toISOString() },
        { onConflict: 'cnpj' }
      );
    
    if (error) {
      console.error('Erro ao salvar tiquete no Supabase:', error.message);
      throw new Error(`Falha no banco de dados: ${error.message}`);
    }
    return true;
  } else {
    // Fallback memoria
    memoryStorage.set(cnpj, { tiquete, createdAt: new Date() });
    return true;
  }
}

/**
 * Consulta e remove o tiquete (higienizacao ativa).
 */
export async function obterEDeletarTiquete(cnpj: string): Promise<string | null> {
  const supabase = getSupabaseClient();

  if (supabase) {
    // 1. Consulta
    const { data, error } = await supabase
      .from('tiquetes_cbs')
      .select('tiquete')
      .eq('cnpj', cnpj)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Registro nao encontrado
        return null;
      }
      console.error('Erro ao consultar tiquete no Supabase:', error.message);
      throw new Error(`Falha ao ler banco de dados: ${error.message}`);
    }

    if (data && data.tiquete) {
      // 2. Delecao Reativa (Higienizacao LGPD)
      const { error: deleteError } = await supabase
        .from('tiquetes_cbs')
        .delete()
        .eq('cnpj', cnpj);

      if (deleteError) {
        console.error('Aviso: erro ao deletar tiquete processado (limpeza falhou):', deleteError.message);
      }

      return data.tiquete;
    }
    return null;
  } else {
    // Fallback memoria
    const item = memoryStorage.get(cnpj);
    if (item) {
      memoryStorage.delete(cnpj);
      return item.tiquete;
    }
    return null;
  }
}
