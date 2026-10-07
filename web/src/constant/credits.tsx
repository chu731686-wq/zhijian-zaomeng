import type { ComponentProps } from "react";
import { Zap } from "lucide-react";

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <Zap className="size-[1em] fill-current" strokeWidth={2.4} />
        </span>
    );
}

export type ModelCreditCost = {
    model: string;
    credits: number;
};

export function modelCreditCost(modelCosts: ModelCreditCost[] | undefined, model: string) {
    return modelCosts?.find((item) => item.model === model)?.credits || 0;
}

export function requestCreditCost(options: { channelMode: string; modelCosts?: ModelCreditCost[]; model: string; count?: string | number; seconds?: string | number }) {
    if (options.channelMode !== "remote") return 0;
    const seconds = Number(options.seconds);
    const count = options.seconds !== undefined && seconds === -1 ? 15 : Math.max(1, Math.floor(Math.abs(Number(options.seconds ?? options.count)) || 1));
    return Math.round(modelCreditCost(options.modelCosts, options.model) * count * 100) / 100;
}
