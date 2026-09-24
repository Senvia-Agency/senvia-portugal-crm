import type { VendusPaymentMethodOption, VendusRegisterOption } from '@/types/vendus';

export function paymentMethodsForVendusRegister(
  registerId: string,
  registers: VendusRegisterOption[],
  paymentMethods: VendusPaymentMethodOption[],
): VendusPaymentMethodOption[] {
  const register = registers.find((item) => String(item.id) === registerId);
  // Vendus can issue documents without an explicit register.
  if (!register) return paymentMethods;
  return paymentMethods.filter((method) => !method.store_ids.length || register.store_id === null
    || method.store_ids.includes(register.store_id));
}
