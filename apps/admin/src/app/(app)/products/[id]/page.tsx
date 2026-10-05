'use client';

import { ErrorNote, Skeleton } from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { loadProduct, ProductForm } from '@/components/product-form';
import { PageHeader } from '@/components/shell';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId();
  const product = useQuery({
    queryKey: queryKeys.products.detail(tenantId, id),
    queryFn: () => loadProduct(id),
  });
  if (product.error) return <ErrorNote error={product.error} />;
  if (!product.data) return <Skeleton className="h-96" />;
  return (
    <div>
      <PageHeader
        title={product.data.title}
        description={`/${product.data.slug} · version ${product.data.version}`}
      />
      <ProductForm key={product.data.id} product={product.data} />
    </div>
  );
}
