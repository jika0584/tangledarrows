import { useEffect, useState } from 'react';

/** Fast ease-out count from 0 → target while `active`. */
export function useCountUp(target: number, active: boolean, durationMs = 720): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    if (target <= 0) {
      setValue(target);
      return;
    }

    const started = Date.now();
    let frame = 0;

    const tick = () => {
      const t = Math.min(1, (Date.now() - started) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setValue(target);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, durationMs]);

  return value;
}
