'use client';

import { useState } from 'react';
import { ProductImage } from '@cip/ui';

export function Gallery({
  images,
  title,
}: {
  images: Array<{ url: string; alt: string | null }>;
  title: string;
}) {
  const [index, setIndex] = useState(0);
  const current = images[index] ?? images[0];
  return (
    <div className="space-y-3" data-testid="gallery">
      <div className="aspect-square overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800">
        <ProductImage src={current?.url} alt={current?.alt ?? title} />
      </div>
      {images.length > 1 ? (
        <ul className="grid grid-cols-5 gap-2">
          {images.map((image, i) => (
            <li key={image.url}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show image ${i + 1}`}
                aria-current={i === index}
                className={`block aspect-square w-full overflow-hidden rounded-lg border-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${
                  i === index ? 'border-[var(--brand)]' : 'border-transparent'
                }`}
              >
                <ProductImage src={image.url} alt={image.alt ?? title} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
