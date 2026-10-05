'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchDecision,
  fetchExplanation,
  fetchRecommendations,
  type DecisionRequest,
  type RecommendationRequest,
} from '@/lib/personalization';

const PERSONAL = {
  staleTime: 0,
  gcTime: 0,
  retry: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function useRecommendations(
  input: RecommendationRequest,
  options: { refreshKey?: string; keepPrevious?: boolean; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [
      'personal',
      'recommendations',
      input.type,
      input.productId ?? null,
      input.limit ?? null,
      options.refreshKey ?? null,
    ],
    queryFn: ({ signal }) => fetchRecommendations(input, signal),
    enabled: options.enabled ?? true,
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
    ...PERSONAL,
  });
}

export function useDecision(input: DecisionRequest, options: { refreshKey?: string } = {}) {
  return useQuery({
    queryKey: [
      'personal',
      'decision',
      input.placement,
      input.productId ?? null,
      input.limit ?? null,
      options.refreshKey ?? null,
    ],
    queryFn: ({ signal }) => fetchDecision(input, signal),
    ...PERSONAL,
  });
}

export function useExplanation(decisionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['personal', 'explanation', decisionId],
    queryFn: ({ signal }) => fetchExplanation(decisionId, signal),
    enabled,
    staleTime: Infinity,
    retry: 0,
    refetchOnWindowFocus: false,
  });
}
