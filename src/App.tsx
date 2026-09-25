import { lazy, Suspense } from "react";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedLayoutRoute } from "@/components/auth/ProtectedLayoutRoute";
import { SuperAdminRoute } from "@/components/auth/SuperAdminRoute";
const PWAInstallButton = lazy(() => import("@/components/pwa/PWAInstallButton").then(m => ({ default: m.PWAInstallButton })));
const PWAUpdateBanner = lazy(() => import("@/components/pwa/PWAUpdateBanner").then(m => ({ default: m.PWAUpdateBanner })));

// Eager: Login is the entry point
import Login from "./pages/Login";

// Lazy: All other pages
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Novidades = lazy(() => import("./pages/Novidades"));
const NovidadeDetail = lazy(() => import("./pages/NovidadeDetail"));
const Leads = lazy(() => import("./pages/Leads"));
const Inbox = lazy(() => import("./pages/Inbox"));
const ExtensionAuth = lazy(() => import("./pages/ExtensionAuth"));
const Prospects = lazy(() => import("./pages/Prospects"));
const PortalTotalLink = lazy(() => import("./pages/PortalTotalLink"));
const PortalTotalLinkHome = lazy(() => import("./pages/portal-total-link/Home"));
const PortalTotalLinkContratos = lazy(() => import("./pages/portal-total-link/Contratos"));
const PortalTotalLinkIds = lazy(() => import("./pages/portal-total-link/Ids"));
const PortalTotalLinkPendentes = lazy(() => import("./pages/portal-total-link/Pendentes"));
const PortalTotalLinkReclamacoes = lazy(() => import("./pages/portal-total-link/Reclamacoes"));
const PortalTotalLinkRh = lazy(() => import("./pages/portal-total-link/Rh"));
const Clients = lazy(() => import("./pages/Clients"));
const Calendar = lazy(() => import("./pages/Calendar"));
const Settings = lazy(() => import("./pages/Settings"));
const Proposals = lazy(() => import("./pages/Proposals"));
const Sales = lazy(() => import("./pages/Sales"));
const Finance = lazy(() => import("./pages/Finance"));
const NewInvoice = lazy(() => import("./pages/finance/NewInvoice"));
const FinancePayments = lazy(() => import("./pages/finance/Payments"));
const FinanceInvoices = lazy(() => import("./pages/finance/Invoices"));
const FinanceExpenses = lazy(() => import("./pages/finance/Expenses"));
const Marketing = lazy(() => import("./pages/Marketing"));
const MarketingTemplates = lazy(() => import("./pages/marketing/Templates"));
const MarketingCampaigns = lazy(() => import("./pages/marketing/Campaigns"));
const MarketingReports = lazy(() => import("./pages/marketing/Reports"));

