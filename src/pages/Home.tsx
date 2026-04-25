import { UserButton } from "@clerk/clerk-react";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";

export function Home() {
  const user = useQuery(api.auth.getCurrentUser);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="container max-w-4xl flex items-center justify-between py-4">
          <h1 className="font-semibold">Finnear</h1>
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>
      <main className="container max-w-4xl py-12">
        <h2 className="text-3xl font-bold tracking-tight mb-2">Welcome back</h2>
        <p className="text-muted-foreground">
          {user === undefined
            ? "Loading..."
            : user
              ? `Signed in as ${user.email}`
              : "Setting up your profile..."}
        </p>
      </main>
    </div>
  );
}
