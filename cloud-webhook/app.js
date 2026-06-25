document.addEventListener('DOMContentLoaded', () => {
  // Elementos do DOM - Cópia de URL
  const webhookFullUrlSpan = document.getElementById('webhook-full-url');
  const btnCopyUrl = document.getElementById('btn-copy-url');

  // Elementos do DOM - Diagnóstico de Ambiente
  const chkSecret = document.getElementById('chk-secret');
  const chkUrl = document.getElementById('chk-url');
  const chkKey = document.getElementById('chk-key');
  const envStorage = document.getElementById('env-storage');

  // Elementos do DOM - Simulação
  const simForm = document.getElementById('simulator-form');
  const simFeedback = document.getElementById('sim-feedback');
  const btnSimular = document.getElementById('btn-simular');
  const inputSecret = document.getElementById('secret');
  const inputCnpj = document.getElementById('cnpj');

  // Elementos do DOM - Consulta
  const checkForm = document.getElementById('check-form');
  const checkFeedback = document.getElementById('check-feedback');
  const btnConsultar = document.getElementById('btn-consultar');
  const inputCheckSecret = document.getElementById('check-secret');

  // Elementos do DOM - Histórico e Logs
  const historyListBody = document.getElementById('history-list-body');
  const logScreen = document.getElementById('log-screen');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  const steps = document.querySelectorAll('.step-item');

  // --- Função para Adicionar Logs no Console Visual ---
  function writeLog(message, type = 'system') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const logLine = document.createElement('div');
    logLine.className = `log-line ${type}`;
    logLine.textContent = `[${timestamp}] ${message}`;
    logScreen.appendChild(logLine);
    logScreen.scrollTop = logScreen.scrollHeight; // Rola pro final
  }

  // Limpar logs do terminal
  btnClearLogs.addEventListener('click', () => {
    logScreen.innerHTML = '<div class="log-line system">[SISTEMA] Logs limpos. Painel operacional.</div>';
  });

  // --- Lógica de Cópia da URL do Webhook ---
  const host = window.location.origin;
  
  function atualizarUrlExibida() {
    const secretValue = inputSecret.value.trim() || 'SEU_SEGREDO_AQUI';
    const fullUrl = `${host}/api/webhook-receita?secret=${encodeURIComponent(secretValue)}`;
    webhookFullUrlSpan.textContent = fullUrl;
  }

  // Atualiza a URL na tela conforme o usuário digita o segredo
  inputSecret.addEventListener('input', () => {
    atualizarUrlExibida();
    // Auto-preenche o segredo da consulta para facilitar o teste
    inputCheckSecret.value = inputSecret.value;
  });

  atualizarUrlExibida(); // Chamada inicial

  // Copiar para o clipboard
  btnCopyUrl.addEventListener('click', async () => {
    const textToCopy = webhookFullUrlSpan.textContent;
    try {
      await navigator.clipboard.writeText(textToCopy);
      const originalText = btnCopyUrl.querySelector('span').textContent;
      btnCopyUrl.querySelector('span').textContent = 'Copiado!';
      btnCopyUrl.style.background = 'var(--success)';
      writeLog('[Cópia] URL do Webhook copiada para a área de transferência.', 'system');

      setTimeout(() => {
        btnCopyUrl.querySelector('span').textContent = originalText;
        btnCopyUrl.style.background = '';
      }, 2000);
    } catch (err) {
      writeLog(`[Cópia] Falha ao copiar: ${err.message}`, 'error');
    }
  });

  // --- Lógica de Diagnóstico das Variáveis de Ambiente na Vercel ---
  async function verificarAmbiente() {
    writeLog('[Diagnóstico] Verificando variáveis de ambiente no servidor...', 'system');
    try {
      const response = await fetch('/api/status-env');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      // Helper para renderizar o status da variável
      const setStatus = (element, isConfigured) => {
        const statusSpan = element.querySelector('.item-status');
        if (isConfigured) {
          statusSpan.textContent = '✓';
          statusSpan.className = 'item-status status-success';
          element.style.color = '#34d399'; // Verde
        } else {
          statusSpan.textContent = '✗';
          statusSpan.className = 'item-status status-error';
          element.style.color = '#f87171'; // Vermelho
        }
      };

      setStatus(chkSecret, data.webhookSecret);
      setStatus(chkUrl, data.supabaseUrl);
      setStatus(chkKey, data.supabaseKey);

      envStorage.innerHTML = `Tipo de Armazenamento Ativo: <strong>${data.storageType}</strong>`;
      
      if (!data.supabaseUrl || !data.supabaseKey) {
        writeLog('[Aviso] Banco de dados Supabase não configurado. Os dados serão mantidos em memória temporária no servidor.', 'error');
      } else {
        writeLog('[Diagnóstico] Conexão com o Supabase validada com sucesso.', 'success');
      }

    } catch (err) {
      writeLog(`[Diagnóstico] Erro ao consultar variáveis no servidor: ${err.message}`, 'error');
      envStorage.innerHTML = `Tipo de Armazenamento Ativo: <span style="color: var(--error)">Erro de conexão</span>`;
    }
  }

  verificarAmbiente(); // Chamada inicial

  // --- Lógica do Histórico de Tíquetes na Sessão ---
  const tickesHistorico = new Map(); // Guarda CNPJ -> { tiquete, time, rowElement }

  function adicionarAoHistorico(cnpj, tiquete) {
    // Remove o indicador de "histórico vazio" se existir
    const emptyRow = document.getElementById('history-empty');
    if (emptyRow) emptyRow.remove();

    const timestamp = new Date().toLocaleTimeString('pt-BR');
    
    // Se o CNPJ já está listado, remove a linha antiga
    if (tickesHistorico.has(cnpj)) {
      const antigo = tickesHistorico.get(cnpj);
      antigo.rowElement.remove();
    }

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><code>${cnpj}</code></td>
      <td><code class="tiquete-code">${tiquete}</code></td>
      <td>${timestamp}</td>
    `;

    historyListBody.insertBefore(row, historyListBody.firstChild);
    tickesHistorico.set(cnpj, { tiquete, time: timestamp, rowElement: row });
  }

  function marcarComoConsumido(cnpj) {
    if (tickesHistorico.has(cnpj)) {
      const item = tickesHistorico.get(cnpj);
      item.rowElement.classList.add('consumed');
      item.rowElement.style.opacity = '0.4';
      item.rowElement.style.textDecoration = 'line-through';
      const code = item.rowElement.querySelector('.tiquete-code');
      if (code) {
        code.textContent += ' (Consumido)';
        code.style.color = 'var(--text-dimmed)';
      }
    }
  }

  // --- Lógica do Progresso das Fases ---
  function updateProgressSteps(currentStepIndex) {
    steps.forEach((step, index) => {
      if (index === currentStepIndex) {
        step.classList.add('active');
      } else {
        step.classList.remove('active');
      }
    });
  }

  // --- 3. Envio de Simulação (Webhook Receita) ---
  simForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const cnpj = inputCnpj.value.trim();
    const tiquete = document.getElementById('tiquete').value.trim();
    const secret = inputSecret.value;

    simFeedback.className = 'feedback-msg hidden';
    simFeedback.textContent = '';
    
    if (!/^\d{8,14}$/.test(cnpj)) {
      writeLog('Erro: CNPJ deve conter entre 8 e 14 dígitos numéricos.', 'error');
      simFeedback.className = 'feedback-msg error';
      simFeedback.textContent = 'CNPJ inválido.';
      return;
    }

    writeLog(`[Simulação] Disparando webhook POST fictício da Receita Federal para ${cnpj}...`, 'system');
    btnSimular.disabled = true;
    btnSimular.querySelector('span').textContent = 'Processando...';
    updateProgressSteps(0);

    try {
      const response = await fetch(`/api/webhook-receita?secret=${encodeURIComponent(secret)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj, tiquete })
      });

      const data = await response.json();

      if (response.ok) {
        writeLog(`[Simulação] Sucesso! Webhook aceitou o tíquete.`, 'success');
        writeLog(`[Simulação] Gravado: CNPJ=${cnpj} | Tíquete=${tiquete}`, 'success');
        
        simFeedback.className = 'feedback-msg success';
        simFeedback.innerHTML = `<strong>Sucesso na simulação!</strong> O webhook aceitou o tíquete.`;
        
        adicionarAoHistorico(cnpj, tiquete);
        updateProgressSteps(1); // Fase 2: Pronto para o Motor Local
      } else {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
    } catch (err) {
      writeLog(`[Simulação] Erro no Webhook: ${err.message}`, 'error');
      simFeedback.className = 'feedback-msg error';
      simFeedback.innerHTML = `<strong>Erro na simulação:</strong> ${err.message}`;
    } finally {
      btnSimular.disabled = false;
      btnSimular.querySelector('span').textContent = 'Enviar Simulação';
    }
  });

  // --- 4. Lógica de Consulta Reativa de Tíquete ---
  checkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const cnpj = document.getElementById('check-cnpj').value.trim();
    const secret = inputCheckSecret.value;

    checkFeedback.className = 'feedback-msg hidden';
    checkFeedback.textContent = '';

    if (!/^\d{8,14}$/.test(cnpj)) {
      writeLog('Erro: CNPJ inválido para consulta.', 'error');
      checkFeedback.className = 'feedback-msg error';
      checkFeedback.textContent = 'CNPJ inválido.';
      return;
    }

    writeLog(`[Consulta] Fazendo polling buscando tíquete para CNPJ ${cnpj}...`, 'system');
    btnConsultar.disabled = true;
    btnConsultar.querySelector('span').textContent = 'Buscando...';
    updateProgressSteps(2); // Fase 3: Polling ativo

    try {
      const response = await fetch(`/api/tiquete?cnpj=${cnpj}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${secret}` }
      });

      const data = await response.json();

      if (response.ok) {
        if (data.status === 'completed') {
          writeLog(`[Consulta] Tíquete obtido da nuvem: ${data.tiquete}`, 'success');
          writeLog(`[Limpeza Reativa] Tíquete excluído do banco de dados na nuvem com sucesso.`, 'success');
          
          checkFeedback.className = 'feedback-msg success';
          checkFeedback.innerHTML = `<strong>Concluído!</strong> Tíquete obtido: <code>${data.tiquete}</code>.<br><small>O registro foi deletado na nuvem (Clean-Up ativo).</small>`;
          
          marcarComoConsumido(cnpj);
          updateProgressSteps(3); // Fase 4: Consumido
        } else {
          writeLog(`[Consulta] O webhook respondeu: Status 'pending' (Tíquete ainda não recebido na nuvem).`, 'incoming');
          checkFeedback.className = 'feedback-msg error';
          checkFeedback.style.borderColor = 'rgba(245, 158, 11, 0.3)';
          checkFeedback.style.color = '#f59e0b';
          checkFeedback.innerHTML = `<strong>Pendente:</strong> O webhook da Vercel ainda não recebeu o tíquete da Receita Federal.`;
        }
      } else {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
    } catch (err) {
      writeLog(`[Consulta] Erro ao consultar tíquete: ${err.message}`, 'error');
      checkFeedback.className = 'feedback-msg error';
      checkFeedback.innerHTML = `<strong>Erro na consulta:</strong> ${err.message}`;
    } finally {
      btnConsultar.disabled = false;
      btnConsultar.querySelector('span').textContent = 'Consultar & Consumir';
    }
  });

});
