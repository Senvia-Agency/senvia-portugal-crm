import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, MessagesSquare, Loader2, Check, Target } from "lucide-react";
import { useCreateForm } from '@/hooks/useForms';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useAuth } from '@/contexts/AuthContext';
import { FormMode, DEFAULT_FORM_SETTINGS } from '@/types';
import { PRODUCTION_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';

interface CreateFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateFormModal({ open, onOpenChange }: CreateFormModalProps) {
  const { organization } = useAuth();
  const createForm = useCreateForm();
  const { data: stages = [] } = usePipelineStages();
  const { t } = useLanguage();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [mode, setMode] = useState<FormMode>('traditional');
  const [targetStage, setTargetStage] = useState<string | null>(null);

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slug || slug === generateSlug(name)) {
      setSlug(generateSlug(value));
    }
  };

  const handleCreate = () => {
    if (!name.trim() || !slug.trim()) return;

    const formSettings = {
      ...DEFAULT_FORM_SETTINGS,
      mode,
      fields: {
        name: { visible: true, required: true, label: 'Nome Completo' },
        email: { visible: true, required: true, label: 'Email' },
        phone: { visible: true, required: true, label: 'Telemóvel' },
        message: { visible: false, required: false, label: 'Mensagem' },
      },
    };

    createForm.mutate(
      { 
        name: name.trim(), 
        slug: slug.trim(), 
        form_settings: formSettings,
        target_stage: targetStage,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setName('');
          setSlug('');
          setMode('traditional');
          setTargetStage(null);
        },
      }
    );
  };

  const previewUrl = organization?.slug
    ? `${PRODUCTION_URL}${mode === 'conversational' ? '/c/' : '/f/'}${organization.slug}/${slug || 'slug'}`
    : '';

  const isValid = name.trim().length > 0 && slug.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('Novo Formulário')}</DialogTitle>
          <DialogDescription>
            {t('Crie um formulário para uma campanha ou serviço específico.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="form-name">{t('Nome do Formulário')}</Label>
            <Input
              id="form-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('ex: Campanha Facebook Março')}
              maxLength={100}
            />
          </div>

          {/* Slug */}
          <div className="space-y-2">
            <Label htmlFor="form-slug">{t('Slug (URL)')}</Label>
            <Input
              id="form-slug"
              value={slug}
              onChange={(e) => setSlug(generateSlug(e.target.value))}
              placeholder={t('ex: campanha-fb-marco')}
              maxLength={50}
            />
            <p className="text-xs text-muted-foreground truncate">
              {previewUrl}
            </p>
          </div>

          {/* Mode Selection */}
          <div className="space-y-2">
            <Label>{t('Tipo de Formulário')}</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode('traditional')}
                className={cn(
                  "relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                  mode === 'traditional'
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg",
                  mode === 'traditional' ? "bg-primary/10" : "bg-muted"
                )}>
                  <FileText className={cn(
                    "h-5 w-5",
                    mode === 'traditional' ? "text-primary" : "text-muted-foreground"
                  )} />
                </div>
                <span className={cn(
                  "font-medium text-sm",
                  mode === 'traditional' ? "text-primary" : "text-foreground"
                )}>{t('Tradicional')}</span>
                {mode === 'traditional' && (
                  <div className="absolute top-2 right-2">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                )}
              </button>

              <button
                type="button"
                onClick={() => setMode('conversational')}
                className={cn(
                  "relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                  mode === 'conversational'
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg",
                  mode === 'conversational' ? "bg-primary/10" : "bg-muted"
                )}>
                  <MessagesSquare className={cn(
                    "h-5 w-5",
                    mode === 'conversational' ? "text-primary" : "text-muted-foreground"
                  )} />
                </div>
                <span className={cn(
                  "font-medium text-sm",
                  mode === 'conversational' ? "text-primary" : "text-foreground"
                )}>{t('Conversacional')}</span>
                {mode === 'conversational' && (
                  <div className="absolute top-2 right-2">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* Target Stage */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
              {t('Etapa Inicial do Lead')}
            </Label>
            <Select
              value={targetStage || 'default'}
              onValueChange={(v) => setTargetStage(v === 'default' ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('Primeira etapa (predefinida)')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t('Primeira etapa (predefinida)')}</SelectItem>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.key}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('Os leads deste formulário entrarão diretamente nesta etapa do pipeline.')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancelar')}
          </Button>
          <Button 
            onClick={handleCreate} 
            disabled={!isValid || createForm.isPending}
          >
            {createForm.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t('A criar...')}
              </>
            ) : (
              t('Criar Formulário')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
