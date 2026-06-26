import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AuthService } from './auth.service';

/**
 * Representa uma empresa cadastrada no YAML de credenciais.
 */
export interface EmpresaConfig {
  codigo: number;
  empresa: string;
  cnpj_completo: string;
  cnpj_base: string;
  client_id: string;
  client_secret: string;
  status: string;
  grupo: 'agtax' | 'cliente';
}

/**
 * Serviço responsável por carregar as credenciais do YAML
 * e apresentar um menu interativo para seleção da empresa.
 */
export class EmpresaSelectorService {
  private static readonly YAML_PATH = path.resolve(__dirname, '../../../credenciais_empresas.yaml');

  /**
   * Carrega todas as empresas do YAML e retorna em uma lista unificada.
   */
  public static carregarEmpresas(): EmpresaConfig[] {
    if (!fs.existsSync(this.YAML_PATH)) {
      throw new Error(
        `Arquivo de credenciais não encontrado: ${this.YAML_PATH}\n` +
        'Crie o arquivo credenciais_empresas.yaml na raiz do projeto.'
      );
    }

    const conteudo = fs.readFileSync(this.YAML_PATH, 'utf-8');
    const dados: any = yaml.load(conteudo);
    const empresas: EmpresaConfig[] = [];

    // Carrega empresas do grupo AGtax
    if (dados.agtax && Array.isArray(dados.agtax)) {
      for (const emp of dados.agtax) {
        if (emp.cnpj_base && emp.client_id) {
          empresas.push({ ...emp, grupo: 'agtax' });
        }
      }
    }

    // Carrega empresas do grupo Clientes
    if (dados.clientes && Array.isArray(dados.clientes)) {
      for (const emp of dados.clientes) {
        if (emp.cnpj_base && emp.client_id) {
          empresas.push({ ...emp, grupo: 'cliente' });
        }
      }
    }

    if (empresas.length === 0) {
      throw new Error('Nenhuma empresa com credenciais válidas encontrada no YAML.');
    }

    return empresas;
  }

  /**
   * Exibe o menu interativo com a lista de empresas e aguarda a seleção do usuário.
   * Retorna a empresa selecionada.
   */
  public static async selecionarEmpresa(): Promise<EmpresaConfig> {
    const empresas = this.carregarEmpresas();

    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║           SELECIONE A EMPRESA PARA APURAÇÃO             ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');

    // Agrupa por tipo para exibição organizada
    const agtaxEmpresas = empresas.filter(e => e.grupo === 'agtax');
    const clienteEmpresas = empresas.filter(e => e.grupo === 'cliente');

    if (agtaxEmpresas.length > 0) {
      console.log('║  📁 ESCRITÓRIO (AGtax)                                   ║');
      for (const emp of agtaxEmpresas) {
        const nome = emp.empresa.substring(0, 45).padEnd(45);
        const cnpj = emp.cnpj_base.padEnd(10);
        console.log(`║  ${emp.codigo} - ${nome} ${cnpj}║`);
      }
    }

    if (clienteEmpresas.length > 0) {
      console.log('║                                                           ║');
      console.log('║  📁 CLIENTES COM PROCURAÇÃO                               ║');
      for (const emp of clienteEmpresas) {
        const nome = emp.empresa.substring(0, 45).padEnd(45);
        const cnpj = emp.cnpj_base.padEnd(10);
        console.log(`║  ${emp.codigo} - ${nome} ${cnpj}║`);
      }
    }

    console.log('╚═══════════════════════════════════════════════════════════╝');

    const codigosValidos = empresas.map(e => e.codigo);
    let empresaSelecionada: EmpresaConfig | undefined;

    while (!empresaSelecionada) {
      const resposta = await AuthService.promptQuestion(`\n👉 Digite o número da empresa (${codigosValidos.join(', ')}): `);
      const codigo = parseInt(resposta, 10);

      empresaSelecionada = empresas.find(e => e.codigo === codigo);

      if (!empresaSelecionada) {
        console.log(`❌ Código "${resposta}" inválido. Escolha um dos seguintes: ${codigosValidos.join(', ')}`);
      }
    }

    console.log(`\n✓ Empresa selecionada: ${empresaSelecionada.empresa}`);
    console.log(`  CNPJ Base: ${empresaSelecionada.cnpj_base}`);
    console.log(`  Client ID: ${empresaSelecionada.client_id.substring(0, 8)}...`);
    console.log(`  Grupo: ${empresaSelecionada.grupo === 'agtax' ? 'Escritório (AGtax)' : 'Cliente com Procuração'}`);

    return empresaSelecionada;
  }
}
