'use client';

import {
  Button,
  Card,
  CardTitle,
  ErrorNote,
  Field,
  Input,
  Modal,
  parseMoneyInput,
  renderMarkdown,
  Select,
  Textarea,
} from '@cip/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useSession, useTenantId } from '@/lib/session';
import { ImageManager } from './image-manager';

type Product = Awaited<ReturnType<typeof loadProduct>>;

async function loadProduct(id: string) {
  return unwrap(await api.GET('/v1/admin/products/{id}', { params: { path: { id } } }));
}

interface VariantRow {
  id?: string;
  sku: string;
  title: string;
  price: string;
  compareAt: string;
  onHand: string;
}

function toRows(product: Product | null): VariantRow[] {
  if (!product) return [{ sku: '', title: 'Default', price: '', compareAt: '', onHand: '0' }];
  return product.variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    title: v.title,
    price: (v.priceCents / 100).toFixed(2),
    compareAt: v.compareAtCents ? (v.compareAtCents / 100).toFixed(2) : '',
    onHand: String(v.onHand),
  }));
}

export function ProductForm({ product }: { product: Product | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tenantId = useTenantId();
  const { can } = useSession();
  const editable = can('catalog:write');
  const [title, setTitle] = useState(product?.title ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>(product?.status ?? 'active');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [tags, setTags] = useState((product?.tags ?? []).join(', '));
  const [description, setDescription] = useState(product?.description ?? '');
  const [preview, setPreview] = useState(false);
  const [variants, setVariants] = useState<VariantRow[]>(toRows(product));
  const [version, setVersion] = useState(product?.version ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Product | null>(null);

  const categories = useQuery({
    queryKey: queryKeys.categories(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/categories')),
  });

  const body = () => {
    const parsed = variants.map((v) => {
      const priceCents = parseMoneyInput(v.price);
      if (priceCents === null) throw new Error(`Price for ${v.sku || 'variant'} is not a valid amount`);
      const compareAtCents = v.compareAt ? parseMoneyInput(v.compareAt) : null;
      return {
        ...(v.id ? { id: v.id } : {}),
        sku: v.sku.trim(),
        title: v.title.trim(),
        priceCents,
        compareAtCents,
        attributes: {},
        onHand: Math.max(0, Number(v.onHand) || 0),
      };
    });
    return {
      title,
      ...(slug ? { slug } : {}),
      status,
      brand: brand || null,
      categoryId: categoryId || null,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      description,
      attributes: product?.attributes ?? {},
      variants: parsed,
    };
  };

  const save = async (ifMatch: string | null) => {
    setSaving(true);
    setError(null);
    try {
      if (!product) {
        const created = unwrap(await api.POST('/v1/admin/products', { body: body() }));
        await queryClient.invalidateQueries({ queryKey: queryKeys.products.all(tenantId) });
        router.push(`/products/${created.id}`);
        return;
      }
      const updated = unwrap(
        await api.PATCH('/v1/admin/products/{id}', {
          params: { path: { id: product.id }, header: { 'If-Match': `"${ifMatch ?? version ?? ''}"` } },
          body: body(),
        }),
      );
      setVersion(updated.version);
      setVariants(toRows(updated));
      queryClient.setQueryData(queryKeys.products.detail(tenantId, product.id), updated);
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all(tenantId) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 412 && product) {
        setConflict(await loadProduct(product.id));
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(null);
  };

  const remove = async () => {
    if (!product || !window.confirm(`Delete ${product.title}?`)) return;
    await api.DELETE('/v1/admin/products/{id}', { params: { path: { id: product.id } } });
    await queryClient.invalidateQueries({ queryKey: queryKeys.products.all(tenantId) });
    router.push('/products');
  };

  const refresh = async () => {
    if (!product) return;
    const latest = await loadProduct(product.id);
    queryClient.setQueryData(queryKeys.products.detail(tenantId, product.id), latest);
    setVersion(latest.version);
  };

  const updateVariant = (index: number, patch: Partial<VariantRow>) =>
    setVariants((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardTitle>Details</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="title">
              <Input
                id="title"
                name="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={!editable}
              />
            </Field>
            <Field label="Slug" htmlFor="slug" hint="Leave empty to generate from the title">
              <Input
                id="slug"
                name="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={!editable}
              />
            </Field>
            <Field label="Brand" htmlFor="brand">
              <Input
                id="brand"
                name="brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                disabled={!editable}
              />
            </Field>
            <Field label="Category" htmlFor="category">
              <Select
                id="category"
                name="category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={!editable}
              >
                <option value="">No category</option>
                {(categories.data?.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {'— '.repeat(c.depth - 1)}
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="status">
              <Select
                id="status"
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                disabled={!editable}
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
            <Field label="Tags" htmlFor="tags" hint="Comma separated">
              <Input
                id="tags"
                name="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                disabled={!editable}
              />
            </Field>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">Description (Markdown)</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreview((p) => !p)}>
                {preview ? 'Edit' : 'Preview'}
              </Button>
            </div>
            {preview ? (
              <div
                className="prose-lite min-h-[120px] rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }}
              />
            ) : (
              <Textarea
                aria-label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                disabled={!editable}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardTitle
            actions={
              editable ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="add-variant"
                  onClick={() =>
                    setVariants((rows) => [
                      ...rows,
                      { sku: '', title: '', price: rows[0]?.price ?? '', compareAt: '', onHand: '0' },
                    ])
                  }
                >
                  Add variant
                </Button>
              ) : null
            }
          >
            Variants
          </CardTitle>
          <div className="space-y-2">
            <div className="hidden grid-cols-12 gap-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 sm:grid">
              <span className="col-span-3">SKU</span>
              <span className="col-span-3">Title</span>
              <span className="col-span-2">Price</span>
              <span className="col-span-2">Compare at</span>
              <span className="col-span-1">Stock</span>
            </div>
            {variants.map((v, index) => (
              <div key={v.id ?? `new-${index}`} className="grid grid-cols-12 gap-2" data-testid="variant-row">
                <Input
                  aria-label="SKU"
                  name={`variants.${index}.sku`}
                  className="col-span-3"
                  value={v.sku}
                  onChange={(e) => updateVariant(index, { sku: e.target.value })}
                  required
                  disabled={!editable}
                />
                <Input
                  aria-label="Variant title"
                  name={`variants.${index}.title`}
                  className="col-span-3"
                  value={v.title}
                  onChange={(e) => updateVariant(index, { title: e.target.value })}
                  required
                  disabled={!editable}
                />
                <Input
                  aria-label="Price"
                  name={`variants.${index}.price`}
                  inputMode="decimal"
                  className="col-span-2"
                  value={v.price}
                  onChange={(e) => updateVariant(index, { price: e.target.value })}
                  required
                  disabled={!editable}
                />
                <Input
                  aria-label="Compare at price"
                  name={`variants.${index}.compareAt`}
                  inputMode="decimal"
                  className="col-span-2"
                  value={v.compareAt}
                  onChange={(e) => updateVariant(index, { compareAt: e.target.value })}
                  disabled={!editable}
                />
                <Input
                  aria-label="Stock"
                  name={`variants.${index}.onHand`}
                  inputMode="numeric"
                  className="col-span-1"
                  value={v.onHand}
                  onChange={(e) => updateVariant(index, { onHand: e.target.value })}
                  disabled={!editable}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="col-span-1"
                  aria-label="Remove variant"
                  disabled={!editable || variants.length === 1}
                  onClick={() => setVariants((rows) => rows.filter((_, i) => i !== index))}
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardTitle>Images</CardTitle>
          {product ? (
            <ImageManager productId={product.id} images={product.images} onChanged={() => void refresh()} />
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Save the product first, then upload images.
            </p>
          )}
        </Card>
        {error ? <ErrorNote error={new Error(error)} /> : null}
        {editable ? (
          <div className="flex gap-2">
            <Button type="submit" loading={saving} data-testid="save-product">
              {product ? 'Save changes' : 'Create product'}
            </Button>
            {product ? (
              <Button type="button" variant="danger" onClick={() => void remove()}>
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <Modal
        open={conflict !== null}
        onClose={() => setConflict(null)}
        title="Product changed by someone else"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (!conflict) return;
                setTitle(conflict.title);
                setDescription(conflict.description);
                setStatus(conflict.status);
                setVariants(toRows(conflict));
                setVersion(conflict.version);
                setConflict(null);
              }}
            >
              Load their version
            </Button>
            <Button
              data-testid="overwrite"
              onClick={() => {
                const latest = conflict?.version ?? null;
                setConflict(null);
                setVersion(latest);
                void save(latest);
              }}
            >
              Overwrite with mine
            </Button>
          </>
        }
      >
        {conflict ? (
          <ul className="space-y-1 text-sm">
            {conflict.title !== title ? (
              <li>
                Title: “{conflict.title}” (theirs) vs “{title}” (yours)
              </li>
            ) : null}
            {conflict.status !== status ? (
              <li>
                Status: {conflict.status} vs {status}
              </li>
            ) : null}
            {conflict.description !== description ? <li>Description differs</li> : null}
            {JSON.stringify(toRows(conflict)) !== JSON.stringify(variants) ? <li>Variants differ</li> : null}
          </ul>
        ) : null}
      </Modal>
    </form>
  );
}

export { loadProduct };
