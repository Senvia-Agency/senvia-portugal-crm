import { useEmailTemplates } from '@/hooks/useEmailTemplates';

export function useEmailTemplateRequirement(triggerType: string) {
  const { data: templates, isLoading } = useEmailTemplates();
  const template = (templates || []).find(
    (item) => item.is_active && item.automation_trigger_type === triggerType,
  ) || null;
  return {
    isLoading,
    isConfigured: !!template,
    template,
  };
}
