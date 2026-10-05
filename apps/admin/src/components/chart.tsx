'use client';

import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export type ChartOption = Parameters<echarts.ECharts['setOption']>[0];

export function Chart({
  option,
  height = 260,
  testId,
  replace = false,
  label,
}: {
  option: ChartOption;
  height?: number;
  testId?: string;
  replace?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const instance = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: replace, lazyUpdate: true });
  }, [option, replace]);

  return (
    <div
      ref={ref}
      style={{ height }}
      className="w-full"
      data-testid={testId}
      role={label ? 'img' : undefined}
      aria-label={label}
    />
  );
}
