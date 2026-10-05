import type { KeyValueStorage } from './checkout-session';

export interface CheckoutForm {
  email: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  country: string;
  shippingMethod: string;
}

export const EMPTY_FORM: CheckoutForm = {
  email: '',
  name: '',
  line1: '',
  line2: '',
  city: '',
  postalCode: '',
  country: 'US',
  shippingMethod: 'standard',
};

export const FORM_KEY = 'cip_checkout_form';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FormErrors = Partial<Record<keyof CheckoutForm, string>>;

export function validateAddress(form: CheckoutForm): FormErrors {
  const errors: FormErrors = {};
  if (!EMAIL.test(form.email.trim())) errors.email = 'Enter a valid email address';
  if (!form.name.trim()) errors.name = 'Name is required';
  if (!form.line1.trim()) errors.line1 = 'Address is required';
  if (!form.city.trim()) errors.city = 'City is required';
  if (!form.postalCode.trim()) errors.postalCode = 'Postal code is required';
  if (!/^[A-Z]{2}$/.test(form.country)) errors.country = 'Choose a country';
  return errors;
}

export function loadForm(storage: KeyValueStorage | null): CheckoutForm {
  try {
    const raw = storage?.getItem(FORM_KEY);
    if (!raw) return EMPTY_FORM;
    const parsed = JSON.parse(raw) as Partial<CheckoutForm>;
    const form = { ...EMPTY_FORM };
    for (const key of Object.keys(EMPTY_FORM) as Array<keyof CheckoutForm>) {
      const value = parsed[key];
      if (typeof value === 'string') form[key] = value;
    }
    return form;
  } catch {
    return EMPTY_FORM;
  }
}

export function saveForm(storage: KeyValueStorage | null, form: CheckoutForm): void {
  try {
    storage?.setItem(FORM_KEY, JSON.stringify(form));
  } catch {
    return;
  }
}

export function normalizeCard(value: string): string {
  return value.replace(/[\s-]+/g, '');
}
