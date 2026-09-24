export interface VendusRegisterOption {
  id: number;
  title: string;
  type: string;
  store_id: number | null;
}

export interface VendusPaymentMethodOption {
  id: number;
  title: string;
  type: string;
  store_ids: number[];
}

export interface VendusOptionsResponse {
  registers: VendusRegisterOption[];
  payment_methods: VendusPaymentMethodOption[];
}
