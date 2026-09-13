import { useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import NumberFlow from "@number-flow/react";
import { Users, FileText, Inbox, CheckCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TimelineContent } from "@/components/ui/timeline-animation";
import { cn } from "@/lib/utils";
import {
  STRIPE_PLANS,
  YEARLY_DISCOUNT_PCT,
  monthlyPrice,
  type BillingPeriod,
  type StripePlan,
} from "@/lib/stripe-plans";

const revealVariants = {
  visible: (i: number) => ({
    y: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { delay: i * 0.15, duration: 0.5 },
  }),
  hidden: { filter: "blur(10px)", y: -20, opacity: 0 },
};

function PricingSwitch({
  period,
  onChange,
}: {
  period: BillingPeriod;
  onChange: (p: BillingPeriod) => void;
}) {
  const options: { key: BillingPeriod; label: string }[] = [
    { key: "monthly", label: "Mensal" },
    { key: "yearly", label: "Anual" },
  ];
  return (
    <div className="flex justify-center">
      <div className="relative z-10 mx-auto flex w-fit rounded-full border border-gray-200 bg-neutral-50 p-1">
        {options.map((opt) => {
          const active = period === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => onChange(opt.key)}
              className={cn(
                "relative z-10 h-10 w-fit rounded-full px-3 py-1 font-medium transition-colors sm:h-12 sm:px-6 sm:py-2",
                active ? "text-white" : "text-muted-foreground hover:text-black",
              )}
            >
              {active && (
                <motion.span
                  layoutId="pricing-switch"
                  className="absolute left-0 top-0 h-10 w-full rounded-full border-4 border-blue-600 bg-gradient-to-t from-blue-500 via-blue-400 to-blue-600 shadow-sm shadow-blue-600 sm:h-12"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
              <span className="relative flex items-center gap-2">
                {opt.label}
                {opt.key === "yearly" && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-black">
                    Poupa {YEARLY_DISCOUNT_PCT}%
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function planLimitRows(plan: StripePlan) {
  const usersText =
    plan.limits.users === "Ilimitados" ? "Utilizadores ilimitados" : `${plan.limits.users} utilizadores`;
  const formsText = plan.limits.forms === "Ilimitados" ? "Formulários ilimitados" : plan.limits.forms;
  return [
    { icon: Users, text: usersText },
    { icon: FileText, text: formsText },
    { icon: Inbox, text: plan.limits.inboxes },
  ];
}

function planIncludes(plan: StripePlan) {
  return [...plan.modules.filter((m) => !/^Tudo do/i.test(m)), ...plan.integrations];
}

// The reference pricing layout (brush glow, big heading, animated switch, cards
// with NumberFlow prices and gradient CTAs). Shared by the public /precos page
// and the in-app Billing tab. The CTA per plan is provided by the caller so each
// context (sign-up vs upgrade/downgrade) renders the right button.
export function PricingPlans({
  period,
  onPeriodChange,
  renderCta,
  showHeading = true,
  currentPlanId = null,
  className,
}: {
  period: BillingPeriod;
  onPeriodChange: (p: BillingPeriod) => void;
  renderCta: (plan: StripePlan, ctx: { isCurrent: boolean; popular: boolean }) => ReactNode;
  showHeading?: boolean;
  currentPlanId?: string | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isYearly = period === "yearly";

  return (
    <div ref={ref} className={cn("relative overflow-hidden rounded-3xl bg-neutral-100 px-4 pt-12", className)}>
      {/* Blue brush glow */}
      <div
        aria-hidden
        className="absolute left-[10%] right-[10%] top-0 z-0 h-full w-[80%]"
        style={{
          backgroundImage: "radial-gradient(circle at center, #206ce8 0%, transparent 70%)",
          opacity: 0.55,
          mixBlendMode: "multiply",
        }}
      />

      {showHeading && (
        <div className="relative mx-auto mb-6 max-w-3xl text-center">
          <TimelineContent
            as="h2"
            animationNum={0}
            timelineRef={ref}
            customVariants={revealVariants}
            className="mb-4 text-3xl font-medium text-gray-900 sm:text-4xl md:text-5xl"
          >
            Um plano para o teu{" "}
            <TimelineContent
              as="span"
              animationNum={1}
              timelineRef={ref}
              customVariants={revealVariants}
              className="inline-block rounded-xl border border-dashed border-blue-500 bg-blue-100 px-2 py-1 text-blue-700"
            >
              negócio
            </TimelineContent>
          </TimelineContent>
          <TimelineContent
            as="p"
            animationNum={2}
            timelineRef={ref}
            customVariants={revealVariants}
            className="mx-auto w-[85%] text-sm text-gray-600 sm:w-[70%] sm:text-base"
          >
            49 €/mês. Inclui 5 utilizadores; adiciona mais por 5 €/mês cada. CRM, vendas, marketing, financeiro e email num só lugar.
          </TimelineContent>
        </div>
      )}

      <TimelineContent as="div" animationNum={3} timelineRef={ref} customVariants={revealVariants}>
        <p className="text-center text-sm text-gray-700">Faturação mensal · Utilizadores atuais mantêm os limites contratados</p>
      </TimelineContent>

      <div className="relative mx-auto grid max-w-xl gap-4 py-6">
        {STRIPE_PLANS.map((plan, index) => {
          const popular = !!plan.highlighted;
          const isCurrent = currentPlanId === plan.id;
          const price = monthlyPrice(plan, period);
          const includesHeader = index === 0 ? "Inclui:" : `Tudo do ${STRIPE_PLANS[index - 1].name}, mais:`;
          return (
            <TimelineContent
              key={plan.id}
              as="div"
              animationNum={4 + index}
              timelineRef={ref}
              customVariants={revealVariants}
            >
              <Card
                className={cn(
                  "relative h-full border-neutral-200",
                  isCurrent ? "bg-blue-50 ring-2 ring-blue-600" : popular ? "bg-blue-50 ring-2 ring-blue-500" : "bg-white",
                )}
              >
                <CardHeader className="text-left">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="mb-2 text-3xl font-semibold text-gray-900">{plan.name}</h3>
                    {isCurrent ? (
                      <span className="h-fit rounded-full bg-blue-600 px-3 py-1 text-sm font-medium text-white">Atual</span>
                    ) : popular ? (
                      <span className="h-fit rounded-full bg-blue-500 px-3 py-1 text-sm font-medium text-white">Popular</span>
                    ) : null}
                  </div>
                  <p className="mb-4 text-sm text-gray-600">{plan.description}</p>
                  <div className="flex items-baseline">
                    <span className="flex items-baseline text-4xl font-semibold text-gray-900">
                      <NumberFlow value={price} className="text-4xl font-semibold" />€
                    </span>
                    <span className="ml-1 text-gray-600">/mês</span>
                  </div>
                  <p className={cn("mt-1 text-xs text-gray-500 transition-opacity", isYearly ? "opacity-100" : "opacity-0")}>
                    faturado anualmente · {plan.priceYearly}€/ano
                  </p>
                </CardHeader>

                <CardContent className="pt-0">
                  {renderCta(plan, { isCurrent, popular })}

                  <ul className="space-y-2 py-5 font-semibold">
                    {planLimitRows(plan).map((feature, i) => (
                      <li key={i} className="flex items-center">
                        <span className="mr-3 mt-0.5 grid place-content-center text-neutral-800">
                          <feature.icon size={20} />
                        </span>
                        <span className="text-sm text-gray-600">{feature.text}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="space-y-3 border-t border-neutral-200 pt-4">
                    <h4 className="mb-3 text-base font-medium text-gray-900">{includesHeader}</h4>
                    <ul className="space-y-2 font-semibold">
                      {planIncludes(plan).map((feature, i) => (
                        <li key={i} className="flex items-center">
                          <span className="mr-3 mt-0.5 grid h-6 w-6 place-content-center rounded-full border border-blue-500 bg-green-50">
                            <CheckCheck className="h-4 w-4 text-blue-500" />
                          </span>
                          <span className="text-sm text-gray-600">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </TimelineContent>
          );
        })}
      </div>
    </div>
  );
}

// Shared CTA button styled like the reference (gradient). `popular` gets the blue
// gradient, others the dark gradient.
export function PricingCtaButton({
  popular,
  children,
  ...props
}: { popular?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "mb-6 w-full rounded-xl p-4 text-lg font-medium text-white transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100",
        popular
          ? "border border-blue-400 bg-gradient-to-t from-blue-500 to-blue-600 shadow-lg shadow-blue-500/40"
          : "border border-neutral-700 bg-gradient-to-t from-neutral-900 to-neutral-600 shadow-lg shadow-neutral-900/30",
        props.className,
      )}
    >
      {children}
    </button>
  );
}
