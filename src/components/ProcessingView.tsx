import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";

const STEPS = [
  "reading braindump",
  "scanning existing items",
  "splitting compound thoughts",
  "finding correlations",
  "organizing by topic + priority",
  "almost done",
];

export function ProcessingView({ projectName }: { projectName: string }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const stepTimer = setInterval(() => {
      setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
    }, 4500);
    const elapsedTimer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      clearInterval(stepTimer);
      clearInterval(elapsedTimer);
    };
  }, []);

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-[420px] px-8">
        <div className="flex items-center gap-4 mb-10">
          <Logo size={28} className="text-[color:var(--color-accent)] animate-pulse" />
          <div>
            <div className="label text-[color:var(--color-fg-muted)]">processing</div>
            <div className="text-base font-semibold mt-1">{projectName}</div>
          </div>
        </div>

        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={`grid grid-cols-[32px_12px_1fr] items-center gap-3 transition-opacity duration-300 ${
                i > stepIdx ? "opacity-25" : "opacity-100"
              }`}
            >
              <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-fg-dim)] text-right">
                {toRoman(i + 1)}
              </span>
              <StepDot state={i < stepIdx ? "done" : i === stepIdx ? "active" : "pending"} />
              <span
                className={`text-sm ${
                  i === stepIdx
                    ? "text-[color:var(--color-fg)]"
                    : "text-[color:var(--color-fg-muted)]"
                }`}
              >
                {s}
              </span>
            </li>
          ))}
        </ol>

        <div className="flex items-baseline gap-3 mt-10 pt-4 border-t border-[color:var(--color-border)]">
          <div className="flex-1 label text-[color:var(--color-fg-muted)]">elapsed</div>
          <span className="font-mono text-sm tabular-nums text-[color:var(--color-accent)]">
            {Math.floor(elapsed / 60)
              .toString()
              .padStart(2, "0")}
            :
            {(elapsed % 60).toString().padStart(2, "0")}
          </span>
        </div>
      </div>
    </div>
  );
}

function StepDot({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-success)]" />;
  }
  if (state === "active") {
    return (
      <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-accent)] animate-pulse" />
    );
  }
  return (
    <span className="w-1.5 h-1.5 rounded-full border border-[color:var(--color-border)]" />
  );
}

function toRoman(n: number): string {
  const map: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let result = "";
  for (const [value, letter] of map) {
    while (n >= value) {
      result += letter;
      n -= value;
    }
  }
  return result;
}
