'use client';

import { SegmentEditor } from '@/components/segment-editor';
import { PageHeader } from '@/components/shell';

export default function NewSegmentPage() {
  return (
    <div>
      <PageHeader
        title="New segment"
        description="Combine conditions with ALL / ANY groups. The preview counts matching profiles (including live changes) as you type."
      />
      <SegmentEditor />
    </div>
  );
}
