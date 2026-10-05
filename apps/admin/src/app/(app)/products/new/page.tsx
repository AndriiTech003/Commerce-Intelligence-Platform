'use client';

import { ProductForm } from '@/components/product-form';
import { PageHeader } from '@/components/shell';

export default function NewProductPage() {
  return (
    <div>
      <PageHeader title="New product" />
      <ProductForm product={null} />
    </div>
  );
}
