import { useState, useEffect, useRef, useMemo } from 'react';
import { detectLeadSource } from '@/lib/source-detection';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PhoneInput } from '@/components/ui/phone-input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle, AlertCircle, Zap } from 'lucide-react';
import { FormSettings, DEFAULT_FORM_SETTINGS, CustomField, migrateFormSettings, MetaPixel } from '@/types';
import { normalizeEmail, normalizeInternationalPhone } from '@/lib/validation/contact';
import { readableTextColor } from '@/lib/color';
import { useAntiBot, CampoArmadilha } from '@/components/forms/AntiBot';

// Declare fbq for TypeScript
declare global {
  interface Window {
    fbq: (...args: unknown[]) => void;
    _fbq: unknown;
    __senvia_pixel_init?: Record<string, boolean>; // Global guard to prevent double init
    __senvia_fbq_wrapped?: boolean; // Guard to prevent double wrapping
    __senvia_allow_lead?: boolean; // Flag to allow Lead events only when explicitly set
    __senvia_original_fbq?: (...args: unknown[]) => void; // Original fbq function
  }
}

// Install fbq firewall to block unauthorized Lead events
const installFbqFirewall = () => {
  if (window.__senvia_fbq_wrapped) return;
  
  const checkAndWrap = () => {
    if (typeof window.fbq !== 'function') return;
    if (window.__senvia_fbq_wrapped) return;
    
    // Store original fbq
    const originalFbq = window.fbq;
    window.__senvia_original_fbq = originalFbq;
    
    // Create wrapper that blocks unauthorized Lead events
    const wrappedFbq = (...args: unknown[]) => {
      const command = args[0] as string;
      const eventName = command === 'trackSingle' ? args[2] as string : args[1] as string;
      
      // Check if this is a Lead event
      if ((command === 'track' || command === 'trackSingle' || command === 'trackCustom') && 
          eventName === 'Lead') {
        // Only allow if our flag is set
        if (!window.__senvia_allow_lead) {
          console.warn('[Meta Pixel] BLOCKED unauthorized Lead event. Stack trace:', new Error().stack);
          return;
        }
        console.log('[Meta Pixel] Lead event ALLOWED (authorized)');
      }
      
      // Call original fbq
      return originalFbq.apply(window, args);
    };
    
    // Copy all properties from original fbq
    Object.assign(wrappedFbq, originalFbq);
    
    // Replace global fbq
    window.fbq = wrappedFbq;
    window.__senvia_fbq_wrapped = true;
    console.log('[Meta Pixel] Firewall installed - unauthorized Lead events will be blocked');
  };
  
  // Try immediately
  checkAndWrap();
  
  // Also try after a delay (in case fbq loads later)
  setTimeout(checkAndWrap, 100);
  setTimeout(checkAndWrap, 500);
  setTimeout(checkAndWrap, 1000);
};

// Install firewall immediately on module load
if (typeof window !== 'undefined') {
  installFbqFirewall();
}

interface FormDataResult {
  form_id: string;
  form_name: string;
  form_settings: FormSettings;
  org_id: string;
  org_name: string;
  org_slug: string;
  meta_pixels: MetaPixel[];
  public_key?: string;
}

