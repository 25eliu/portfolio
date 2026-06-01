import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose conditional class names with Tailwind conflict resolution. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
