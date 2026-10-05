'use client';

import { Badge, ErrorNote, formatDateTime, statusTone, Table, Td, Th } from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export default function TenantsPage() {
  const tenants = useQuery({
    queryKey: queryKeys.platform.tenants(),
    queryFn: async () => unwrap(await api.GET('/v1/platform/tenants')),
  });
  return (
    <div>
      <PageHeader title="Tenants" />
      <ErrorNote error={tenants.error} />
      <Table>
        <thead>
          <tr>
            <Th>Store</Th>
            <Th>Status</Th>
            <Th className="text-right">Members</Th>
            <Th className="text-right">Products</Th>
            <Th className="text-right">Orders</Th>
            <Th>Created</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {(tenants.data?.data ?? []).map((t) => (
            <tr key={t.id}>
              <Td>
                {t.name}
                <div className="text-xs text-slate-500 dark:text-slate-400">{t.slug}</div>
              </Td>
              <Td>
                <Badge tone={statusTone(t.status)}>{t.status}</Badge>
              </Td>
              <Td className="text-right">{t.members}</Td>
              <Td className="text-right">{t.products}</Td>
              <Td className="text-right">{t.orders}</Td>
              <Td>{formatDateTime(t.createdAt)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
