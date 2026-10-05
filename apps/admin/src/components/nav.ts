export interface NavItem {
  href: string;
  label: string;
  permission?: string;
  platform?: boolean;
  soon?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/live', label: 'Live', permission: 'analytics:read' },
      { href: '/analytics', label: 'Analytics', permission: 'analytics:read' },
    ],
  },
  {
    label: 'Commerce',
    items: [
      { href: '/orders', label: 'Orders', permission: 'orders:read' },
      { href: '/products', label: 'Products', permission: 'catalog:read' },
      { href: '/inventory', label: 'Inventory', permission: 'catalog:read' },
      { href: '/customers', label: 'Customers', permission: 'customers:read' },
      { href: '/discounts', label: 'Discounts', permission: 'catalog:read' },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { href: '/marketing/campaigns', label: 'Campaigns', permission: 'marketing:write' },
      { href: '/marketing/segments', label: 'Segments', permission: 'customers:read' },
      { href: '/marketing/review', label: 'Review queue', permission: 'marketing:approve' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings/store', label: 'Store', permission: 'settings:write' },
      { href: '/settings/team', label: 'Team', permission: 'staff:manage' },
      { href: '/settings/api-keys', label: 'API keys', permission: 'apikeys:manage' },
      { href: '/settings/webhooks', label: 'Webhooks', permission: 'settings:write' },
      { href: '/settings/audit', label: 'Audit log', permission: 'settings:write' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/platform/tenants', label: 'Tenants', platform: true },
      { href: '/platform/dlq', label: 'Dead letters', platform: true },
      { href: '/platform/simulator', label: 'Simulator', platform: true },
    ],
  },
];

export function visibleNav(can: (permission: string) => boolean, isPlatformAdmin: boolean): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.platform ? isPlatformAdmin : !item.permission || can(item.permission),
    ),
  })).filter((group) => group.items.length > 0);
}
