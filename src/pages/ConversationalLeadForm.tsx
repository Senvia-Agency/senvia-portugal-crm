import { useState, useEffect, useMemo, useRef } from "react";
import { detectLeadSource } from "@/lib/source-detection";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ProgressBar } from "@/components/conversational/ProgressBar";
import { AIAvatar } from "@/components/conversational/AIAvatar";
import { StepContainer } from "@/components/conversational/StepContainer";
import { WelcomeStep } from "@/components/conversational/steps/WelcomeStep";
import { DynamicStep } from "@/components/conversational/steps/DynamicStep";
import { SuccessScreen } from "@/components/conversational/SuccessScreen";
import { FormSettings, migrateFormSettings, CustomField, MetaPixel } from "@/types";
import { normalizeEmail, normalizeInternationalPhone } from "@/lib/validation/contact";
import { useAntiBot, CampoArmadilha } from "@/components/forms/AntiBot";
import { getBrandStyle } from "@/lib/color";

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

interface FormData {
  form_id: string;
  form_name: string;
  form_settings: FormSettings;
  org_id: string;
  org_name: string;
  org_slug: string;
  meta_pixels: MetaPixel[];
  public_key?: string;
}

interface StepConfig {
  type: 'welcome' | 'field';
  key: string;
  label: string;
  required: boolean;
  fieldType?: 'name' | 'email' | 'phone' | 'message' | 'custom';
  customFieldType?: CustomField['type'];
  options?: string[];
  placeholder?: string;
}

