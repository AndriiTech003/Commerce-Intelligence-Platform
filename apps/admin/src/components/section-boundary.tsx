'use client';

import { Button, Card } from '@cip/ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class SectionBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Section "${this.props.title}" crashed`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <Card role="alert" className="border-red-200 dark:border-red-900">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          {this.props.title} failed to render
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{this.state.error.message}</p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </Card>
    );
  }
}
