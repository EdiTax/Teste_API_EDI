import * as fs from 'fs';
import * as path from 'path';

interface LimitesData {
  [cnpj: string]: string[]; // Array de strings ISO das chamadas efetuadas
}

export class CircuitBreakerService {
  private static filePath = path.resolve(__dirname, '../../limites_disparo.json');

  /**
   * Verifica se a chamada de solicitacao pode ser feita para o CNPJ.
   * Lanca erro caso o limite de 2 chamadas/dia civil ja tenha sido atingido.
   */
  public static verificarELancar(cnpj: string): void {
    const data = this.carregarDados();
    const hojeLocal = new Date().toLocaleDateString('pt-BR'); // Formato DD/MM/YYYY

    const chamadasDoCnpj = data[cnpj] || [];
    
    // Filtrar apenas chamadas feitas no dia de hoje
    const chamadasHoje = chamadasDoCnpj.filter((timestampStr) => {
      const dataChamada = new Date(timestampStr);
      return dataChamada.toLocaleDateString('pt-BR') === hojeLocal;
    });

    if (chamadasHoje.length >= 2) {
      throw new Error(
        `[TRAVA DO MOTOR LOCAL]: Solicitacao bloqueada para o CNPJ ${cnpj}. ` +
        `O limite maximo de 2 chamadas diarias da Receita Federal ja foi atingido hoje (${hojeLocal}). ` +
        `Nao consuma o limite desnecessariamente para evitar erro 429.`
      );
    }
  }

  /**
   * Retorna a data/hora do último disparo realizado hoje para o CNPJ, se houver.
   */
  public static obterUltimoDisparoHoje(cnpj: string): string | null {
    const data = this.carregarDados();
    const hojeLocal = new Date().toLocaleDateString('pt-BR');
    const chamadasDoCnpj = data[cnpj] || [];
    
    const chamadasHoje = chamadasDoCnpj.filter((timestampStr) => {
      const dataChamada = new Date(timestampStr);
      return dataChamada.toLocaleDateString('pt-BR') === hojeLocal;
    });

    if (chamadasHoje.length > 0) {
      return chamadasHoje[chamadasHoje.length - 1];
    }
    return null;
  }

  /**
   * Registra um novo disparo de solicitacao efetuado com sucesso no arquivo local.
   */
  public static registrarDisparo(cnpj: string): void {
    const data = this.carregarDados();
    
    if (!data[cnpj]) {
      data[cnpj] = [];
    }

    data[cnpj].push(new Date().toISOString());

    // Limpeza opcional: manter apenas os ultimos 10 registros para nao inflar o arquivo
    if (data[cnpj].length > 10) {
      data[cnpj] = data[cnpj].slice(-10);
    }

    this.salvarDados(data);
    console.log(`[Circuit Breaker] Disparo registrado localmente para CNPJ ${cnpj}. Cota diaria atualizada.`);
  }

  /**
   * Carrega os dados de chamadas do arquivo JSON.
   */
  private static carregarDados(): LimitesData {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(fileContent);
      }
    } catch (error) {
      console.warn('Aviso: falha ao ler arquivo de limites, reiniciando contador local temporario.', error);
    }
    return {};
  }

  /**
   * Salva os dados no arquivo JSON local.
   */
  private static salvarDados(data: LimitesData): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Erro critico ao salvar arquivo de trava local:', error);
    }
  }
}
