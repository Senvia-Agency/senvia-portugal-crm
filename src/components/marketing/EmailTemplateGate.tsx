import { cloneElement, type ReactElement } from 'react';
import { MessageCircleMore } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { EMAIL_TEMPLATE_TRIGGER_LABELS } from '@/lib/email-template-triggers';
import { useEmailTemplateRequirement } from '@/hooks/useEmailTemplateRequirement';

interface EmailTemplateGateProps {
  triggerType: string;
  children: ReactElement<{ disabled?: boolean; className?: string }>;
  className?: string;
  message?: string;
  noticePosition?: 'overlay' | 'inline';
}

export function EmailTemplateGate({ triggerType, children, className, message, noticePosition = 'overlay' }: EmailTemplateGateProps) {
  const { isConfigured, isLoading } = useEmailTemplateRequirement(triggerType);
  const blocked = isLoading || !isConfigured;
  const triggerLabel = EMAIL_TEMPLATE_TRIGGER_LABELS[triggerType] || 'este tipo de envio';
  const notice = message || `Configure um template de email ativo com o gatilho «${triggerLabel}» em Marketing → Templates antes de enviar.`;

  return (
    <div className={cn('flex items-center gap-1', noticePosition === 'overlay' && 'relative', className)}>
      {cloneElement(children, {
        disabled: Boolean(children.props.disabled) || blocked,
        className: cn(children.props.className, !isConfigured && !isLoading && noticePosition === 'overlay' && 'pr-9'),
      })}
      {!isLoading && !isConfigured && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={notice}
                className={cn(
                  'shrink-0 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  noticePosition === 'overlay' && 'absolute right-2 top-1/2 -translate-y-1/2',
                )}
              >
                <MessageCircleMore className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">{notice}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
