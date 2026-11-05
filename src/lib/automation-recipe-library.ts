import type { AutomationGraphNode, AutomationNodeConfig, AutomationNodeType, AutomationTriggerType } from '@/types/automations';
import type { AutomationRecipe } from './automation-recipes';

export const RECIPE_OBJECTIVES = [
  { key: 'respond', label: 'Responder rápido' }, { key: 'qualify', label: 'Qualificar' },
  { key: 'nurture', label: 'Nutrir' }, { key: 'proposals', label: 'Propostas' },
  { key: 'collect', label: 'Cobrar' }, { key: 'onboarding', label: 'Pós-venda' },
  { key: 'calendar', label: 'Agenda' }, { key: 'team', label: 'Equipa' },
] as const;
export type RecipeObjective = typeof RECIPE_OBJECTIVES[number]['key'];
type Step = readonly [id: string, type: AutomationNodeType, config: AutomationNodeConfig];
type Link = readonly [source: string, target: string, branch?: string];
interface RecipeInput {
  readonly id: string; readonly name: string; readonly summary: string; readonly objective: RecipeObjective;
  readonly trigger: AutomationTriggerType; readonly config?: AutomationNodeConfig;
  readonly steps: readonly Step[]; readonly links?: readonly Link[]; readonly configure: readonly string[];
}
function recipe(input: RecipeInput): AutomationRecipe {
  const requiredFields = input.steps
    .filter(([,type,config]) => type === 'assign_user' && Array.isArray(config.user_ids) && config.user_ids.length === 0)
    .map(([node_id]) => ({ node_id, field: 'user_ids', label: 'Escolha os comerciais que participam na distribuição.' }));
  if (input.trigger === 'scheduled') requiredFields.push({ node_id: 'trigger', field: 'filters', label: 'Defina o segmento de leads a inscrever.' });
  const triggerConfig: AutomationNodeConfig = requiredFields.length
    ? { ...input.config, recipe_required_fields: requiredFields } : input.config ?? {};
  const nodes: AutomationGraphNode[] = [
    { id: 'trigger', type: input.trigger, config: triggerConfig, position: { x: 0, y: 0 } },
    ...input.steps.map(([id, type, config]) => ({ id, type, config, position: { x: 0, y: 0 } })),
  ];
  const links = input.links ?? nodes.slice(1).map((node, index): Link => [nodes[index].id, node.id]);
  return {
    id: input.id, name: input.name, summary: input.summary, objective: input.objective,
    editHint: input.configure.join(' · '), configuration: [...input.configure], trigger_type: input.trigger,
    trigger_config: triggerConfig, entry_node_id: 'trigger',
    outline: input.steps.map(([,type]) => ({ send_email: 'Email', send_whatsapp: 'WhatsApp', wait: 'Esperar', create_task: 'Tarefa', assign_user: 'Responsável', router: 'Escolher caminho', wait_until: 'Aguardar condição' })[type] ?? 'Ação'),
    graph: { nodes, edges: links.map(([source, target, branch], index) => ({ id: `e${index + 1}`, source, target, branch: branch ?? null })) },
  };
}
const task = (title: string, hours = 1): AutomationNodeConfig => ({ title, due_amount: hours, due_unit: 'hours' });
const email = (subject: string, text: string): AutomationNodeConfig => ({ subject, html: `<p>Olá {{nome}},</p><p>${text}</p>` });
const statusRule = (value: string): AutomationNodeConfig => ({ field: 'status', operator: 'equals', value });

