import { Skeleton } from '@cip/ui';
import { ProductGridSkeleton } from '@/components/product-grid';

export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <ProductGridSkeleton count={12} />
    </div>
  );
}
