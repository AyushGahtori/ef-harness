export interface PaymentIntentCreateParams {
  amount: number;
  currency: string;
  payment_method?: string;
}

export interface PaymentIntents {
  create(params: PaymentIntentCreateParams): Promise<{ id: string }>;
}

export declare const paymentIntents: PaymentIntents;
