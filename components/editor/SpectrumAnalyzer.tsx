'use client';

import { useRef, useEffect } from 'react';

interface SpectrumAnalyzerProps {
  analyser: AnalyserNode | null;
  active: boolean;
  width?: number;
  height?: number;
  barCount?: number;
}

const FREQ_MIN = 40;
const FREQ_MAX = 16000;
const DECAY = 0.88;

function logBinIndex(barIndex: number, barCount: number, nyquistBins: number): number {
  const ratio = FREQ_MAX / FREQ_MIN;
  return Math.floor(nyquistBins * (Math.pow(ratio, barIndex / barCount) - 1) / (ratio - 1));
}

function barColor(barIndex: number, barCount: number): string {
  // hsl(185) cyan → hsl(280) magenta across bar range
  const hue = 185 + (barIndex / (barCount - 1)) * (280 - 185);
  const lightness = 55 + (barIndex / (barCount - 1)) * 5; // 55% → 60%
  return `hsl(${hue}, 80%, ${lightness}%)`;
}

export default function SpectrumAnalyzer({
  analyser,
  active,
  width = 200,
  height = 48,
  barCount = 32,
}: SpectrumAnalyzerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const peaksRef = useRef<Float32Array>(new Float32Array(barCount));

  useEffect(() => {
    peaksRef.current = new Float32Array(barCount);
  }, [barCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Pre-compute bar colors
    const colors: string[] = Array.from({ length: barCount }, (_, i) => barColor(i, barCount));

    const barWidth = (width - (barCount - 1)) / barCount; // 1px gap between bars

    function drawFrame(dataArray: Uint8Array<ArrayBuffer> | null): void {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      const peaks = peaksRef.current;
      const nyquistBins = analyser ? analyser.fftSize / 2 : 1024;

      for (let i = 0; i < barCount; i++) {
        let value = 0;

        if (dataArray && analyser) {
          const bin = Math.min(logBinIndex(i, barCount, nyquistBins), dataArray.length - 1);
          value = dataArray[bin];
        }

        // Smooth decay on peaks
        peaks[i] = Math.max(value, peaks[i] * DECAY);

        const barH = (peaks[i] / 255) * height;
        const x = i * (barWidth + 1);
        const y = height - barH;

        ctx.fillStyle = colors[i];
        ctx.fillRect(x, y, barWidth, barH);
      }
    }

    let dataArray: Uint8Array<ArrayBuffer> | null = null;

    if (analyser) {
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      dataArray = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    }

    if (!active) {
      // Draw one frozen frame without starting a loop
      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
      }
      drawFrame(dataArray);
      return;
    }

    function loop(): void {
      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
      }
      drawFrame(dataArray);
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [analyser, active, width, height, barCount]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block', imageRendering: 'pixelated' }}
    />
  );
}
