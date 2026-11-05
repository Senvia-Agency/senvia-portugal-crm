import { validateAutomationVariableTemplates } from './automation-variable-validation.ts';
import { conditionValueIssue } from './automation-condition-validation.ts';
import { validateAdditionalActions } from './automation-validation-actions.ts';
import type { AutomationGraph, AutomationNodeConfig } from '../types/automations';

export interface AutomationValidationIssue {
  readonly nodeId: string | null;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

export function validateAutomationConfiguration(graph: AutomationGraph, options: {
  readonly flowId?: string;
  readonly entryNodeId?: string | null;
  readonly triggerConfig?: Readonly<Record<string, unknown>>;
  readonly availableVariables?: Readonly<Record<string, readonly string[]>>;
} = {}): AutomationValidationIssue[] {
  const issues: AutomationValidationIssue[] = [];
  const add = (nodeId: string | null, message: string, severity: 'error' | 'warning' = 'error') => {
    issues.push({ nodeId, message, severity });
  };
  const validateCondition = (config: AutomationNodeConfig, id: string, depth = 0): void => {
    if (depth > 8) { add(id, 'A condição tem demasiados níveis. Simplifique os grupos.'); return; }
    if (config.conditions !== undefined) {
      if (!config.conditions.length) add(id, 'O grupo precisa de pelo menos uma condição.');
      if (config.match !== 'all' && config.match !== 'any') add(id, 'Escolha Todas ou Qualquer no grupo.');
      for (const rule of config.conditions) validateCondition(rule, id, depth + 1);
      return;
    }
    if (!config.field?.trim()) add(id, 'Escolha o campo da condição.');
    const operator = config.operator ?? 'equals';
    const valueIssue = conditionValueIssue(operator, config.value);
    if (valueIssue) add(id, valueIssue);
  };
  const validTime = (value: unknown) => typeof value === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
  const integer = (value: unknown) => typeof value === 'number' && Number.isInteger(value);
  for (const node of graph.nodes) {
    const cfg = node.config;
    switch (String(node.type)) {
      case 'condition':
      case 'filter': validateCondition(cfg, node.id); break;
      case 'split_ab': {
        const variants = cfg.variants ?? [];
        if (variants.length < 2 || variants.length > 5) add(node.id, 'Defina entre 2 e 5 variantes.');
        if (variants.some(variant => !Number.isFinite(variant.weight) || variant.weight <= 0)
          || Math.abs(variants.reduce((sum, variant) => sum + variant.weight, 0) - 100) > 0.001) add(node.id, 'As percentagens das variantes devem ser positivas e somar 100.');
        if (variants.some(variant => !variant.id || ['error', 'default'].includes(variant.id))
          || new Set(variants.map(variant => variant.id)).size !== variants.length) add(node.id, 'As variantes precisam de identificadores únicos.');
        break;
      }
      case 'execute_flow':
      case 'end_other_flow':
        if (!cfg.flow_id || cfg.flow_id === options.flowId) add(node.id, 'Escolha outra automação.');
        break;
      case 'update_field': if (!cfg.field?.trim()) add(node.id, 'Escolha o campo a atualizar.'); break;
      case 'notify_user':
        if (!cfg.user_id) add(node.id, 'Escolha o destinatário da notificação.');
        if (!cfg.title?.trim()) add(node.id, 'Preencha o título da notificação.');
        break;
      case 'create_event':
        if (!cfg.user_id || !cfg.title?.trim() || !cfg.start_time?.trim()) add(node.id, 'Preencha responsável, título e início do evento.');
        if (cfg.start_time && !cfg.start_time.includes('{{')) {
          const start = Date.parse(cfg.start_time);
          const end = cfg.end_time && !cfg.end_time.includes('{{') ? Date.parse(cfg.end_time) : null;
          if (!Number.isFinite(start) || (end !== null && (!Number.isFinite(end) || end <= start))) add(node.id, 'Indique início e fim válidos para o evento.');
        }
        if (cfg.meeting_link && !cfg.meeting_link.includes('{{') && !/^https?:[/][/]/i.test(cfg.meeting_link)) add(node.id, 'A ligação da reunião deve começar por https:// ou http://.');
        break;
      case 'ai_draft':
      case 'ai_classify':
      case 'ai_summarize':
      case 'ai_extract':
        if (!cfg.text?.trim() || cfg.text.length > 12000) add(node.id, 'Preencha o texto que o Otto deve analisar, até 12000 caracteres.');
        if (node.type === 'ai_extract' && (!cfg.fields?.length || cfg.fields.length > 20
          || cfg.fields.some(field => !/^[a-z][a-z0-9_]{0,39}$/.test(field.name))
          || new Set(cfg.fields.map(field => field.name)).size !== cfg.fields.length)) add(node.id, 'Defina até 20 campos de extração com nomes únicos, começando por uma letra minúscula.');
        break;
      case 'move_stage': if (!cfg.stage) add(node.id, 'Escolha a etapa de destino.'); break;
      case 'assign_user':
        if ((!cfg.assignment_mode || cfg.assignment_mode === 'fixed') && !cfg.user_id) add(node.id, 'Escolha o responsável.');
        if ((cfg.assignment_mode === 'round_robin' || cfg.assignment_mode === 'least_loaded') && cfg.user_ids !== undefined
          && (!Array.isArray(cfg.user_ids) || cfg.user_ids.length === 0 || cfg.user_ids.some(user => typeof user !== 'string' || !user.trim()))) add(node.id, 'Selecione pelo menos um membro elegível para a distribuição.');
        break;
      case 'add_to_list':
      case 'remove_from_list': if (!cfg.list_id) add(node.id, 'Escolha a lista.'); break;
      case 'create_task':
        if (!cfg.title?.trim()) add(node.id, 'Preencha o título da tarefa.');
        if (cfg.priority !== undefined && !['low', 'normal', 'high'].includes(String(cfg.priority))) add(node.id, 'Escolha uma prioridade suportada para a tarefa.');
        break;
      case 'wait': {
        switch (cfg.wait_mode ?? 'duration') {
          case 'duration': {
            const amount = Number(cfg.amount ?? cfg.duration);
            if (!Number.isFinite(amount) || amount <= 0) add(node.id, 'A duração da espera deve ser superior a zero.');
            break;
          }
          case 'date':
            if (!cfg.date_field?.trim()) add(node.id, 'Escolha o campo de data da espera.');
            if (cfg.offset_days !== undefined && !integer(cfg.offset_days)) add(node.id, 'O desvio de dias deve ser inteiro.');
            if (cfg.at_time !== undefined && !validTime(cfg.at_time)) add(node.id, 'A hora da espera deve ter o formato HH:MM.');
            break;
          case 'business': {
            const start = cfg.business_start ?? '09:00';
            const end = cfg.business_end ?? '18:00';
            if (!validTime(start) || !validTime(end) || end <= start) add(node.id, 'Defina um horário útil válido, com fim depois do início.');
            break;
          }
          default: add(node.id, 'Escolha um modo de espera suportado.');
        }
        break;
      }
      case 'wait_until': {
        validateCondition(cfg, node.id);
        const timeout = Number(cfg.timeout_amount ?? 24);
        if (!Number.isFinite(timeout) || timeout <= 0) add(node.id, 'Defina um prazo válido para aguardar o acontecimento.');
        break;
      }
      case 'scheduled':
      case 'record_date': {
        if (!['lead', 'client', 'sale', 'proposal'].includes(String(cfg.entity ?? ''))) add(node.id, 'Escolha o tipo de registo da agenda.');
        if (node.type === 'record_date') {
          if (!cfg.date_field?.trim()) add(node.id, 'Escolha o campo de data do gatilho.');
          if (cfg.offset_days !== undefined && (!integer(cfg.offset_days) || Math.abs(cfg.offset_days) > 3660)) add(node.id, 'O desvio do gatilho deve ser inteiro, entre -3660 e 3660 dias.');
          if (!validTime(cfg.time ?? cfg.at_time ?? '09:00')) add(node.id, 'Defina uma hora válida para o gatilho.');
        } else {
          const schedule = cfg.schedule;
          if (typeof schedule !== 'object' || schedule === null || Array.isArray(schedule)) add(node.id, 'Configure a frequência e a hora da agenda.');
          else {
            if (!('frequency' in schedule) || !['daily', 'weekdays', 'weekly', 'monthly'].includes(String(schedule.frequency))) add(node.id, 'Escolha uma frequência suportada.');
            if (!('time' in schedule) || !validTime(schedule.time)) add(node.id, 'Defina uma hora válida para a agenda.');
            if ('frequency' in schedule && schedule.frequency === 'weekly'
              && (!('weekday' in schedule) || !integer(schedule.weekday) || Number(schedule.weekday) < 0 || Number(schedule.weekday) > 6)) add(node.id, 'Escolha um dia da semana para a agenda.');
            if ('frequency' in schedule && schedule.frequency === 'monthly'
              && (!('day' in schedule) || !integer(schedule.day) || Number(schedule.day) < 1 || Number(schedule.day) > 31)) add(node.id, 'Escolha um dia de 1 a 31 para a agenda mensal.');
          }
        }
        break;
      }
      case 'router': {
        const routes = cfg.routes;
        if (!Array.isArray(routes) || !routes.length) { add(node.id, 'Adicione pelo menos um caminho ao roteador.'); break; }
        const ids = new Set<string>();
        for (const route of routes) {
          if (typeof route !== 'object' || route === null) { add(node.id, 'Caminho inválido no roteador.'); continue; }
          if (!('id' in route) || typeof route.id !== 'string' || !route.id || route.id === 'fallback' || ids.has(route.id)) {
            add(node.id, 'Cada caminho precisa de um identificador único; Outros casos é reservado.');
          } else ids.add(route.id);
          if ('conditions' in route && Array.isArray(route.conditions)) {
            validateCondition({ conditions: route.conditions, match: 'match' in route && route.match === 'any' ? 'any' : 'all' }, node.id);
          } else add(node.id, 'Configure as condições de cada caminho.');
        }
        break;
      }
    }
    if (cfg.filters) validateCondition({ ...cfg.filters }, node.id);
    if (cfg.retry !== undefined) {
      const retry = cfg.retry;
      if (typeof retry !== 'object' || retry === null || Array.isArray(retry)
        || !('max_attempts' in retry) || !integer(retry.max_attempts) || Number(retry.max_attempts) < 1 || Number(retry.max_attempts) > 5
        || !('interval_minutes' in retry) || !integer(retry.interval_minutes) || Number(retry.interval_minutes) < 1 || Number(retry.interval_minutes) > 60) {
        add(node.id, 'Configure de 1 a 5 tentativas, com intervalo inteiro de 1 a 60 minutos.');
      }
    }
    const branches: string[] = [];
    if (cfg.on_error === 'error_branch') branches.push('error');
    if (node.type === 'ai_draft') branches.push('review');
    if (['ai_classify', 'ai_summarize', 'ai_extract'].includes(node.type)) branches.push('ready', 'review');
    if (node.type === 'split_ab') branches.push(...(cfg.variants ?? []).map(variant => variant.id));
    if (node.type === 'router') branches.push(...(cfg.routes ?? []).map(route => route.id), 'fallback');
    if (node.type === 'wait_until') branches.push('happened', 'timeout');
    if (node.type === 'condition') branches.push('yes', 'no');
    if (node.type === 'wait_reply' || (node.type === 'send_whatsapp' && cfg.wait_reply)) {
      branches.push(...(cfg.rules ?? []).map(rule => rule.id), 'fallback', 'timeout');
      const replyIds = (cfg.rules ?? []).map(rule => rule.id);
      if (replyIds.some(id => !id || ['fallback', 'timeout', 'error', 'default'].includes(id)) || new Set(replyIds).size !== replyIds.length) add(node.id, 'As opções de resposta precisam de identificadores únicos, diferentes dos caminhos reservados.');
      const timeout = Number(cfg.timeout_amount ?? cfg.timeout?.value ?? 24);
      if (!Number.isFinite(timeout) || timeout <= 0) add(node.id, 'Defina um prazo válido para aguardar resposta.');
    }
    for (const branch of branches) {
      if (!graph.edges.some(edge => edge.source === node.id && edge.branch === branch)) {
        const labels: Readonly<Record<string, string>> = { error: 'Erro', timeout: 'Prazo esgotado', happened: 'Aconteceu', yes: 'Sim', no: 'Não', fallback: 'Outros casos', ready: 'Pronto', review: 'Revisão' };
        const label = labels[branch] ?? cfg.routes?.find(route => route.id === branch)?.label ?? cfg.variants?.find(variant => variant.id === branch)?.label ?? cfg.rules?.find(rule => rule.id === branch)?.label ?? branch;
        add(node.id, `O ramo ${label} não tem destino; o percurso termina aqui.`, 'warning');
      }
    }
  }
  const goal = options.triggerConfig?.goal;
  if (goal !== undefined && goal !== null) {
    const validateGoal = (value: unknown, depth = 0): void => {
      if (depth > 8 || !value || typeof value !== 'object' || Array.isArray(value)) {
        add(null, 'O objetivo de saída tem uma condição inválida.'); return;
      }
      if ('conditions' in value) {
        if (!Array.isArray(value.conditions) || !value.conditions.length || !('match' in value) || (value.match !== 'all' && value.match !== 'any')) {
          add(null, 'Defina Todas ou Qualquer e pelo menos uma condição no objetivo.'); return;
        }
        for (const rule of value.conditions) validateGoal(rule, depth + 1);
      } else {
        if (!('field' in value) || typeof value.field !== 'string' || !value.field.trim()) add(null, 'Escolha o campo do objetivo de saída.');
        const operator = 'operator' in value && typeof value.operator === 'string' ? value.operator : 'equals';
        const issue = conditionValueIssue(operator, 'value' in value ? value.value : undefined);
        if (issue) add(null, 'Objetivo de saída: ' + issue);
      }
    };
    validateGoal(goal);
  }
  const required = options.triggerConfig?.recipe_required_fields;
  if (Array.isArray(required)) for (const requirement of required) {
    if (typeof requirement !== 'object' || requirement === null || typeof requirement.node_id !== 'string' || typeof requirement.field !== 'string') continue;
    const node = graph.nodes.find(item => item.id === requirement.node_id);
    const value = node?.config[requirement.field];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      issues.push({ nodeId: node?.id ?? null, severity: 'error', message: typeof requirement.label === 'string' ? requirement.label : 'Preencha a escolha obrigatória deste modelo.' });
    }
  }
  return [...issues, ...validateAdditionalActions(graph, options), ...validateAutomationVariableTemplates(graph, options.availableVariables)];
}