const MarketingLists = lazy(() => import("./pages/marketing/Lists"));
const Automations = lazy(() => import("./pages/Automations"));
const AutomationEditor = lazy(() => import("./pages/AutomationEditor"));
const PublicLeadForm = lazy(() => import("./pages/PublicLeadForm"));
const ConversationalLeadForm = lazy(() => import("./pages/ConversationalLeadForm"));
const Pricing = lazy(() => import("./pages/Pricing"));
const InviteRegister = lazy(() => import("./pages/InviteRegister"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Privacy = lazy(() => import("./pages/Privacy"));
const DataDeletion = lazy(() => import("./pages/DataDeletion"));
const Terms = lazy(() => import("./pages/Terms"));
const Install = lazy(() => import("./pages/Install"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const Tutoriais = lazy(() => import("./pages/Tutoriais"));
const TutorialMakeSenvia = lazy(() => import("./pages/TutorialMakeSenvia"));
const MetaOAuthDone = lazy(() => import("./pages/MetaOAuthDone"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SystemAdminDashboard = lazy(() => import("./pages/system-admin/Dashboard"));
const SystemAdminUsers = lazy(() => import("./pages/system-admin/Users"));
const SystemAdminAnnouncements = lazy(() => import("./pages/system-admin/Announcements"));
const SystemAdminTrialActivation = lazy(() => import("./pages/system-admin/TrialActivation"));
const SystemAdminTrialWhatsApp = lazy(() => import("./pages/system-admin/TrialWhatsApp"));
const FinanceInternalRequests = lazy(() => import("./pages/finance/InternalRequests"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15000),
    },
  },
});

/**
 * `Router` is injectable so the same app can run outside the website.
 *
 * The Chrome extension renders this very component from a `chrome-extension://`
 * page, where the pathname is `/crm-app.html` and BrowserRouter would match no
 * route at all. It passes HashRouter instead. Defaults to BrowserRouter, so the
 * website is unchanged.
 */
const App = ({ Router = BrowserRouter }: { Router?: React.ComponentType<{ future?: object; children?: React.ReactNode }> }) => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Router>
          <AuthProvider>
            <Suspense fallback={null}><PWAInstallButton /></Suspense>
            <Suspense fallback={null}><PWAUpdateBanner /></Suspense>
            <Suspense fallback={<div className="flex items-center justify-center h-dvh bg-background"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
              <Routes>
                {/* Public Routes */}
                <Route path="/" element={<Login />} />
                <Route path="/login" element={<Navigate to="/" replace />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/f/:slug" element={<PublicLeadForm />} />
                <Route path="/f/:slug/:formSlug" element={<PublicLeadForm />} />
                <Route path="/c/:slug" element={<ConversationalLeadForm />} />
                <Route path="/c/:slug/:formSlug" element={<ConversationalLeadForm />} />
                <Route path="/invite/:token" element={<InviteRegister />} />
                <Route path="/precos" element={<Pricing />} />
                <Route path="/privacy" element={<Privacy />} />
                {/* Público e sem login: a Meta exige aceder a esta página sem
                    credenciais durante a revisão da app. */}
                <Route path="/data-deletion" element={<DataDeletion />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/install" element={<Install />} />
                <Route path="/unsubscribe" element={<Unsubscribe />} />
                <Route path="/tutoriais" element={<Tutoriais />} />
                <Route path="/tutoriais/make" element={<TutorialMakeSenvia />} />
                {/* URL antigo do tutorial, ja partilhado com clientes: continua a funcionar. */}
                <Route path="/tutorial/make-senvia" element={<Navigate to="/tutoriais/make" replace />} />
                {/* Fim do popup do login da Meta. Publico de proposito: o popup
                    volta aqui vindo da Meta e nao pode cair no ecra de login. */}
                <Route path="/oauth/meta" element={<MetaOAuthDone />} />

                {/* Protected Routes (Persistent Layout) */}
                <Route element={<ProtectedLayoutRoute />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/novidades" element={<Novidades />} />
                  <Route path="/novidades/:id" element={<NovidadeDetail />} />
                  <Route path="/leads" element={<Leads />} />
                  <Route path="/inbox" element={<Inbox />} />
                  <Route path="/extension-auth" element={<ExtensionAuth />} />
                  <Route path="/prospects" element={<Prospects />} />
                  <Route path="/portal-total-link" element={<PortalTotalLink />}>
                    <Route index element={<Navigate to="home" replace />} />
                    <Route path="home" element={<PortalTotalLinkHome />} />
                    <Route path="contratos" element={<PortalTotalLinkContratos />} />
                    <Route path="ids" element={<PortalTotalLinkIds />} />
                    <Route path="pendentes" element={<PortalTotalLinkPendentes />} />
                    <Route path="reclamacoes" element={<PortalTotalLinkReclamacoes />} />
                    <Route path="rh" element={<PortalTotalLinkRh />} />
                  </Route>
                  <Route path="/clients" element={<Clients />} />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/proposals" element={<Proposals />} />
                  <Route path="/sales" element={<Sales />} />
                  <Route path="/financeiro" element={<Finance />} />
                  <Route path="/financeiro/nova-fatura" element={<NewInvoice />} />
                  <Route path="/financeiro/pagamentos" element={<FinancePayments />} />
                  <Route path="/financeiro/faturas" element={<FinanceInvoices />} />
                  <Route path="/financeiro/despesas" element={<FinanceExpenses />} />
                  <Route path="/ecommerce/*" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/marketing" element={<Marketing />} />
                  <Route path="/marketing/templates" element={<MarketingTemplates />} />
                  <Route path="/marketing/campaigns" element={<MarketingCampaigns />} />
                  <Route path="/marketing/reports" element={<MarketingReports />} />
                  <Route path="/marketing/lists" element={<MarketingLists />} />
                  <Route path="/automacoes" element={<Automations />} />
                  <Route path="/automacoes/:id" element={<AutomationEditor />} />

                </Route>

                {/* Super Admin Routes */}
                <Route path="/system-admin" element={
                  <SuperAdminRoute>
                    <SystemAdminDashboard />
                  </SuperAdminRoute>
                } />
                <Route path="/system-admin/users" element={
                  <SuperAdminRoute>
                    <SystemAdminUsers />
                  </SuperAdminRoute>
                } />
                <Route path="/system-admin/announcements" element={
                  <SuperAdminRoute>
                    <SystemAdminAnnouncements />
                  </SuperAdminRoute>
                } />
                <Route path="/system-admin/activation" element={
                  <SuperAdminRoute>
                    <SystemAdminTrialActivation />
                  </SuperAdminRoute>
                } />
                <Route path="/system-admin/trial-whatsapp" element={
                  <SuperAdminRoute>
                    <SystemAdminTrialWhatsApp />
                  </SuperAdminRoute>
                } />

                {/* Finance sub-routes */}
                <Route element={<ProtectedLayoutRoute />}>
                  <Route path="/financeiro/pedidos" element={<FinanceInternalRequests />} />
                </Route>

                {/* Catch-all */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
