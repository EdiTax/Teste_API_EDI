document.addEventListener('DOMContentLoaded', () => {
  // Elementos do DOM - Simulação
  const simForm = document.getElementById('simulator-form');
  const simFeedback = document.getElementById('sim-feedback');
  const btnSimular = document.getElementById('btn-simular');

  // Elementos do DOM - Consulta
  const checkForm = document.getElementById('check-form');
  const checkFeedback = document.getElementById('check-feedback');
  const btnConsultar = document.getElementById('btn-consultar');

  // Elementos do DOM - Logs e Outros
  const logScreen = document.getElementById('log-screen');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  const steps = document.querySelectorAll('.step-item');

  // Função para adicionar logs na tela
  function writeLog(message, type = 'system') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const logLine = document.createElement('div');
    logLine.className = `log-line ${type}`;
    logLine.textContent = `[${timestamp}] ${message}`;
    logScreen.appendChild(logLine);
    
    // Rolar para o final do terminal de logs
    logScreen.scrollTop = logScreen.scrollHeight;
  }

  // Limpar Logs
  btnClearLogs.addEventListener('click', () => {
    logScreen.innerHTML = '<div class="log-line system">[SISTEMA] Logs limpos. Painel operacional.</div>';
  });

  // Atualizar visualmente o progresso das Fases
  function updateProgressSteps(currentStepIndex) {
    steps.forEach((step, index) => {
      if (index === currentStepIndex) {
        step.classList.add('active');
      } else {
        step.classList.remove('active');
      }
    });
  }

  // --- 1. Lógica do Formulário de Simulação de Webhook ---
  simForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const cnpj = document.getElementById('cnpj').value.trim();
    const tiquete = document.getElementById('tiquete').value.trim();
    const secret = document.getElementById('secret').value;

    // Reset de feedback
    simFeedback.className = 'feedback-msg hidden';
    simFeedback.textContent = '';
    
    if (!/^\d{8,14}$/.test(cnpj)) {
      writeLog('Erro: CNPJ deve ter entre 8 e 14 dígitos numéricos.', 'error');
      simFeedback.className = 'feedback-msg error';
      simFeedback.textContent = 'O CNPJ deve conter apenas números (de 8 a 14 dígitos).';
      return;
    }

    writeLog(`[Simulação] Iniciando disparo de webhook fictício da Receita Federal para o CNPJ ${cnpj}...`, 'system');
    btnSimular.disabled = true;
    btnSimular.querySelector('span').textContent = 'Processando...';

    // Atualiza progresso para Fase 1
    updateProgressSteps(0);

    try {
      // Dispara o POST simulado para o endpoint do webhook local/nuvem
      const response = await fetch(`/api/webhook-receita?secret=${encodeURIComponent(secret)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ cnpj, tiquete })
      });

      const data = await response.json();

      if (response.ok) {
        writeLog(`[Simulação] Sucesso! Webhook recebeu o tíquete com sucesso.`, 'success');
        writeLog(`[Simulação] Dados salvos temporariamente: CNPJ=${cnpj} | Tíquete=${tiquete}`, 'success');
        
        simFeedback.className = 'feedback-msg success';
        simFeedback.innerHTML = `<strong>Sucesso na simulação!</strong><br>O webhook aceitou e salvou o tíquete no Supabase/Memória.`;
        
        // Atualiza progresso para Fase 2 (Pronto para o Motor Local atuar)
        updateProgressSteps(1);
      } else {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

    } catch (err) {
      writeLog(`[Simulação] Erro no Webhook: ${err.message}`, 'error');
      
      simFeedback.className = 'feedback-msg error';
      simFeedback.innerHTML = `<strong>Erro na simulação:</strong><br>${err.message}`;
    } finally {
      btnSimular.disabled = false;
      btnSimular.querySelector('span').textContent = 'Enviar Simulação';
    }
  });

  // --- 2. Lógica de Consulta Reativa de Tíquete ---
  checkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const cnpj = document.getElementById('check-cnpj').value.trim();
    const secret = document.getElementById('check-secret').value;

    // Reset de feedback
    checkFeedback.className = 'feedback-msg hidden';
    checkFeedback.textContent = '';

    if (!/^\d{8,14}$/.test(cnpj)) {
      writeLog('Erro: CNPJ inválido para consulta.', 'error');
      checkFeedback.className = 'feedback-msg error';
      checkFeedback.textContent = 'CNPJ inválido.';
      return;
    }

    writeLog(`[Consulta] Fazendo polling de busca do tíquete para o CNPJ ${cnpj}...`, 'system');
    btnConsultar.disabled = true;
    btnConsultar.querySelector('span').textContent = 'Buscando...';

    // Atualiza progresso para Fase 3 (Polling ativo)
    updateProgressSteps(2);

    try {
      const response = await fetch(`/api/tiquete?cnpj=${cnpj}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${secret}`
        }
      });

      const data = await response.json();

      if (response.ok) {
        if (data.status === 'completed') {
          writeLog(`[Consulta] Tíquete encontrado! Tíquete = ${data.tiquete}`, 'success');
          writeLog(`[Limpeza Reativa] O tíquete foi excluído do Supabase por razões de privacidade.`, 'success');
          
          checkFeedback.className = 'feedback-msg success';
          checkFeedback.innerHTML = `<strong>Status: Concluído!</strong><br>Tíquete recuperado: <code>${data.tiquete}</code>.<br><small>O registro foi apagado do banco de dados na nuvem (Clean-Up ativo).</small>`;
          
          // Atualiza progresso para Fase 4 (Consumo realizado)
          updateProgressSteps(3);
        } else {
          writeLog(`[Consulta] O webhook respondeu: Status 'pending' (Não há tíquete pendente no banco de dados para este CNPJ).`, 'incoming');
          
          checkFeedback.className = 'feedback-msg error';
          checkFeedback.style.boxShadow = 'none'; // suaviza o visual
          checkFeedback.style.borderColor = 'rgba(245, 158, 11, 0.3)'; // cor amarela/alerta
          checkFeedback.style.color = '#f59e0b';
          checkFeedback.innerHTML = `<strong>Ainda pendente:</strong><br>A Receita Federal ainda não notificou o webhook com o tíquete ou o tíquete já foi consumido.`;
        }
      } else {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

    } catch (err) {
      writeLog(`[Consulta] Erro ao consultar tíquete: ${err.message}`, 'error');
      
      checkFeedback.className = 'feedback-msg error';
      checkFeedback.innerHTML = `<strong>Erro na consulta:</strong><br>${err.message}`;
    } finally {
      btnConsultar.disabled = false;
      btnConsultar.querySelector('span').textContent = 'Consultar & Consumir';
    }
  });

});