// UTM source mapping
const ConversationalLeadForm = () => {
  const { slug, formSlug } = useParams<{ slug: string; formSlug?: string }>();
  const [currentStep, setCurrentStep] = useState(0);

  // Intelligent source detection with fallbacks
  const sourceDetection = useMemo(() => detectLeadSource(), []);
  const detectedSource = sourceDetection.source;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false); // Prevent duplicate submissions
  const [isComplete, setIsComplete] = useState(false);
  const [isVerificationPending, setIsVerificationPending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState<FormData | null>(null);
  const requiresContactVerification = formData?.org_slug === 'senvia-agency';
  const [error, setError] = useState<string | null>(null);
  const [stepData, setStepData] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Armadilha para robôs: um campo que não se vê, e o tempo desde que a página
  // abriu. Não custa um clique a quem responde a sério.
  const antiBot = useAntiBot();

  useEffect(() => {
    const fetchForm = async () => {
      if (!slug) {
        setError("Formulário não encontrado.");
        setIsLoading(false);
        return;
      }

      try {
        // Fetch form by slugs using new RPC function
        const { data, error } = await supabase
          .rpc("get_form_by_slugs", { 
            _org_slug: slug,
            _form_slug: formSlug || null  // null = default form
          });

        if (error || !data || data.length === 0) {
          setError("Formulário não encontrado.");
          setIsLoading(false);
          return;
        }

        const formResult = data[0];
        const migratedSettings = migrateFormSettings(formResult.form_settings as Partial<FormSettings>);

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
      } catch (err) {
        setError("Erro ao carregar formulário.");
      } finally {
        setIsLoading(false);
      }
    };

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
  }, [currentStep, isComplete, isLoading]);

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
          content_category: 'conversational_form_submission',
        }, { eventID: leadId });
        console.log('[Meta Pixel] Lead event sent for pixel:', pixel.pixel_id, 'eventID:', leadId);
      });
    } finally {
      // Always reset the flag after sending
      window.__senvia_allow_lead = false;
    }
  };

  // Generate steps from form settings
  const steps = useMemo<StepConfig[]>(() => {
    if (!formData?.form_settings) return [];

    const settings = formData.form_settings;
    const stepList: StepConfig[] = [];

    // Step 1: Welcome (always first, includes name if visible)
    const nameVisible = settings.fields.name.visible;
    stepList.push({
      type: 'welcome',
      key: 'welcome',
      label: nameVisible ? settings.fields.name.label : '',
      required: nameVisible ? settings.fields.name.required : false,
    });

    // Add visible fixed fields (except name which is in welcome)
    if (settings.fields.email.visible || requiresContactVerification) {
      stepList.push({
        type: 'field',
        key: 'email',
        label: settings.fields.email.label,
        required: settings.fields.email.required || requiresContactVerification,
        fieldType: 'email',
      });
    }

    if (settings.fields.phone.visible || requiresContactVerification) {
      stepList.push({
        type: 'field',
        key: 'phone',
        label: settings.fields.phone.label,
        required: settings.fields.phone.required || requiresContactVerification,
        fieldType: 'phone',
      });
    }

    if (settings.fields.message.visible) {
      stepList.push({
        type: 'field',
        key: 'message',
        label: settings.fields.message.label,
        required: settings.fields.message.required,
        fieldType: 'message',
      });
    }

    // Add custom fields
    settings.custom_fields.forEach((field) => {
      stepList.push({
        type: 'field',
        key: field.id,
        label: field.label,
        required: field.required,
        fieldType: 'custom',
        customFieldType: field.type,
        options: field.options,
        placeholder: field.placeholder,
      });
    });

    return stepList;
  }, [formData?.form_settings, requiresContactVerification]);

  const totalSteps = steps.length;

  const handleStepComplete = async (key: string, value: string) => {
    const newStepData = { ...stepData, [key]: value };
    setStepData(newStepData);

    const isLastStep = currentStep === totalSteps - 1;

    if (isLastStep) {
      // Submit the form
      await submitForm(newStepData);
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const submitForm = async (data: Record<string, string>) => {
    // Prevent duplicate submissions
    if (hasSubmitted || isSubmitting) {
      console.log('[Submit] Already submitted or submitting, ignoring duplicate call');
      return;
    }
    if (!formData) return;

    setHasSubmitted(true); // Mark as submitted IMMEDIATELY to prevent duplicates
    setIsSubmitting(true);

    const settings = formData.form_settings;

    setSubmitError(null);

    // Validate + normalize contact fields (same rules as the traditional form), so
    // the phone is stored E.164 (WhatsApp works) and we never send a fake email.
    const phoneRaw = (data.phone || "").trim();
    const phoneResult = phoneRaw ? normalizeInternationalPhone(phoneRaw) : null;
    const emailRaw = (data.email || "").trim();
    const emailResult = emailRaw ? normalizeEmail(emailRaw) : null;
    const phoneRequired = !!settings.fields?.phone?.required || requiresContactVerification;
    if ((phoneRequired && !phoneResult?.ok) || (requiresContactVerification && !emailResult?.ok) || (emailResult && !emailResult.ok)) {
      setSubmitError(settings.error_message || "Verifica o telefone e o email e tenta novamente.");
      setHasSubmitted(false);
      setIsSubmitting(false);
      return;
    }

    // Build custom_data from custom fields
    const customData: Record<string, string> = {};
    settings.custom_fields.forEach((field) => {
      if (data[field.id]) {
        customData[field.label] = data[field.id];
      }
    });

    const leadData = {
      name: data.welcome || data.name || "Lead Conversacional",
      email: emailResult?.ok ? emailResult.value : null,
      phone: phoneResult?.ok ? phoneResult.value : (data.phone || ""),
      source: detectedSource,
      public_key: formData.public_key,
      form_id: formData.form_id,  // Include form_id for form-specific settings
      custom_data: {
        ...customData,
        ...sourceDetection.tracking,
        form_type: 'conversational',
      },
      gdpr_consent: true,
      automation_enabled: true,
      // A mesma armadilha do formulário clássico. Aqui o tempo de preenchimento
      // é sempre folgado — isto é uma conversa —, mas o campo invisível vale na
      // mesma: um robô que leia o HTML preenche-o à mesma.
      ...antiBot.campos(),
    };

    // Log for n8n webhook integration
    console.log("Lead Conversacional:", leadData);

    try {
      const { data, error } = await supabase.functions.invoke("submit-lead", {
        body: leadData,
      });

      if (error) {
        console.error("Error submitting lead:", error);
        setSubmitError(settings.error_message || "Não foi possível enviar. Verifica os dados e tenta novamente.");
        setHasSubmitted(false);
        return;
      }

      // Check if backend marked this as a duplicate - do NOT track pixel for duplicates
      if (data?.duplicate === true) {
        console.log('[Meta Pixel] Backend marked as duplicate, NOT tracking Lead event');
        setIsComplete(true);
        return;
      }

      if (data?.verification_required === true) {
        setIsVerificationPending(true);
        setIsComplete(true);
        return;
      }

      // Only track Lead event AFTER confirmed success AND if we have a lead_id
      if (data?.lead_id) {
        console.log('[Meta Pixel] Lead submitted successfully, tracking event with lead_id:', data.lead_id);
        trackLeadEvent(data.lead_id);
      } else {
        console.warn('[Meta Pixel] No lead_id returned, cannot track with eventID');
      }
      setIsComplete(true);
    } catch (err) {
      console.error("Error:", err);
      setSubmitError(settings.error_message || "Ocorreu um erro de ligação. Tenta novamente.");
      setHasSubmitted(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep = () => {
    if (isComplete && formData) {
      return (
        <SuccessScreen
          userName={getFirstName(stepData.welcome || stepData.name)}
          title={isVerificationPending ? 'Confirma o teu email para continuar' : formData.form_settings.success_message.title}
          description={isVerificationPending
            ? 'Enviámos um link de confirmação. Depois de confirmares o email, abre o WhatsApp pelo link apresentado para provar que o número te pertence.'
            : formData.form_settings.success_message.description}
        />
      );
    }

    const step = steps[currentStep];
    if (!step || !formData) return null;

    const settings = formData.form_settings;

    if (step.type === 'welcome') {
      return (
        <WelcomeStep
          onNext={(name) => handleStepComplete('welcome', name)}
          title={settings.title}
          subtitle={settings.subtitle}
          nameLabel={settings.fields.name.label}
          showNameField={settings.fields.name.visible}
        />
      );
    }

    // Dynamic field step
    const isLastStep = currentStep === totalSteps - 1;

    // Show name only on the first step after welcome (step 1)
    const isFirstStepAfterWelcome = currentStep === 1;

    return (
      <DynamicStep
        field={{
          type: step.fieldType === 'custom' ? 'custom' : step.fieldType!,
          key: step.key,
          label: step.label,
          required: step.required,
          fieldType: step.customFieldType,
          options: step.options,
          placeholder: step.placeholder,
        }}
        userName={getFirstName(stepData.welcome || stepData.name)}
        showUserName={isFirstStepAfterWelcome}
        onNext={(value) => handleStepComplete(step.key, value)}
        isSubmitting={isSubmitting}
        submitButtonText={settings.submit_button_text}
        isLastStep={isLastStep}
      />
    );
  };

  const primaryColor = formData?.form_settings?.primary_color;

  // Helper to extract first name
  const getFirstName = (fullName?: string) => {
    if (!fullName) return '';
    return fullName.trim().split(' ')[0];
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent p-4">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold text-foreground">{error}</h1>
          <p className="text-muted-foreground">
            Verifique se o link está correto.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50/50 dark:bg-transparent p-4">
      <CampoArmadilha value={antiBot.isca} onChange={antiBot.setIsca} />
      <motion.div
        className="w-full max-w-lg"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Card Container. The brand style re-points --primary at the org color
            so the progress bar, option cards and CTA button match the brand. */}
        <div className="bg-card/80 backdrop-blur-sm rounded-2xl shadow-xl border border-border/50 overflow-hidden" style={getBrandStyle(primaryColor)}>
          {/* Progress Bar */}
          {!isComplete && totalSteps > 0 && (
            <div className="px-6 pt-6">
              <ProgressBar currentStep={currentStep + 1} totalSteps={totalSteps} />
            </div>
          )}

          {/* Content */}
          <div className="p-6 md:p-8">
            {/* AI Avatar / Logo */}
            <div className="flex justify-center mb-8">
              <AIAvatar 
                primaryColor={primaryColor} 
                logoUrl={formData?.form_settings?.logo_url}
              />
            </div>

            {/* Step Content */}
            <StepContainer stepKey={isComplete ? 99 : currentStep}>
              {renderStep()}
            </StepContainer>

            {submitError && (
              <p className="mt-4 text-center text-sm text-red-500" role="alert">{submitError}</p>
            )}

            {!isComplete && (
              <p className="mt-6 text-center text-[11px] text-muted-foreground">
                Ao enviar, aceitas a{" "}
                <a href={`${window.location.origin}/privacy`} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Política de Privacidade</a>.
              </p>
            )}
          </div>
        </div>

        {/* Branding */}
        <motion.p
          className="text-center text-xs text-muted-foreground mt-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
        >
          Powered by Senvia OS
        </motion.p>
      </motion.div>
    </div>
  );
};

export default ConversationalLeadForm;
