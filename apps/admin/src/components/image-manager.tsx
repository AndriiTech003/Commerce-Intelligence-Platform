'use client';

import { Button, ProductImage } from '@cip/ui';
import { useState, type DragEvent } from 'react';
import { api, errorMessage, unwrap } from '@/lib/api';

export interface ProductImageView {
  id: string;
  url: string;
  position: number;
  alt: string | null;
}

interface Upload {
  name: string;
  progress: number;
  error: string | null;
}

function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (p: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });
}

export function ImageManager({
  productId,
  images,
  onChanged,
}: {
  productId: string;
  images: ProductImageView[];
  onChanged: () => void;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<ProductImageView[] | null>(null);
  const list = order ?? images;

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const contentType = file.type as
        'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/svg+xml';
      setUploads((u) => [...u, { name: file.name, progress: 0, error: null }]);
      const update = (patch: Partial<Upload>) =>
        setUploads((u) => u.map((item) => (item.name === file.name ? { ...item, ...patch } : item)));
      try {
        const ticket = unwrap(
          await api.POST('/v1/admin/products/{id}/images', {
            params: { path: { id: productId } },
            body: { filename: file.name, contentType, alt: file.name.replace(/\.[^.]+$/, '') },
          }),
        );
        await putWithProgress(ticket.uploadUrl, file, ticket.headers, (progress) => update({ progress }));
        update({ progress: 100 });
        onChanged();
      } catch (error) {
        update({ error: errorMessage(error) });
      }
    }
  };

  const onDropFiles = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files);
  };

  const onDropImage = async (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = [...list];
    const from = next.findIndex((i) => i.id === dragId);
    const to = next.findIndex((i) => i.id === targetId);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setOrder(next);
    setDragId(null);
    try {
      unwrap(
        await api.PUT('/v1/admin/products/{id}/images/order', {
          params: { path: { id: productId } },
          body: { imageIds: next.map((i) => i.id) },
        }),
      );
      onChanged();
    } finally {
      setOrder(null);
    }
  };

  const remove = async (imageId: string) => {
    await api.DELETE('/v1/admin/products/{id}/images/{imageId}', {
      params: { path: { id: productId, imageId } },
    });
    onChanged();
  };

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4" data-testid="product-images">
        {list.map((image) => (
          <li
            key={image.id}
            draggable
            onDragStart={() => setDragId(image.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => void onDropImage(image.id)}
            className="group relative aspect-square overflow-hidden rounded-md border border-slate-200 dark:border-slate-700"
          >
            <ProductImage src={image.url} alt={image.alt ?? 'image'} />
            <button
              type="button"
              onClick={() => void remove(image.id)}
              className="absolute right-1 top-1 hidden rounded bg-black/60 px-1.5 text-xs text-white group-hover:block"
              aria-label="Remove image"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <label
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDropFiles}
        className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        Drop images here or click to upload
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          multiple
          className="sr-only"
          data-testid="image-input"
          onChange={(event) => event.target.files && void upload(event.target.files)}
        />
      </label>
      {uploads.map((u) => (
        <div key={u.name} className="text-xs">
          <div className="flex justify-between">
            <span>{u.name}</span>
            <span>{u.error ?? `${u.progress}%`}</span>
          </div>
          <div className="h-1 rounded bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-1 rounded ${u.error ? 'bg-red-500' : 'bg-[var(--brand)]'}`}
              style={{ width: `${u.progress}%` }}
            />
          </div>
        </div>
      ))}
      {list.length > 1 ? (
        <Button variant="ghost" size="sm" type="button" disabled>
          Drag images to reorder
        </Button>
      ) : null}
    </div>
  );
}