export default function PublicLeadForm() {
  const { slug, formSlug } = useParams<{ slug: string; formSlug?: string }>();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState<FormDataResult | null>(null);
  const [settings, setSettings] = useState<FormSettings>(DEFAULT_FORM_SETTINGS);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Armadilha para robôs: um campo que não se vê e o tempo que demorou a
  // preencher. Não custa um clique a quem preenche a sério.
  const antiBot = useAntiBot();
  const [isSuccess, setIsSuccess] = useState(false);
  
  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [gdprConsent, setGdprConsent] = useState(false);
  const [customData, setCustomData] = useState<Record<string, string | number | boolean>>({});

  // Intelligent source detection with fallbacks
  const sourceDetection = useMemo(() => detectLeadSource(), []);
  const detectedSource = sourceDetection.source;

  // Validate slug on mount and fetch form
  useEffect(() => {
    async function fetchForm() {
      if (!slug) {
        setIsValidating(false);
        setIsValid(false);
        return;
      }

      try {
        // Fetch form by slugs using new RPC function
        const { data, error } = await supabase
          .rpc('get_form_by_slugs', { 
            _org_slug: slug,
            _form_slug: formSlug || null  // null = default form
          });

        if (error || !data || data.length === 0) {
          setIsValid(false);
        } else {
          const formResult = data[0];
          const migratedSettings = migrateFormSettings(formResult.form_settings || {});

          setFormData({
            form_id: formResult.form_id,
            form_name: formResult.form_name,
            form_settings: migratedSettings,
            org_id: formResult.org_id,
            org_name: formResult.org_name,
            org_slug: formResult.org_slug,
            meta_pixels: Array.isArray(formResult.meta_pixels) ? formResult.meta_pixels as unknown as MetaPixel[] : [],
            public_key: formResult.public_key,
          });
          setSettings(migratedSettings);
          setIsValid(true);
        }
      } catch {
        setIsValid(false);
      } finally {
        setIsValidating(false);
      }
    }

    fetchForm();
  }, [slug, formSlug]);

  // Notify parent iframe of height changes for auto-resize
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    const sendHeight = () => {
      window.parent.postMessage({ type: 'senvia-resize', height: document.body.scrollHeight }, '*');
    };
    sendHeight();
    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [isSuccess, isValidating]);

  // Inject Meta Pixels. Duplicate init (React StrictMode remounts) is stopped by
  // the per-page window.__senvia_pixel_init guard below. It used to be a
  // sessionStorage flag, which outlives a reload while fbq does not: every
  // reload in the same tab skipped the init, and the form's pixel never fired.
  useEffect(() => {
    if (!formData?.meta_pixels || !formData?.form_id) return;

    const activePixels = formData.meta_pixels.filter(p => p.enabled && p.pixel_id);
    if (activePixels.length === 0) {
      console.log('[Meta Pixel] No active pixels configured');
      return;
    }

    console.log('[Meta Pixel] Initializing pixels:', activePixels.map(p => p.pixel_id));

    // Inject the base Facebook Pixel code (only once)
    if (!window.fbq) {
      const baseScript = document.createElement('script');
      baseScript.innerHTML = `
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
      `;
      document.head.appendChild(baseScript);
    }

    // Wait for fbq to be available, then initialize
    const initPixels = () => {
      // Initialize global guard
      if (!window.__senvia_pixel_init) {
        window.__senvia_pixel_init = {};
      }

      activePixels.forEach(pixel => {
        if (typeof window.fbq === 'function') {
          // Check global guard to prevent duplicate init on same page
          if (window.__senvia_pixel_init![pixel.pixel_id]) {
            console.log('[Meta Pixel] Already initialized globally, skipping:', pixel.pixel_id);
            return;
          }
          window.__senvia_pixel_init![pixel.pixel_id] = true;

          // CRITICAL: Disable automatic event detection BEFORE init
          window.fbq('set', 'autoConfig', false, pixel.pixel_id);
          
          window.fbq('init', pixel.pixel_id, {
            external_id: sourceDetection.tracking.external_id,
          });
          window.fbq('trackSingle', pixel.pixel_id, 'PageView');
          console.log('[Meta Pixel] PageView tracked for:', pixel.pixel_id, '(autoConfig disabled)');
        }
      });
    };

    // Try immediately, then with delay if not ready
    if (typeof window.fbq === 'function') {
      initPixels();
    } else {
      setTimeout(initPixels, 500);
    }
    // Removed noscript fallback - unnecessary for SPAs and can cause duplicate events
  }, [formData?.meta_pixels, formData?.form_id]);

  // Ref to prevent duplicate tracking within same component lifecycle (React StrictMode)
  const hasTrackedLeadRef = useRef(false);

  // Function to track Lead event - ONLY call after confirmed success with lead_id
  const trackLeadEvent = (leadId: string) => {
    // Triple protection: ref (lifecycle) + sessionStorage (session) + eventID (Facebook dedup)
    if (hasTrackedLeadRef.current) {
      console.log('[Meta Pixel] Lead event already tracked (ref guard), skipping');
      return;
    }

    if (!formData?.meta_pixels || !formData?.form_id) {
      console.log('[Meta Pixel] No pixels or form_id to track Lead event');
      return;
    }

    // Use unique key per lead to allow multiple leads per session (different form submissions)
    const leadStorageKey = `pixel_lead_${formData.form_id}_${leadId}`;
    if (sessionStorage.getItem(leadStorageKey)) {
      console.log('[Meta Pixel] Lead event already tracked in sessionStorage, skipping:', leadId);
      return;
    }
    
    const activePixels = formData.meta_pixels.filter(p => p.enabled && p.pixel_id);
    
    if (typeof window.fbq !== 'function') {
      console.warn('[Meta Pixel] fbq not loaded, cannot track Lead event');
      return;
    }

    // Mark as tracked BEFORE sending to prevent race conditions
    hasTrackedLeadRef.current = true;
    sessionStorage.setItem(leadStorageKey, 'true');

    const externalId = sourceDetection.tracking.external_id || leadId;

    console.log('[Meta Pixel] Tracking Lead event for lead:', leadId, 'pixels:', activePixels.length, 'external_id:', externalId);
    
    // CRITICAL: Enable the firewall flag to allow our Lead event
    try {
      window.__senvia_allow_lead = true;
      
      // Use fbq('track') with eventID for Facebook's automatic server-side deduplication
      activePixels.forEach((pixel) => {
        window.fbq('init', pixel.pixel_id, {
          external_id: externalId,
        });
        window.fbq('trackSingle', pixel.pixel_id, 'Lead', {
          content_name: formData.org_name,
          content_category: 'form_submission',
        }, { eventID: leadId });
        console.log('[Meta Pixel] Lead event sent for pixel:', pixel.pixel_id, 'eventID:', leadId);
      });
    } finally {
      // Always reset the flag after sending
      window.__senvia_allow_lead = false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Dynamic validation based on field settings.
    // Phone and email are also validated when filled but optional — bots that
    // type "999999999" into an optional field still get rejected, matching
    // the Edge Function behavior.
    if (settings.fields.name.visible && settings.fields.name.required) {
      if (!name || name.length < 2) {
        toast({ title: 'Erro', description: `${settings.fields.name.label} deve ter pelo menos 2 caracteres`, variant: 'destructive' });
        return;
      }
    }

    let normalizedPhone = '';
    if (settings.fields.phone.visible) {
      const required = settings.fields.phone.required;
      const hasValue = phone && phone.trim().length > 0;
      if (required || hasValue) {
        const r = normalizeInternationalPhone(phone);
        if (!r.ok) {
          toast({ title: 'Telefone inválido', description: r.reason, variant: 'destructive' });
          return;
        }
        // Keep the full international number WITH country code (+351..., +55..., ...).
        normalizedPhone = r.value;
      }
    }

    let normalizedEmail = '';
    if (settings.fields.email.visible) {
      const required = settings.fields.email.required;
      const hasValue = email && email.trim().length > 0;
      if (required || hasValue) {
        const r = normalizeEmail(email);
        if (!r.ok) {
          toast({ title: 'Email inválido', description: r.reason, variant: 'destructive' });
          return;
        }
        normalizedEmail = r.value;
      }
    }
    
    if (settings.fields.message.visible && settings.fields.message.required) {
      if (!message || message.trim().length < 1) {
        toast({ title: 'Erro', description: `${settings.fields.message.label} é obrigatório`, variant: 'destructive' });
        return;
      }
    }
    
    if (!gdprConsent) {
      toast({ title: 'Erro', description: 'É necessário aceitar a Política de Privacidade', variant: 'destructive' });
      return;
    }

    // Validate required custom fields
    const sortedFields = [...(settings.custom_fields || [])].sort((a, b) => a.order - b.order);
    for (const field of sortedFields) {
      if (field.required && !customData[field.id]) {
        toast({ title: 'Erro', description: `O campo "${field.label}" é obrigatório`, variant: 'destructive' });
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        name: name.trim() || null,
        email: normalizedEmail || null,
        phone: normalizedPhone || null,
        gdpr_consent: true,
        ...antiBot.campos(),
        public_key: formData?.public_key,
        form_id: formData?.form_id,  // Include form_id for form-specific settings
        source: detectedSource,
        custom_data: {
          ...customData,
          ...sourceDetection.tracking,
        },
      };

      if (settings.fields.message.visible && message.trim()) {
        body.notes = message;
      }

      const response = await supabase.functions.invoke('submit-lead', { body });

      if (response.error) {
        throw new Error(response.error.message || 'Erro ao enviar');
      }

      // Check if backend marked this as a duplicate - do NOT track pixel for duplicates
      if (response.data?.duplicate === true) {
        console.log('[Meta Pixel] Backend marked as duplicate, NOT tracking Lead event');
        setIsSuccess(true);
        return;
      }

      // Only track Lead event AFTER confirmed success AND if we have a lead_id
      if (response.data?.lead_id) {
        console.log('[Meta Pixel] Lead submitted successfully, tracking event with lead_id:', response.data.lead_id);
        trackLeadEvent(response.data.lead_id);
      } else {
        console.warn('[Meta Pixel] No lead_id returned, cannot track with eventID');
      }

      setIsSuccess(true);
    } catch (error) {
      console.error('Error submitting lead:', error);
      // Do NOT track pixel on error
      toast({
        title: 'Erro',
        description: settings.error_message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateCustomField = (fieldId: string, value: string | number | boolean) => {
    setCustomData(prev => ({ ...prev, [fieldId]: value }));
  };

  const renderCustomField = (field: CustomField) => {
    switch (field.type) {
      case 'text':
      case 'number':
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.id}>{field.label} {field.required && '*'}</Label>
            <Input
              id={field.id}
              type={field.type}
              placeholder={field.placeholder}
              value={customData[field.id] as string || ''}
              onChange={(e) => updateCustomField(field.id, e.target.value)}
            />
          </div>
        );
      case 'textarea':
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.id}>{field.label} {field.required && '*'}</Label>
            <Textarea
              id={field.id}
              placeholder={field.placeholder}
              value={customData[field.id] as string || ''}
              onChange={(e) => updateCustomField(field.id, e.target.value)}
              rows={3}
            />
          </div>
        );
      case 'select':
        return (
          <div key={field.id} className="space-y-2">
            <Label>{field.label} {field.required && '*'}</Label>
            <Select value={customData[field.id] as string || ''} onValueChange={(v) => updateCustomField(field.id, v)}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {field.options?.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      case 'checkbox':
        return (
          <div key={field.id} className="flex items-start space-x-2 pt-2">
            <Checkbox
              id={field.id}
              checked={customData[field.id] as boolean || false}
              onCheckedChange={(checked) => updateCustomField(field.id, checked === true)}
            />
            <Label htmlFor={field.id} className="text-sm text-slate-600 leading-tight cursor-pointer">
              {field.label} {field.required && '*'}
            </Label>
          </div>
        );
      default:
        // Unknown/legacy field type — render a text input so a required field is
        // never invisible (which would make the form impossible to submit).
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.id}>{field.label} {field.required && '*'}</Label>
            <Input
              id={field.id}
              type="text"
              placeholder={field.placeholder}
              value={customData[field.id] as string || ''}
              onChange={(e) => updateCustomField(field.id, e.target.value)}
            />
          </div>
        );
    }
  };

  if (isValidating) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: settings.primary_color }} />
      </div>
    );
  }

  if (!isValid) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <CardTitle className="text-slate-900">Formulário Não Encontrado</CardTitle>
            <CardDescription>O link que está a usar é inválido ou expirou.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${settings.primary_color}20` }}>
              <CheckCircle className="w-8 h-8" style={{ color: settings.primary_color }} />
            </div>
            <CardTitle className="text-slate-900">{settings.success_message.title}</CardTitle>
            <CardDescription className="text-base">{settings.success_message.description}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const sortedCustomFields = [...(settings.custom_fields || [])].sort((a, b) => a.order - b.order);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {settings.logo_url ? (
            <img src={settings.logo_url} alt={formData?.org_name || 'Logo'} className="h-12 w-auto max-w-full object-contain mx-auto mb-4" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          ) : (
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: `linear-gradient(135deg, ${settings.primary_color}, ${settings.primary_color}dd)` }}>
              <Zap className="w-6 h-6" style={{ color: readableTextColor(settings.primary_color) }} />
            </div>
          )}
          <CardTitle className="text-slate-900">{settings.title}</CardTitle>
          <CardDescription>{settings.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <CampoArmadilha value={antiBot.isca} onChange={antiBot.setIsca} />
            {/* Fixed Fields - conditionally rendered */}
            {settings.fields.name.visible && (
              <div className="space-y-2">
                <Label htmlFor="name">
                  {settings.fields.name.label} {settings.fields.name.required && '*'}
                </Label>
                <Input 
                  id="name" 
                  type="text" 
                  placeholder="João Silva" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                />
              </div>
            )}
            
            {settings.fields.phone.visible && (
              <div className="space-y-2">
                <Label htmlFor="phone">
                  {settings.fields.phone.label} {settings.fields.phone.required && '*'}
                </Label>
                <PhoneInput
                  value={phone}
                  onChange={setPhone}
                  placeholder="912 345 678"
                />
              </div>
            )}
            
            {settings.fields.email.visible && (
              <div className="space-y-2">
                <Label htmlFor="email">
                  {settings.fields.email.label} {settings.fields.email.required && '*'}
                </Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="joao@exemplo.pt" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                />
              </div>
            )}
            
            {settings.fields.message.visible && (
              <div className="space-y-2">
                <Label htmlFor="message">
                  {settings.fields.message.label} {settings.fields.message.required && '*'}
                </Label>
                <Textarea 
                  id="message" 
                  placeholder="Escreva a sua mensagem..." 
                  value={message} 
                  onChange={(e) => setMessage(e.target.value)} 
                  rows={3} 
                />
              </div>
            )}
            
            {sortedCustomFields.map(renderCustomField)}
            
            <div className="flex items-start space-x-2 pt-2">
              <Checkbox id="gdpr" checked={gdprConsent} onCheckedChange={(checked) => setGdprConsent(checked === true)} />
              <Label htmlFor="gdpr" className="text-xs text-slate-500 leading-tight cursor-pointer">
                Li e aceito a <a href={`${window.location.origin}/privacy`} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700">Política de Privacidade</a> *
              </Label>
            </div>
            
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
              style={{ backgroundColor: settings.primary_color, color: readableTextColor(settings.primary_color) }}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : settings.submit_button_text}
            </Button>
          </form>
        </CardContent>
      </Card>
      
      <p className="text-xs text-slate-400 mt-4">
        Powered by Senvia OS
      </p>
    </div>
  );
}
