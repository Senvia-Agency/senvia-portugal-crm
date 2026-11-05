import { NODE_DEFINITIONS } from './automation-nodes';
import type { AutomationActionType, AutomationNodeConfig, AutomationTriggerType } from '@/types/automations';
import type { AutomationRecipe } from './automation-recipes';

export interface AutomationStarterSelection {
  readonly trigger: AutomationTriggerType;
  readonly audience: 'all' | 'filtered';
  readonly field: string;
  readonly value: string;
  readonly action: AutomationActionType;
}
export class InvalidStarterSelection extends Error {}

export function buildStarterRecipe(selection: AutomationStarterSelection): AutomationRecipe {
  const trigger = NODE_DEFINITIONS[selection.trigger];
  const action = NODE_DEFINITIONS[selection.action];
  if (!trigger.isTrigger || action.isTrigger) throw new InvalidStarterSelection('Escolha um gatilho e uma ação.');
  if (selection.audience === 'filtered' && (!selection.field.trim() || !selection.value.trim())) {
    throw new InvalidStarterSelection('Preencha o campo e o valor do segmento.');
  }
  const triggerConfig: AutomationNodeConfig = structuredClone(trigger.defaultConfig);
  if (selection.audience === 'filtered') triggerConfig.filters = {
    match: 'all', conditions: [{ field: selection.field.trim(), operator: 'equals', value: selection.value.trim() }],
  };
  return {
    id: 'guided-draft', name: `${trigger.label} → ${action.label}`,
    summary: 'Rascunho criado com o assistente.', editHint: 'Configure o gatilho e o primeiro passo antes de ativar.',
    configuration: ['Confirme os dados do gatilho', `Configure: ${action.label}`],
    trigger_type: selection.trigger, trigger_config: triggerConfig, entry_node_id: 'trigger',
    outline: [trigger.label, action.label],
    graph: {
      nodes: [
        { id: 'trigger', type: selection.trigger, config: triggerConfig, position: { x: 0, y: 0 } },
        { id: 'first', type: selection.action, config: structuredClone(action.defaultConfig), position: { x: 0, y: 0 } },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'first', branch: null }],
    },
  };
}
