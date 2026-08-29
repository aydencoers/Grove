import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Grove
      </p>
      <h1 className="mt-4 max-w-xl font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        A portfolio you can walk through
      </h1>
      <p className="mt-4 max-w-md text-balance text-muted-foreground">
        Every position you hold is a tree. The forest view is still being planted
        — for now, step into a single tree.
      </p>

      <Link
        href="/tree/de"
        className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Open the sample tree
        <ArrowRight className="size-4" aria-hidden />
      </Link>

      <p className="mt-16 text-xs text-muted-foreground">
        For informational purposes only. Not investment advice.
      </p>
    </main>
  );
}