export const EXTENDED_AUTOMATION_RECIPES: AutomationRecipe[] = [
  recipe({ id:'aguardar-proposta-aceite',name:'Aguardar decisão da proposta',objective:'proposals',trigger:'proposal_created',
    summary:'Aguarda a aceitação por até sete dias e cria a próxima ação conforme a decisão.',configure:['Confirme o campo e o valor que indicam aceitação','Escolha os responsáveis das tarefas','Reveja o prazo de sete dias'],
    steps:[['decision','wait_until',{match:'all',conditions:[statusRule('accepted')],timeout_amount:7,timeout_unit:'days'}],['accepted','create_task',task('Preparar proposta aceite de {{nome}}',4)],['followup','create_task',task('Confirmar decisão da proposta de {{nome}}',24)]],
    links:[['trigger','decision'],['decision','accepted','happened'],['decision','followup','timeout']],
  }),
  recipe({ id: 'lead-rota-primeiro-contacto', name: 'Distribuir e contactar uma lead', objective: 'respond', trigger: 'lead_created',
    summary: 'Distribui a lead pela equipa, responde e cria a próxima ação em 30 minutos.', configure: ['Escolha os comerciais da rotação', 'Reveja a mensagem e a caixa WhatsApp'],
    steps: [['assign', 'assign_user', { assignment_mode: 'round_robin', user_ids: [] }], ['message', 'send_whatsapp', { message: 'Olá {{nome}}, recebemos o seu pedido. Vamos ajudá-lo a encontrar a melhor solução.' }], ['task', 'create_task', { title: 'Contactar {{nome}}', due_amount: 30, due_unit: 'minutes' }]],
  }),
  recipe({ id: 'qualificar-temperatura', name: 'Encaminhar pela temperatura', objective: 'qualify', trigger: 'lead_created',
    summary: 'Cria uma tarefa urgente para leads quentes e encaminha os restantes para revisão.', configure: ['Escolha os responsáveis das tarefas', 'Confirme os valores de temperatura usados no CRM'],
    steps: [['route', 'router', { routes: [{ id: 'hot', label: 'Quente', match: 'all', conditions: [{ field: 'temperature', operator: 'equals', value: 'hot' }] }] }], ['urgent', 'create_task', { title: 'Ligar à lead quente {{nome}}', due_amount: 15, due_unit: 'minutes' }], ['review', 'create_task', task('Rever necessidade de {{nome}}', 24)]],
    links: [['trigger','route'],['route','urgent','hot'],['route','review','fallback']],
  }),
  recipe({ id: 'cliente-existente-atendimento', name: 'Reconhecer um cliente existente', objective: 'qualify', trigger: 'message_received',
    summary: 'Consulta o telefone no CRM e separa atendimento de clientes de novas oportunidades.', configure: ['Escolha a caixa de entrada', 'Escolha os responsáveis pelo atendimento e pelas leads'],
    steps: [['lookup','condition',{field:'telefone',operator:'in_clients'}],['client','create_task',task('Atender cliente {{nome}}')],['lead','create_task',task('Qualificar novo contacto {{nome}}')]],
    links: [['trigger','lookup'],['lookup','client','yes'],['lookup','lead','no']],
  }),
  recipe({ id: 'nutricao-tres-emails', name: 'Nutrição em três emails', objective: 'nurture', trigger: 'list_joined',
    summary: 'Apresenta a solução, partilha um exemplo e oferece uma conversa em três contactos espaçados.', configure: ['Escolha a lista de entrada', 'Reveja os três emails', 'Defina um objetivo de saída nas definições'],
    steps: [['business','wait',{wait_mode:'business',business_start:'09:00',business_end:'18:00'}],['one','send_email',email('Como podemos ajudar','Obrigado pelo seu interesse. Conte-nos o que precisa de resolver.')],['w1','wait',{amount:3,unit:'days'}],['two','send_email',email('Uma solução para a sua necessidade','Podemos mostrar um exemplo ajustado à sua necessidade. Responda para saber mais.')],['w2','wait',{amount:4,unit:'days'}],['three','send_email',email('Faz sentido conversarmos?','Se quiser avançar, responda a este email e combinamos o próximo passo.')]],
  }),
  recipe({ id: 'reactivacao-por-segmento', name: 'Reativar um segmento de leads', objective: 'nurture', trigger: 'scheduled', config: { entity:'lead', schedule:{frequency:'weekdays',time:'09:00'} },
    summary: 'Inscreve um segmento definido por si e cria uma tarefa de revisão antes do contacto.', configure: ['Defina o filtro de entrada para evitar contactar todas as leads', 'Escolha o responsável', 'Reveja a política de reentrada'],
    steps: [['task','create_task',task('Rever reativação de {{nome}}',24)]],
  }),
  recipe({ id: 'proposta-seguimento', name: 'Acompanhar uma proposta enviada', objective: 'proposals', trigger: 'proposal_status_changed', config:{to_stage:'sent'},
    summary: 'Aguarda dois dias e prepara um contacto humano se a proposta continuar enviada.', configure: ['Confirme o estado que significa enviada', 'Escolha o responsável', 'Configure saída quando a proposta for aceite ou recusada'],
    steps: [['wait','wait',{amount:2,unit:'days'}],['still','condition',statusRule('sent')],['email','send_email',email('Podemos esclarecer a sua proposta?','Teve oportunidade de rever a proposta? Estamos disponíveis para esclarecer qualquer questão.')],['task','create_task',task('Acompanhar proposta de {{nome}}',24)],['done','end',{}]],
    links:[['trigger','wait'],['wait','still'],['still','email','yes'],['still','done','no'],['email','task']],
  }),
  recipe({ id:'proposta-aceite-equipa',name:'Passar uma proposta aceite à equipa',objective:'proposals',trigger:'proposal_status_changed',config:{to_stage:'accepted'},
    summary:'Cria a ação de passagem à operação assim que a proposta é aceite.',configure:['Confirme o estado que significa aceite','Escolha o responsável operacional'],
    steps:[['task','create_task',task('Preparar execução da proposta aceite de {{nome}}',4)]],
  }),
  recipe({ id:'cobranca-escalada',name:'Cobrança em atraso com acompanhamento',objective:'collect',trigger:'sale_renewal_overdue',
    summary:'Envia um lembrete e cria uma tarefa de apoio após três dias.',configure:['Reveja o email e os dados de pagamento','Escolha o responsável financeiro','Confirme a regra de saída quando a cobrança é paga'],
    steps:[['email','send_email',email('Podemos ajudar com o pagamento?','A sua mensalidade continua por regularizar. Se precisar de ajuda, responda-nos.')],['wait','wait',{amount:3,unit:'days'}],['task','create_task',task('Confirmar pagamento e apoiar {{nome}}',24)]],
  }),
  recipe({ id:'venda-onboarding',name:'Venda ativa → onboarding',objective:'onboarding',trigger:'sale_created',
    summary:'Dá as boas-vindas ao cliente e cria uma tarefa para preparar os primeiros passos.',configure:['Defina no filtro os estados de venda elegíveis','Escolha o responsável pelo onboarding','Reveja o email'],
    steps:[['email','send_email',email('Bem-vindo!','Obrigado pela sua confiança. A nossa equipa irá acompanhá-lo nos primeiros passos.')],['task','create_task',task('Preparar onboarding de {{nome}}',48)]],
  }),
  recipe({ id:'avaliacao-pos-venda',name:'Avaliação após a venda',objective:'onboarding',trigger:'sale_created',
    summary:'Após duas semanas, pede avaliação e encaminha pedidos de apoio para uma tarefa.',configure:['Confirme as vendas elegíveis no filtro','Escolha a caixa WhatsApp','Escolha o responsável pelo apoio'],
    steps:[['wait','wait',{amount:14,unit:'days'}],['ask','send_whatsapp',{message:'Olá {{nome}}, como estão a correr os primeiros dias? Precisa de ajuda?',wait_reply:true,rules:[{id:'help',label:'Preciso de ajuda',keywords:['ajuda','problema','apoio']}],timeout_amount:3,timeout_unit:'days'}],['task','create_task',task('Apoiar cliente {{nome}}',24)],['done','end',{}]],
    links:[['trigger','wait'],['wait','ask'],['ask','task','help'],['ask','done','timeout']],
  }),
  recipe({ id:'reuniao-preparacao',name:'Preparar uma reunião marcada',objective:'calendar',trigger:'meeting_created',
    summary:'Cria a preparação da reunião com o contexto do cliente associado.',configure:['Escolha o responsável pela preparação','Reveja o prazo da tarefa'],
    steps:[['task','create_task',task('Preparar reunião com {{nome}}',2)]],
  }),
  recipe({ id:'tarefa-concluida-proxima-acao',name:'Tarefa concluída → próxima ação',objective:'team',trigger:'task_completed',
    summary:'Após concluir uma tarefa, aguarda o próximo horário útil e cria uma revisão do próximo passo.',configure:['Defina o filtro para os tipos de tarefa relevantes','Escolha o responsável pela revisão'],
    steps:[['business','wait',{wait_mode:'business'}],['task','create_task',task('Rever próximo passo com {{nome}}',24)]],
  }),
];

export function recipeObjective(recipe: AutomationRecipe): RecipeObjective {
  if (recipe.objective) return recipe.objective;
  if (recipe.id.startsWith('cobranca') || recipe.id === 'lembrete-renovacao') return 'collect';
  if (recipe.id === 'lead-ganho-onboarding') return 'onboarding';
  if (recipe.id === 'qualificar-conversa') return 'qualify';
  if (recipe.id === 'recuperar-lead-frio') return 'nurture';
  return 'respond';
}
