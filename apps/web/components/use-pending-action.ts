import { useRef, useState } from "react";

export function usePendingAction() {
  const active = useRef(new Set<string>());
  const [pending, setPending] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<void>) => {
    if (active.current.has(key)) return false;
    active.current.add(key);
    setPending(key);
    try {
      await action();
      return true;
    } finally {
      active.current.delete(key);
      setPending((current) => (current === key ? null : current));
    }
  };
  return { pending, run };
}
