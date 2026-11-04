import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClientFieldsEditor } from './ClientFieldsEditor';
import { LeadFieldsEditor } from './LeadFieldsEditor';
import { ProposalFieldsEditor } from './ProposalFieldsEditor';
import { SaleFieldsEditor } from './SaleFieldsEditor';
import { Users, UserPlus, FileText, ShoppingCart } from 'lucide-react';
import { useLanguage } from '@/i18n';

export function FieldsManagerTabs() {
  const { t } = useLanguage();
  return (
    <Tabs defaultValue="leads" className="w-full">
      <TabsList className="w-full flex flex-wrap h-auto gap-1 mb-4">
        <TabsTrigger value="leads" className="flex items-center gap-1.5 flex-1 min-w-[100px]">
          <UserPlus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('Leads')}</span>
        </TabsTrigger>
        <TabsTrigger value="clients" className="flex items-center gap-1.5 flex-1 min-w-[100px]">
          <Users className="h-4 w-4" />
          <span className="hidden sm:inline">{t('Clientes')}</span>
        </TabsTrigger>
        <TabsTrigger value="proposals" className="flex items-center gap-1.5 flex-1 min-w-[100px]">
          <FileText className="h-4 w-4" />
          <span className="hidden sm:inline">{t('Propostas')}</span>
        </TabsTrigger>
        <TabsTrigger value="sales" className="flex items-center gap-1.5 flex-1 min-w-[100px]">
          <ShoppingCart className="h-4 w-4" />
          <span className="hidden sm:inline">{t('Vendas')}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="leads"><LeadFieldsEditor /></TabsContent>
      <TabsContent value="clients"><ClientFieldsEditor /></TabsContent>
      <TabsContent value="proposals"><ProposalFieldsEditor /></TabsContent>
      <TabsContent value="sales"><SaleFieldsEditor /></TabsContent>
    </Tabs>
  );
}
