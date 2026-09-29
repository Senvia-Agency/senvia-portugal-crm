export interface VendusOptionsResponse {
  registers: unknown[];
  payment_methods: unknown[];
  register_ready?: boolean;
  readiness_error?: string | null;
}
