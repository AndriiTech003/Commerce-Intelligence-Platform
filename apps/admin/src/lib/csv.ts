export const CSV_COLUMNS = [
  'handle',
  'title',
  'description',
  'brand',
  'status',
  'category',
  'tags',
  'sku',
  'variant_title',
  'price',
  'compare_at_price',
  'stock',
] as const;

const SAMPLE_ROWS = [
  [
    'trail-runner-x',
    'Trail Runner X',
    'Grippy trail shoe for muddy mornings',
    'Trailborn',
    'active',
    'trail_shoes',
    'trail;waterproof',
    'TRX-42',
    'EU 42',
    '129.00',
    '149.00',
    '12',
  ],
  [
    'trail-runner-x',
    'Trail Runner X',
    '',
    'Trailborn',
    'active',
    'trail_shoes',
    '',
    'TRX-43',
    'EU 43',
    '129.00',
    '',
    '8',
  ],
];

export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvTemplate(): string {
  return [CSV_COLUMNS.join(','), ...SAMPLE_ROWS.map((row) => row.map(csvEscape).join(','))].join('\n') + '\n';
}

export function csvDataUri(content: string): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`;
}
